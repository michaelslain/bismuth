// app/src/editor/inlineMarkdown.ts
// Render the inline markdown held in a table cell to display HTML. A table cell is a
// single line of markdown source; in display (non-editing) mode the editable-table
// widget shows it formatted — bold/italic/code/strikethrough/links via `marked`, plus
// the two marks `marked` doesn't know about: Obsidian `[[wikilinks]]` and inline
// `$math$` (rendered with the lazy KaTeX loader, exactly like the rest of the editor).
//
// Wikilinks and math are split OUT of the source first so `marked` never sees (and
// mangles) their `[[` / `$` syntax; the remaining runs go through `marked.parseInline`.
// Vault text is the user's own (trusted) and injected as innerHTML — the same trust
// model as app/src/bases/markdown.ts. Raw HTML inside a cell is intentionally NOT
// handled here (it's owned by the separate HTML pass); `marked` passes it through.
import { Marked } from "marked";
import { renderMath } from "./katexLoader";
import { escapeHtml } from "../htmlEscape";
import { renderCellListHtml } from "./cellList";
import { bismuthWrapSource } from "./bismuthWord";
import { type EmbedSpec, specForMarkdownImage, specForWikiEmbed } from "./embedSpec";

// An isolated `marked` instance so our config never leaks into the global one that
// bases/markdown.ts configures (and vice-versa). GFM gives ~~strikethrough~~ + autolinks.
const inlineMarked = new Marked({ gfm: true });

export type InlineSeg =
  | { type: "md"; raw: string }
  | { type: "wikilink"; target: string; alias: string | null }
  | { type: "math"; expr: string }
  // An IMAGE / PDF / media EMBED inside a cell (#30). `wiki` = `![[target]]` (target is the
  // inner text, e.g. "cat.png" or "doc.pdf#page=2"); non-wiki = a markdown `![alt](url)` image
  // (target is the url). Split out here so it renders as real media, not a `!` + wikilink chip
  // (the bug). Detection is pure (no asset URL); renderSeg builds the EmbedSpec at render time
  // with the injected `assetUrl`, exactly as embedBlock.ts does for the note editor.
  | { type: "embed"; wiki: boolean; target: string; alt: string | null };

/** How much vertical room a cell embed may take before it's capped (keeps a big image/pdf from
 *  blowing the row height). Width is always capped to the cell via `max-width:100%`. */
const CELL_EMBED_MAX_H = 240;

// A markdown `![alt](url "title")` image, anchored at the start of the slice we test.
const MD_IMAGE_AT = /^!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

// NOTE: this attr-escape additionally escapes `>` (via escapeHtml) — a different set
// than the canonical escapeAttr (`& < "`) — so it stays local to preserve behavior.
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** If a `$` at `open` begins an inline-math span, return the index just past its closing
 *  `$`; else -1. Common rule: no whitespace just inside either delimiter, not `$$`
 *  (that's display math, handled elsewhere), single line, `\$` escapes a literal dollar. */
function matchMath(src: string, open: number): number {
  if (src[open] !== "$" || src[open + 1] === "$") return -1;
  const after = src[open + 1];
  if (after === undefined || after === " " || after === "\t") return -1;
  for (let j = open + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === "\\") { j++; continue; } // skip the escaped char (e.g. \$)
    if (ch === "\n") return -1;
    if (ch === "$") {
      const prev = src[j - 1];
      return prev === " " || prev === "\t" ? -1 : j + 1;
    }
  }
  return -1;
}

/** Split a cell's markdown into segments, pulling wikilinks and inline math out of the
 *  text so the standard-markdown engine only ever sees plain inline markdown. Pure. */
export function tokenizeInline(src: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let buf = "";
  const flush = () => {
    if (buf) { segs.push({ type: "md", raw: buf }); buf = ""; }
  };
  let i = 0;
  while (i < src.length) {
    // ![[embed]] — an image/pdf/media embed. MUST be tested before the [[wikilink]] rule
    // below, since it starts with the same `[[` (otherwise `![[cat.png]]` split as `!` +
    // wikilink "cat.png" — the #30 bug where an image rendered as a link chip).
    if (src[i] === "!" && src[i + 1] === "[" && src[i + 2] === "[") {
      const close = src.indexOf("]]", i + 3);
      if (close !== -1) {
        flush();
        segs.push({ type: "embed", wiki: true, target: src.slice(i + 3, close).trim(), alt: null });
        i = close + 2;
        continue;
      }
    }
    // ![alt](url) — a markdown image/media embed (a bare `[text](url)` link is NOT an embed
    // and stays in the md run for `marked`).
    if (src[i] === "!" && src[i + 1] === "[") {
      const m = MD_IMAGE_AT.exec(src.slice(i));
      if (m) {
        flush();
        segs.push({ type: "embed", wiki: false, target: m[2], alt: m[1] });
        i += m[0].length;
        continue;
      }
    }
    // [[wikilink]] / [[target|alias]]
    if (src[i] === "[" && src[i + 1] === "[") {
      const close = src.indexOf("]]", i + 2);
      if (close !== -1) {
        flush();
        const inner = src.slice(i + 2, close);
        const bar = inner.indexOf("|");
        segs.push(
          bar === -1
            ? { type: "wikilink", target: inner.trim(), alias: null }
            : { type: "wikilink", target: inner.slice(0, bar).trim(), alias: inner.slice(bar + 1).trim() },
        );
        i = close + 2;
        continue;
      }
    }
    // `$$…$$` is DISPLAY math (owned by the math-block path) — pass the fence through
    // literally so the inner single-`$` scan below doesn't misread it as inline math.
    if (src[i] === "$" && src[i + 1] === "$") {
      buf += "$$";
      i += 2;
      continue;
    }
    // inline $math$
    if (src[i] === "$") {
      const end = matchMath(src, i);
      if (end !== -1) {
        flush();
        segs.push({ type: "math", expr: src.slice(i + 1, end - 1) });
        i = end;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return segs;
}

// Regions of a cell's inline markdown the iridescent "bismuth" effect must never touch — an
// inline code span, a raw HTML tag, a markdown `[text](url)` link, a bare URL, or a `#tag`.
// (Wikilinks + `$math$` are already split into their own segments before this runs, so an `md`
// segment never contains them.) Mirrors the reading-mode masking in bases/markdown.ts, scoped to a
// single cell line: code first so a `<` inside a code span isn't matched as an HTML tag; the link
// alternative before the bare-URL one so a `[x](https://…)` is masked as one unit.
const BISMUTH_PROTECT_RE =
  /`+[^`\n]*?`+|<[^>]+>|\[[^\]]*?\]\([^)]*?\)|https?:\/\/[^\s<>)\]]+|(?:^|\s)#[\p{L}\d/_-]+/giu;

/** Wrap every whole-word "bismuth" in a cell's inline markdown with the shared iridescent
 *  `.bismuth-word` gradient span (App.css, same effect as the reading-mode `.bismuth-word` /
 *  live-preview `.cm-bismuth`), skipping any that sit inside code / links / URLs / raw HTML / tags.
 *  Shares the mask → wrap → restore transform with the reading-mode renderer via `bismuthWrapSource`
 *  (only the protected-span set differs). The injected span passes through `marked` as inline HTML
 *  (its inner text is plain "bismuth" — no extension re-wraps it). Pure. */
export function iridescentBismuthCell(src: string): string {
  return bismuthWrapSource(src, BISMUTH_PROTECT_RE, (w) => `<span class="bismuth-word">${escapeHtml(w)}</span>`);
}

/** Build display HTML for a cell embed segment. Images/PDFs/audio/video render as real media
 *  pulled from GET /asset (via the injected `assetUrl`, exactly like embedBlock.ts); a note
 *  transclusion — or a target we can't classify as media — falls back to a clickable wikilink
 *  chip so it stays openable (#33) rather than broken. Sizes are inline so the media fits the
 *  cell (`max-width:100%`, a capped height) with no external CSS. Read-only: the raw `![[…]]`
 *  source is shown only in the cell's EDIT face (srcToEditHtml), never here. */
function renderEmbedSeg(seg: InlineSeg & { type: "embed" }, assetUrl: (t: string) => string): string {
  const spec: EmbedSpec | null = seg.wiki
    ? specForWikiEmbed(seg.target, assetUrl)
    : specForMarkdownImage(seg.target, seg.alt ?? "", assetUrl);
  // Unclassifiable (e.g. `.draw`) or a plain note embed → a clickable chip, not a broken box.
  if (!spec || spec.kind === "note") {
    const target = spec?.target ?? seg.target;
    return `<span class="cm-wikilink" data-wikilink="${escapeAttr(target)}">${escapeHtml(seg.alt ?? target)}</span>`;
  }
  if (spec.kind === "image" && spec.src) {
    const size = spec.width ? `width:${spec.width}px;` : "";
    return (
      `<img class="cm-cell-embed cm-cell-embed-img" src="${escapeAttr(spec.src)}" alt="${escapeAttr(spec.alt ?? "")}"` +
      ` loading="lazy" style="${size}max-width:100%;max-height:${CELL_EMBED_MAX_H}px;border-radius:4px;` +
      `display:inline-block;vertical-align:middle;object-fit:contain">`
    );
  }
  if (spec.kind === "pdf" && spec.src) {
    // Hide the browser viewer's toolbar + thumbnail rail so a compact in-cell embed shows the page.
    const params = [spec.page, "toolbar=0", "navpanes=0", "view=FitH"].filter(Boolean).join("&");
    return (
      `<iframe class="cm-cell-embed cm-cell-embed-pdf" src="${escapeAttr(spec.src + "#" + params)}"` +
      ` style="width:100%;height:${CELL_EMBED_MAX_H}px;border:1px solid var(--border);border-radius:6px;` +
      `background:var(--surface-2)"></iframe>`
    );
  }
  if (spec.kind === "audio" && spec.src) {
    return `<audio class="cm-cell-embed" controls src="${escapeAttr(spec.src)}" style="max-width:100%;vertical-align:middle"></audio>`;
  }
  if (spec.kind === "video" && spec.src) {
    return (
      `<video class="cm-cell-embed" controls src="${escapeAttr(spec.src)}"` +
      ` style="max-width:100%;max-height:${CELL_EMBED_MAX_H}px;border-radius:6px;vertical-align:middle"></video>`
    );
  }
  // Media kind but no resolved src → a chip fallback.
  return `<span class="cm-wikilink" data-wikilink="${escapeAttr(seg.target)}">${escapeHtml(seg.alt ?? seg.target)}</span>`;
}

function renderSeg(seg: InlineSeg, assetUrl: (t: string) => string): string {
  if (seg.type === "wikilink") {
    const text = seg.alias ?? seg.target;
    return `<span class="cm-wikilink" data-wikilink="${escapeAttr(seg.target)}">${escapeHtml(text)}</span>`;
  }
  if (seg.type === "math") {
    // "" until KaTeX lazy-loads; the widget re-renders the cell via onMathReady.
    const html = renderMath(seg.expr, false);
    return `<span class="cm-inline-math" data-math="${escapeAttr(seg.expr)}">${html}</span>`;
  }
  if (seg.type === "embed") {
    return renderEmbedSeg(seg, assetUrl);
  }
  return inlineMarked.parseInline(iridescentBismuthCell(seg.raw), { async: false }) as string;
}

/** Render a run of a cell's inline markdown (wikilinks/math/embeds split out, the rest via
 *  `marked`). One list item, or a whole non-list cell, is one run. */
function renderInlineRun(src: string, assetUrl: (t: string) => string): string {
  return tokenizeInline(src).map((seg) => renderSeg(seg, assetUrl)).join("");
}

/** Options for `renderInlineMarkdown`. `assetUrl` maps an embed target to its GET /asset URL
 *  (injected — this module has no `../api` dependency, so it stays unit-testable). When omitted
 *  it is the identity function (an embed then renders with its bare/relative src). */
export interface RenderInlineOptions {
  assetUrl?: (target: string) => string;
}

/** Render a cell's markdown source to display HTML (synchronous). A cell whose source is
 *  `<br>`-separated bullet/number markers renders as a real `<ul>`/`<ol>` (see cellList.ts);
 *  otherwise its inline markdown renders as-is (a `<br>` stays a soft line break). Image/PDF
 *  embeds render as real media via `opts.assetUrl` (#30). */
export function renderInlineMarkdown(src: string, opts?: RenderInlineOptions): string {
  const assetUrl = opts?.assetUrl ?? ((t: string) => t);
  const run = (item: string): string => renderInlineRun(item, assetUrl);
  return renderCellListHtml(src, run) ?? run(src);
}
