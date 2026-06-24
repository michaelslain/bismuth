// app/src/blocks/blockModel.ts
// Lossless markdown <-> blocks model. This is the release gate that prevents whole-file
// corruption: a note's source of truth is the RAW markdown string, so every block carries
// its EXACT original source slice in `raw`, and serialize() is just frontmatter + the raws
// concatenated. The HARD INVARIANT is:
//
//     serializeBlocksToMarkdown(parseMarkdownToBlocks(md)) === md   for ANY md.
//
// Pure + DOM-free (no CodeMirror, no Solid) so it runs under `bun test`. The block-boundary
// logic mirrors the line scanning in editor/livePreview.ts computeBlockRegions (fenced code,
// frontmatter, GFM tables, html), but operates on a plain string rather than a CM document.

import { parseFrontmatter } from "../../../core/src/frontmatter";
import { SLASH_ITEMS } from "../editor/slashMenu";

/** The kinds of block we recognise. `blank` and `unknown` are the safety net: anything we
 *  don't model explicitly still round-trips byte-for-byte via its `raw`. */
export type BlockType =
  | "paragraph"
  | "heading"
  | "bulletItem"
  | "orderedItem"
  | "task"
  | "quote"
  | "code"
  | "divider"
  | "table"
  | "image"
  | "mathBlock"
  | "html"
  | "frontmatter"
  | "blank"
  | "unknown";

/** One segmented block of a note body.
 *  - `id`     stable within a single parse (index-derived), for keyed UI rendering.
 *  - `raw`    the VERBATIM source slice for this block, INCLUDING its trailing blank-line
 *             spacing. This is what makes serialize lossless; never derive output from `text`.
 *  - `text`   the editable, marker-stripped content surfaced to the UI (paragraph text, the
 *             heading title, the list-item content, the code body, …). Absent for blocks with
 *             no meaningful editable content (divider) or opaque blocks (table/html/unknown,
 *             which the UI edits as raw if at all).
 *  - per-type attributes: `level` (heading), `checked`/`indent` (task), `ordered`/`indent`
 *             (list items), `lang` (code). */
export interface Block {
  id: string;
  type: BlockType;
  raw: string;
  text?: string;
  level?: number; // heading: 1-6
  checked?: boolean; // task
  indent?: string; // task / list item: the exact leading-whitespace string
  ordered?: boolean; // list item: true => orderedItem marker
  marker?: string; // list item: the exact marker token (e.g. "-", "*", "1.", "2)")
  lang?: string; // code: info string after the opening fence
}

export interface ParsedDocument {
  /** The VERBATIM frontmatter prefix (the `---\n…\n---\n?` block + nothing else), or "" if
   *  the note has none. Never re-stringified — sliced straight from the source. */
  frontmatter: string;
  blocks: Block[];
}

// ---------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------

/** Frontmatter fence matcher, identical to core/src/frontmatter.ts so the prefix we slice
 *  matches exactly what parseFrontmatter peels off. */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split source into the verbatim frontmatter prefix + the remaining body string. We use the
 *  same regex core uses (so the boundary agrees with parseFrontmatter), but keep the EXACT
 *  matched text rather than re-emitting YAML. parseFrontmatter is still called for validation
 *  / to stay in lockstep with the canonical peeler. */
function splitFrontmatter(md: string): { frontmatter: string; body: string } {
  const m = md.match(FRONTMATTER_REGEX);
  if (!m) {
    // Keep us honest: the canonical peeler must agree there's no frontmatter.
    parseFrontmatter(md);
    return { frontmatter: "", body: md };
  }
  parseFrontmatter(md); // tolerate / mirror malformed-YAML behaviour
  return { frontmatter: m[0], body: md.slice(m[0].length) };
}

const HEADING_RE = /^(#{1,6})(\s+.*)?$/;
const TASK_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s?(.*)$/;
const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+[.)])\s+(.*)$/;
const QUOTE_RE = /^\s*>/;
const DIVIDER_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const IMAGE_RE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/; // standalone ![alt](url)
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
const HTML_OPEN_RE = /^\s*<(?:[a-zA-Z][\w-]*|!--)/;

/** Is `line` a GFM table header candidate (a pipe row), with `next` being a separator row? */
function isTableStart(line: string, next: string | undefined): boolean {
  if (next === undefined) return false;
  if (!/\|/.test(line)) return false;
  return TABLE_SEP_RE.test(next);
}

/** A "blank" line for block-segmentation purposes: empty or whitespace-only. */
function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * Parse markdown into the verbatim frontmatter prefix + a list of body blocks.
 *
 * Segmentation is line-based and verbatim: each block's `raw` is the exact concatenation of
 * its source lines (with their original newline terminators) INCLUDING any blank lines that
 * trail it before the next non-blank block. Consequently joining every `raw` reproduces the
 * body byte-for-byte. Multi-line constructs (fenced code, tables, html, blockquotes, list
 * runs) are grouped so they round-trip even when they contain blank lines internally.
 */
export function parseMarkdownToBlocks(md: string): ParsedDocument {
  const { frontmatter, body } = splitFrontmatter(md);
  return { frontmatter, blocks: parseBody(body) };
}

/**
 * Segment a body fragment (NO frontmatter handling) into blocks. Shared by the top-level parse
 * and by `reconcileEditedBlock`, which re-parses ONE edited block's regenerated source so the
 * in-memory model stays in lockstep with what the `.md` will actually parse to.
 */
function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  if (body.length === 0) return blocks;

  // Split keeping the line terminators so we can rebuild raws verbatim. Each element is one
  // line WITHOUT its newline; `terms[i]` is the terminator that followed line i ("" for the
  // final line if the body had no trailing newline).
  const { lines, terms } = splitLines(body);

  let i = 0;
  let counter = 0;
  const nextId = () => `b${counter++}`;

  // Build a block from line range [start, end) plus its trailing blank lines, returning the
  // verbatim raw and advancing the cursor. `end` is exclusive over content lines.
  const rawFor = (start: number, end: number): string => {
    let out = "";
    for (let k = start; k < end; k++) out += lines[k] + terms[k];
    return out;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Blank run → a single blank block (verbatim).
    if (isBlank(line)) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      blocks.push({ id: nextId(), type: "blank", raw: rawFor(i, j) });
      i = j;
      continue;
    }

    // Fenced code block (``` or ~~~). Consumes through the matching closing fence (or EOF if
    // unclosed). Always grouped verbatim — code bodies may contain blank lines.
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[2]; // a run of ``` or ~~~ (length >= 3)
      const fenceChar = marker[0]; // ` or ~
      const lang = fence[3].trim();
      let j = i + 1;
      const bodyLines: string[] = [];
      // CommonMark close: a line of ONLY the same fence char, at least as long as the opener.
      // Requiring "as long as" lets a ```` block contain a shorter ``` line without closing
      // early; requiring "only fence chars" stops an info-string line (```js) from closing it.
      const closeRe = new RegExp("^\\s*" + fenceChar + "{" + marker.length + ",}\\s*$");
      while (j < lines.length && !closeRe.test(lines[j])) {
        bodyLines.push(lines[j]);
        j++;
      }
      if (j < lines.length) j++; // include the closing fence line
      blocks.push({
        id: nextId(),
        type: "code",
        raw: rawFor(i, j),
        lang,
        text: bodyLines.join("\n"),
      });
      i = j;
      continue;
    }

    // Math block ($$ … $$). Standalone opening `$$` consumes through the closing `$$`.
    if (/^\s*\$\$\s*$/.test(line)) {
      let j = i + 1;
      const bodyLines: string[] = [];
      while (j < lines.length && !/^\s*\$\$\s*$/.test(lines[j])) {
        bodyLines.push(lines[j]);
        j++;
      }
      if (j < lines.length) j++; // include the closing $$ line
      blocks.push({ id: nextId(), type: "mathBlock", raw: rawFor(i, j), text: bodyLines.join("\n") });
      i = j;
      continue;
    }

    // GFM table (header pipe row + separator row + contiguous body rows). Opaque (edited raw).
    if (isTableStart(line, lines[i + 1])) {
      let j = i + 2; // header + separator
      while (j < lines.length && !isBlank(lines[j]) && /\|/.test(lines[j])) j++;
      blocks.push({ id: nextId(), type: "table", raw: rawFor(i, j) });
      i = j;
      continue;
    }

    // HTML block: an open tag at the start of a line, consumed up to the next blank line.
    if (HTML_OPEN_RE.test(line)) {
      let j = i;
      while (j < lines.length && !isBlank(lines[j])) j++;
      blocks.push({ id: nextId(), type: "html", raw: rawFor(i, j) });
      i = j;
      continue;
    }

    // Blockquote run: contiguous lines beginning with `>`. Opaque-ish (edited raw / text).
    if (QUOTE_RE.test(line)) {
      let j = i;
      while (j < lines.length && QUOTE_RE.test(lines[j])) j++;
      const bodyText = lines
        .slice(i, j)
        .map((l) => l.replace(/^(\s*)>\s?/, ""))
        .join("\n");
      blocks.push({ id: nextId(), type: "quote", raw: rawFor(i, j), text: bodyText });
      i = j;
      continue;
    }

    // Divider / thematic break.
    // KNOWN LIMITATION: a `---` directly under a non-blank paragraph line is a CommonMark SETEXT H2,
    // but we classify it as paragraph + divider (we don't model setext headings). This is a
    // visual-only divergence — serialization is byte-for-byte verbatim, so nothing is lost on disk;
    // the note just shows a rule instead of an H2. Setext is rare (ATX `## ` is canonical); model a
    // setext block here if it ever matters.
    if (DIVIDER_RE.test(line)) {
      blocks.push({ id: nextId(), type: "divider", raw: rawFor(i, i + 1) });
      i += 1;
      continue;
    }

    // Heading (ATX). Single line.
    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const text = (heading[2] ?? "").replace(/^\s+/, "").replace(/\s+#*\s*$/, "");
      blocks.push({ id: nextId(), type: "heading", raw: rawFor(i, i + 1), level, text });
      i += 1;
      continue;
    }

    // Task item (a checkbox list item). One line per block (nesting captured via `indent`).
    const task = line.match(TASK_RE);
    if (task) {
      const indent = task[1];
      const checked = task[2].toLowerCase() === "x";
      const text = task[3];
      blocks.push({ id: nextId(), type: "task", raw: rawFor(i, i + 1), checked, indent, text });
      i += 1;
      continue;
    }

    // Bullet list item.
    const bullet = line.match(BULLET_RE);
    if (bullet) {
      blocks.push({
        id: nextId(),
        type: "bulletItem",
        raw: rawFor(i, i + 1),
        indent: bullet[1],
        marker: bullet[2],
        ordered: false,
        text: bullet[3],
      });
      i += 1;
      continue;
    }

    // Ordered list item.
    const ordered = line.match(ORDERED_RE);
    if (ordered) {
      blocks.push({
        id: nextId(),
        type: "orderedItem",
        raw: rawFor(i, i + 1),
        indent: ordered[1],
        marker: ordered[2],
        ordered: true,
        text: ordered[3],
      });
      i += 1;
      continue;
    }

    // Standalone image.
    if (IMAGE_RE.test(line)) {
      blocks.push({ id: nextId(), type: "image", raw: rawFor(i, i + 1), text: line.trim() });
      i += 1;
      continue;
    }

    // Paragraph: a run of non-blank lines that didn't start any of the structures above. We
    // stop the run at the first line that would itself begin a new block, so adjacent
    // structures don't get swallowed into a paragraph.
    {
      let j = i + 1;
      while (j < lines.length && !isBlank(lines[j]) && !startsNewBlock(lines, j)) j++;
      const text = lines.slice(i, j).join("\n");
      blocks.push({ id: nextId(), type: "paragraph", raw: rawFor(i, j), text });
      i = j;
    }
  }

  return blocks;
}

/** Would line `j` begin a brand-new block (so a running paragraph must stop before it)? Used
 *  only to bound paragraph runs; mirrors the structure detection in the main loop. */
function startsNewBlock(lines: string[], j: number): boolean {
  const line = lines[j];
  if (FENCE_RE.test(line)) return true;
  if (/^\s*\$\$\s*$/.test(line)) return true;
  if (isTableStart(line, lines[j + 1])) return true;
  if (HTML_OPEN_RE.test(line)) return true;
  if (QUOTE_RE.test(line)) return true;
  if (DIVIDER_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (TASK_RE.test(line)) return true;
  if (BULLET_RE.test(line)) return true;
  if (ORDERED_RE.test(line)) return true;
  // A standalone image is paragraph-like enough to keep grouped; don't break on it.
  return false;
}

/** Split `body` into lines + their original terminators so a verbatim rebuild is possible.
 *  Handles `\n`, `\r\n`, and a missing final newline. `lines[i] + terms[i]` reconstructs the
 *  i-th physical line exactly, and concatenating all of them reproduces `body`. */
function splitLines(body: string): { lines: string[]; terms: string[] } {
  const lines: string[] = [];
  const terms: string[] = [];
  let start = 0;
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === "\n") {
      // Detect a preceding \r to keep \r\n together as the terminator.
      const hasCr = k > start && body[k - 1] === "\r";
      const contentEnd = hasCr ? k - 1 : k;
      lines.push(body.slice(start, contentEnd));
      terms.push(body.slice(contentEnd, k + 1));
      start = k + 1;
    }
  }
  if (start < body.length) {
    lines.push(body.slice(start));
    terms.push("");
  }
  return { lines, terms };
}

// ---------------------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------------------

/**
 * Reassemble markdown from a frontmatter prefix + blocks. Lossless by construction: it simply
 * concatenates the verbatim frontmatter and every block's `raw`. Editing a block means
 * rewriting that block's `raw` (see renderBlockToMarkdown / setBlockText), so untouched blocks
 * stay byte-identical and the whole-file write never corrupts unmodelled content.
 */
export function serializeBlocksToMarkdown(frontmatter: string, blocks: Block[]): string {
  let out = frontmatter;
  for (const b of blocks) out += b.raw;
  return out;
}

// ---------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------

/** Render a block's editable content back to its markdown source line(s). Used to regenerate
 *  `raw` after an edit. The result is the block's content WITHOUT trailing blank-line spacing
 *  (that spacing is preserved separately by the edit helpers). Round-tripping the output must
 *  re-parse to the same block type. */
export function renderBlockToMarkdown(block: Block): string {
  switch (block.type) {
    case "heading": {
      const hashes = "#".repeat(Math.min(6, Math.max(1, block.level ?? 1)));
      const text = block.text ?? "";
      return text ? `${hashes} ${text}` : `${hashes} `;
    }
    case "task": {
      const indent = block.indent ?? "";
      const box = block.checked ? "[x]" : "[ ]";
      return `${indent}- ${box} ${block.text ?? ""}`;
    }
    case "bulletItem": {
      const indent = block.indent ?? "";
      const marker = block.marker ?? "-";
      return `${indent}${marker} ${block.text ?? ""}`;
    }
    case "orderedItem": {
      const indent = block.indent ?? "";
      const marker = block.marker ?? "1.";
      return `${indent}${marker} ${block.text ?? ""}`;
    }
    case "quote": {
      const lines = (block.text ?? "").split("\n");
      return lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
    }
    case "code": {
      const lang = block.lang ?? "";
      const body = block.text ?? "";
      // Choose a backtick fence LONGER than any all-backtick line in the body, so an embedded
      // ``` can never close the block early — an edited code block containing a fence stays a
      // SINGLE code block on reparse (paired with the length-aware closeRe in parseBody).
      let longest = 0;
      for (const ln of body.split("\n")) {
        const m = /^\s*(`+)\s*$/.exec(ln);
        if (m) longest = Math.max(longest, m[1].length);
      }
      const fence = "`".repeat(Math.max(3, longest + 1));
      return fence + lang + "\n" + body + "\n" + fence;
    }
    case "mathBlock": {
      return "$$\n" + (block.text ?? "") + "\n$$";
    }
    case "divider":
      return "---";
    case "paragraph":
    case "image":
      return block.text ?? "";
    // Opaque blocks: their raw IS the source of truth; nothing to re-render.
    case "table":
    case "html":
    case "frontmatter":
    case "blank":
    case "unknown":
    default:
      return block.raw;
  }
}

/** Split a block's `raw` into its content portion + the trailing blank-line spacing that
 *  followed it. We preserve the trailing spacing across edits so neighbouring block gaps are
 *  untouched. The "content" is everything up to (but not including) the run of trailing blank
 *  lines at the end of `raw`. */
function splitTrailingBlanks(raw: string): { content: string; trailing: string } {
  // Find the index after the last non-blank line's terminator.
  const { lines, terms } = splitLines(raw);
  let last = lines.length;
  while (last > 0 && lines[last - 1].trim() === "") last--;
  if (last === lines.length) return { content: raw, trailing: "" };
  let content = "";
  for (let k = 0; k < last; k++) content += lines[k] + terms[k];
  let trailing = "";
  for (let k = last; k < lines.length; k++) trailing += lines[k] + terms[k];
  return { content, trailing };
}

/** Recompute a block's `raw` from its current editable attributes, preserving the trailing
 *  blank-line spacing and the line terminator style of the original. Returns a NEW block; the
 *  input is not mutated. Opaque blocks (table/html/unknown/blank/frontmatter) are returned
 *  unchanged. */
export function regenerateRaw(block: Block): Block {
  if (
    block.type === "table" ||
    block.type === "html" ||
    block.type === "frontmatter" ||
    block.type === "blank" ||
    block.type === "unknown"
  ) {
    return block;
  }
  const { content, trailing } = splitTrailingBlanks(block.raw);
  // Preserve the original terminator: if the content ended in \r\n use that, else \n, else "".
  const eol = content.endsWith("\r\n") ? "\r\n" : content.endsWith("\n") ? "\n" : "";
  const rendered = renderBlockToMarkdown(block);
  // renderBlockToMarkdown uses \n internally for multi-line blocks; normalise to the block's
  // own EOL so the rebuilt content matches the surrounding terminator style.
  const body = eol === "\r\n" ? rendered.replace(/\n/g, "\r\n") : rendered;
  return { ...block, raw: body + eol + trailing };
}

/** Set a block's editable text and regenerate its raw (lossless trailing spacing preserved). */
export function setBlockText(block: Block, text: string): Block {
  return regenerateRaw({ ...block, text });
}

// Monotonic, parse-distinct id prefix for blocks SPLIT OUT of an edit (see reconcileEditedBlock).
// Distinct from parse's `b<n>` and BlockEditor's `rt<n>` so keyed rendering never collides.
let reconcileSeq = 0;
const reconcileId = (): string => `re${reconcileSeq++}`;

/**
 * Reconcile an edited block with what its markdown will actually re-parse to.
 *
 * The block model is lossless on UNTOUCHED content (verbatim `raw`), but an EDIT can make a
 * block's regenerated source describe a DIFFERENT structure than the block claims: a heading or
 * list item whose text gains a newline (Shift+Enter / paste) serializes to lines that re-parse
 * as several blocks; a paragraph whose text becomes "# x" / "- x" / "> x" re-parses as a
 * heading / list / quote. Left unreconciled the in-memory model diverges from disk and the note
 * visibly restructures on the next reload. So after every text edit we regenerate the block's
 * source and re-parse it: if the structure is unchanged we keep the block as-is; otherwise we
 * adopt the parsed blocks (markdown-shortcut behaviour, and lossless multi-block splitting).
 *
 * The first result keeps the edited block's id (focus continuity); the last carries the
 * original trailing blank-line spacing; any extra blocks get fresh unique ids. NO BYTES are
 * ever lost either way — this only realigns the block boundaries with the source.
 */
export function reconcileEditedBlock(block: Block): Block[] {
  // Opaque blocks edit their raw directly — nothing to reconcile.
  if (
    block.type === "table" ||
    block.type === "html" ||
    block.type === "frontmatter" ||
    block.type === "blank" ||
    block.type === "unknown"
  ) {
    return [regenerateRaw(block)];
  }
  const regen = regenerateRaw(block);
  const { content, trailing } = splitTrailingBlanks(regen.raw);
  // An emptied block stays an empty, editable block of its own type (don't collapse to "blank").
  if (content === "") return [regen];
  const parsed = parseBody(content);
  if (parsed.length === 0) return [regen];
  // Unchanged structure: regen already has the right id + trailing spacing.
  if (parsed.length === 1 && parsed[0].type === block.type) return [regen];
  // Structure changed: adopt the parsed blocks so model === disk.
  return parsed.map((b, k) => ({
    ...b,
    id: k === 0 ? block.id : reconcileId(),
    raw: k === parsed.length - 1 ? b.raw + trailing : b.raw,
  }));
}

/** Toggle a task block's checked state and regenerate its raw. No-op for non-task blocks. */
export function toggleTaskChecked(block: Block): Block {
  if (block.type !== "task") return block;
  return regenerateRaw({ ...block, checked: !block.checked });
}

/** Set a heading block's level (clamped 1-6) and regenerate its raw. No-op for non-headings. */
export function setHeadingLevel(block: Block, level: number): Block {
  if (block.type !== "heading") return block;
  return regenerateRaw({ ...block, level: Math.min(6, Math.max(1, level)) });
}

// ---------------------------------------------------------------------------------------
// Slash-menu <-> block-type mapping
// ---------------------------------------------------------------------------------------

/** Map a slash-menu item id (app/src/editor/slashMenu.ts SLASH_ITEMS) to the BlockType it
 *  inserts, so the block-insert UI and this model agree on what a "/heading" produces. Items
 *  that don't create a standalone block (wikilink/embed inserted inline; properties =
 *  frontmatter) map to the closest type. */
export function blockTypeForSlashItem(id: string): BlockType {
  switch (id) {
    case "h1":
    case "h2":
    case "h3":
      return "heading";
    case "ul":
      return "bulletItem";
    case "ol":
      return "orderedItem";
    case "task":
      return "task";
    case "quote":
      return "quote";
    case "table":
      return "table";
    case "code":
    case "query":
      return "code";
    case "math":
      return "mathBlock";
    case "divider":
      return "divider";
    case "embed":
      return "image";
    case "wikilink":
      return "paragraph";
    case "properties":
      return "frontmatter";
    default:
      return "paragraph";
  }
}

/** The full id -> BlockType table, derived from SLASH_ITEMS so it stays in lockstep with the
 *  catalog the UI renders. */
export const SLASH_ITEM_BLOCK_TYPES: Record<string, BlockType> = Object.fromEntries(
  SLASH_ITEMS.map((it) => [it.id, blockTypeForSlashItem(it.id)]),
);
