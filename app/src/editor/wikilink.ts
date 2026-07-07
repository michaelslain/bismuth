// app/src/editor/wikilink.ts
// Pure, DOM-free helpers for wikilink autocomplete. NO CodeMirror imports here, so
// these run under `bun test` without a browser environment.
import { previewKind } from "../preview/previewKind";

// `label` is the basename (what gets inserted + shown in autocomplete); `path` is the
// note's real vault path (the graph node id), needed to resolve a clicked wikilink to
// the file on disk; `folder` is the top-level folder, shown as autocomplete detail.
export type NoteCandidate = { label: string; path: string; folder?: string };

// The cursor (end of `textBefore`) sits inside an open `[[…` with no closing `]]` yet.
// `[^\]\n]*` after `[[` ensures we only match while the link is still open, and the
// `$` anchor makes `.match` pick the rightmost such `[[` on the line.
const OPEN = /\[\[([^\]\n]*)$/;

export function matchWikilinkPrefix(
  textBefore: string,
): { from: number; query: string } | null {
  const m = textBefore.match(OPEN);
  if (!m) return null;
  // m.index points at the `[[`; the query starts two characters later.
  return { from: (m.index ?? 0) + 2, query: m[1] };
}

// Parse the inside of a `[[…]]` token (the text between the brackets) into its parts.
// Obsidian syntax is `[[target#heading|alias]]`: `#` precedes `|`. `display` is what to
// show off the cursor line — the alias if given, else the target's basename (last path segment).
export function parseWikilink(inner: string): {
  target: string;
  alias?: string;
  heading?: string;
  display: string;
} {
  const pipe = inner.indexOf("|");
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
  const beforeAlias = pipe === -1 ? inner : inner.slice(0, pipe);
  const hash = beforeAlias.indexOf("#");
  const heading = hash === -1 ? undefined : beforeAlias.slice(hash + 1).trim();
  const target = (hash === -1 ? beforeAlias : beforeAlias.slice(0, hash)).trim();
  const basename = target.slice(target.lastIndexOf("/") + 1);
  const result: { target: string; alias?: string; heading?: string; display: string } = {
    target,
    display: alias || basename,
  };
  if (alias) result.alias = alias;
  if (heading) result.heading = heading;
  return result;
}

// The caret sits inside an open `[[target#…` — i.e. a wikilink whose target is followed by
// a `#` (the heading separator). Returns the `target` (note name before the `#`), the partial
// `heading` text typed after it, and `from` (the offset into `textBefore` where the heading
// query starts, just past the `#`). Returns null when the caret is NOT inside an open wikilink
// or there is no `#` yet — that case is plain note-name completion (matchWikilinkPrefix).
// `#` is split on its FIRST occurrence so a heading containing a stray `#` still resolves.
export function matchWikilinkHeadingPrefix(
  textBefore: string,
): { target: string; heading: string; from: number } | null {
  const open = matchWikilinkPrefix(textBefore);
  if (!open) return null;
  const hash = open.query.indexOf("#");
  if (hash === -1) return null;
  return {
    target: open.query.slice(0, hash).trim(),
    heading: open.query.slice(hash + 1),
    from: open.from + hash + 1,
  };
}

export type HeadingItem = { text: string; level: number };

// Normalize a heading for comparison: trim, collapse internal whitespace, lowercase. Used so
// a `[[File#My Heading]]` anchor matches the document's `## My  Heading` regardless of case or
// spacing (Obsidian-style display-text matching, NOT a GitHub slug).
function normalizeHeading(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// Hoisted: these run per-line from the heading scanners below, which are called from
// hot editor passes (autocomplete, live preview). Both are used via .test()/.exec()
// without the `g` flag, so there's no lastIndex state to worry about across calls.
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_LINE_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

// True for a fence opener/closer line (``` or ~~~, any indent). Toggling on these lets the
// heading scanners skip `#` lines that are really code, mirroring core's stripCode masking.
function isFence(line: string): boolean {
  return FENCE_RE.test(line);
}

// ATX heading line → its level + trimmed display text (closing `#`s stripped), else null.
function parseHeadingLine(line: string): HeadingItem | null {
  const m = HEADING_LINE_RE.exec(line);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

// Index of the first BODY line, skipping a leading `---`…`---` YAML frontmatter block so a YAML
// `# comment` (or a `key: '# value'`) inside it isn't mistaken for a heading. 0 when there's no
// frontmatter (or it's unterminated — then we treat the whole doc as body).
function bodyStartLine(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return 0;
}

// Extract the ATX headings (`# …` … `###### …`) from markdown, in document order, skipping the
// YAML frontmatter block and fenced code. Pure + DOM-free so it powers `[[File#` heading
// autocomplete from a fetched note body and is unit-testable without a browser.
export function parseHeadings(md: string): HeadingItem[] {
  const lines = md.split("\n");
  const out: HeadingItem[] = [];
  let inFence = false;
  for (let i = bodyStartLine(lines); i < lines.length; i++) {
    const line = lines[i];
    if (isFence(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = parseHeadingLine(line);
    if (h) out.push(h);
  }
  return out;
}

// Find the 0-based index of the first line that is an ATX heading whose text matches `heading`
// (normalized: case/whitespace-insensitive), skipping frontmatter + fenced code. Returns -1 when
// none match — the caller then leaves the scroll position alone rather than jumping somewhere wrong.
export function findHeadingLineIndex(lines: string[], heading: string): number {
  const want = normalizeHeading(heading);
  let inFence = false;
  for (let i = bodyStartLine(lines); i < lines.length; i++) {
    const line = lines[i];
    if (isFence(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = parseHeadingLine(line);
    if (h && normalizeHeading(h.text) === want) return i;
  }
  return -1;
}

// Given a `[[…]]` match — `inner` is the text between the brackets, `start` is the
// document offset of the opening "[[" — return the [from, to) document slice to *reveal*
// in live preview: the alias if present, else the target's basename. Everything else
// (the brackets, any folder path, the "#heading") falls outside this range and is hidden.
export function wikilinkVisibleRange(inner: string, start: number): { from: number; to: number } {
  const innerStart = start + 2; // skip the opening "[["
  const pipe = inner.indexOf("|");
  if (pipe !== -1) {
    // alias: from just after "|" to the end of the inner text (before the closing "]]")
    return { from: innerStart + pipe + 1, to: innerStart + inner.length };
  }
  const hash = inner.indexOf("#");
  const targetLen = hash === -1 ? inner.length : hash;
  const basenameStart = inner.slice(0, targetLen).lastIndexOf("/") + 1;
  return { from: innerStart + basenameStart, to: innerStart + targetLen };
}

// Resolve a wikilink target (a basename like "My Note" or a full path like
// "reading/My Note") to a real note path. Wikilinks are filename-based, so a bare
// basename must be looked up against the vault's notes. Exact path wins over basename.
// Returns null when nothing matches (caller treats it as a brand-new note).
export function resolveNotePath(
  target: string,
  notes: { label: string; path: string }[],
): string | null {
  const byPath = notes.find((n) => n.path === target);
  if (byPath) return byPath.path;
  const byBase = notes.find((n) => n.label === target);
  return byBase ? byBase.path : null;
}

// Build the `bismuth-open` path for a clicked wikilink, given `resolveNotePath`'s result.
// Every wikilink-click site (Editor.tsx mousedown, BlockEditor.tsx chip click, the table
// cell's openCellWikilink) used to unconditionally append ".md" to an UNRESOLVED target —
// correct for "create a new note at this name", but wrong when the target already names an
// existing non-note attachment (`[[Screenshot ….png]]` as a plain — non-embed — wikilink
// chip, e.g. inside a table cell). Appending ".md" there produced "….png.md": `previewKind`
// classifies that as a plain (unknown) note extension, so PaneContent routed it to the note
// editor instead of PreviewView — a blank tab for a note that doesn't exist, not a 404 image
// (#38). A resolved match is a real note id (already `.md`-stripped by `noteId()`), so it
// still gets ".md" appended; an unresolved target that `previewKind` recognizes as a
// previewable attachment opens AS-IS; anything else (a bare new-note name) keeps the old
// create-a-new-note fallback.
export function wikilinkOpenPath(target: string, resolved: string | null): string {
  if (resolved) return `${resolved}.md`;
  if (target.toLowerCase().endsWith(".md")) return target; // already explicit — never double it
  return previewKind(target) ? target : `${target}.md`;
}

// Text to insert when a note is chosen. Append the closing `]]` only when it isn't
// already immediately ahead (avoids `]]]]`); the cursor always lands just past `]]`.
export function buildInsert(
  label: string,
  hasClosingAhead: boolean,
): { insert: string; cursorOffset: number } {
  return {
    insert: hasClosingAhead ? label : label + "]]",
    // Cursor lands just past the closing `]]`, whether we inserted it (label + "]]")
    // or it was already ahead — hence `+ 2` in both branches.
    cursorOffset: label.length + 2,
  };
}
