import { marked, type Token, type TokenizerAndRendererExtension } from "marked";
import { sanitizeHtml } from "../sanitizeHtml";
import { escapeHtml, escapeAttr } from "../htmlEscape";
import { renderMath, onMathReady } from "../editor/katexLoader";
import { parseCalloutHeader, renderCalloutHtml, type CalloutHeader } from "../editor/callout";
import { renderCellListHtml } from "../editor/cellList";

// GFM + single-newline line breaks. marked passes raw HTML in the markdown
// straight through (Obsidian-style passthrough), so the result is sanitized
// before it is injected as innerHTML (card faces, calendar descriptions, `.md`
// transclusion, md export).
marked.use({ gfm: true, breaks: true });

// ── Math: `$…$` inline + `$$…$$` block ───────────────────────────────────────
// marked has no math support, so render KaTeX here (via the SAME shared renderMath the
// editor's livePreview/mathBlock/inlineMarkdown use). This lights up math on EVERY
// non-editor surface that funnels through renderMarkdown: card faces, flashcards,
// calendar descriptions, `.md` transclusion, and html/pdf export — none of which
// rendered math before.
//
// KaTeX loads lazily (katexLoader). If a surface renders before the chunk lands,
// renderMath returns "" — so we emit a placeholder carrying the source and, once KaTeX
// is ready, upgrade every still-empty placeholder in place. This preserves the lazy
// load (no eager ~280KB at boot) while still rendering math that paints cold.

let upgradeScheduled = false;
function scheduleMathUpgrade(): void {
  if (upgradeScheduled || typeof document === "undefined") return;
  upgradeScheduled = true;
  onMathReady(() => {
    upgradeScheduled = false;
    for (const el of document.querySelectorAll<HTMLElement>("span.bismuth-math[data-math]")) {
      if (el.childElementCount > 0) continue; // already upgraded
      // Sanitize like the initial render path — these are non-editor (reading) surfaces,
      // where rendered output goes through DOMPurify as a second layer (KaTeX output is
      // already safe, but keep the layer consistent).
      el.innerHTML = sanitizeHtml(renderMath(el.dataset.math ?? "", el.dataset.display === "1"));
    }
  });
}

/** Render one math span: full KaTeX if loaded, else a source-carrying placeholder that
 *  `scheduleMathUpgrade` fills in once the lazy KaTeX chunk lands. */
function mathHtml(expr: string, display: boolean): string {
  const cls = display ? "bismuth-math bismuth-math-display" : "bismuth-math";
  const html = renderMath(expr, display);
  if (html) return `<span class="${cls}">${html}</span>`;
  scheduleMathUpgrade();
  return `<span class="${cls}" data-math="${escapeAttr(expr)}" data-display="${display ? "1" : "0"}"></span>`;
}

const MATH_BLOCK_RE = /^\$\$([\s\S]+?)\$\$/;
const mathBlockExt: TokenizerAndRendererExtension = {
  name: "bismuthMathBlock",
  level: "block",
  start(src) { const i = src.indexOf("$$"); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = MATH_BLOCK_RE.exec(src);
    if (!m) return undefined;
    return { type: "bismuthMathBlock", raw: m[0], text: m[1].trim() };
  },
  renderer(token) { return mathHtml(String(token.text), true); },
};

// Cap on how many source lines a multi-line inline `$…$` may cross before we treat it as two
// stray `$` (e.g. prices "$5 … $9") rather than one soft-wrapped equation. Mirrors the editor's
// MAX_INLINE_MATH_LINES (mathBlock.ts) so reading mode and live preview agree.
const MAX_INLINE_MATH_NEWLINES = 10;

const MATH_INLINE_RE = /^\$(?![\s$])((?:\\[\s\S]|[^$\\])*?)(?<!\s)\$(?!\$)/;
const INLINE_MATH_NEWLINE_RE = /\n/g;
const mathInlineExt: TokenizerAndRendererExtension = {
  name: "bismuthMathInline",
  level: "inline",
  start(src) { const i = src.indexOf("$"); return i < 0 ? undefined : i; },
  tokenizer(src) {
    // Single `$…$` (not `$$`), no whitespace just inside either delimiter, `\$` escapes a
    // literal dollar — same rule as the editor's inlineMarkdown. Content MAY span newlines
    // (Obsidian parity: a `$…$` that soft-wrapped renders as one inline KaTeX widget); the
    // inline lexer already keeps `src` within one paragraph, so this can't cross a blank
    // line, and the newline cap below keeps two stray `$` (a "$5 … $9" pair) literal.
    // NB: the content alternation MUST disambiguate the backslash — `(?:\\[\s\S]|[^$\\])` consumes a
    // `\x` escape ONLY via the first branch and every other char via the second. The naive
    // `(?:\\.|[^$])` lets a `\` match either branch, which with `[^$]` spanning newlines backtracks
    // exponentially (ReDoS) on a long unclosed `$…` paragraph of LaTeX. This form is linear.
    const m = MATH_INLINE_RE.exec(src);
    if (!m) return undefined;
    if ((m[1].match(INLINE_MATH_NEWLINE_RE)?.length ?? 0) > MAX_INLINE_MATH_NEWLINES) return undefined;
    return { type: "bismuthMathInline", raw: m[0], text: m[1] };
  },
  renderer(token) { return mathHtml(String(token.text), false); },
};

// ── Callouts: Obsidian `> [!type] Title` blockquote admonitions ───────────────
// A block-level extension that claims a blockquote run whose first line is a callout header
// (`> [!note] …`), renders the inner body + title recursively (so nested markdown / nested
// callouts work), and emits the shared `.callout` markup (editor/callout.ts). Registered before
// marked's default blockquote tokenizer (extension tokenizers win), so a callout never renders as
// a plain <blockquote>. This lights up callouts on EVERY renderMarkdown surface: card faces,
// `.md` transclusion, calendar descriptions, and html/pdf export. The icon SVG + accent class
// survive sanitize (DOMPurify svg profile, see sanitizeHtml.ts).
interface CalloutToken {
  type: "bismuthCallout";
  raw: string;
  header: CalloutHeader;
  titleTokens: Token[];
  bodyTokens: Token[];
}
const CALLOUT_START_RE = /(?:^|\n)[ \t]{0,3}>[ \t]?\[!/;
const CALLOUT_BLOCKQUOTE_LINES_RE = /^((?:[ \t]{0,3}>[^\n]*(?:\n|$))+)/;
const calloutBlockExt: TokenizerAndRendererExtension = {
  name: "bismuthCallout",
  level: "block",
  start(src) {
    const m = CALLOUT_START_RE.exec(src);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    // Block tokenizers run at a block boundary, so `src` starts at the candidate blockquote.
    const m = CALLOUT_BLOCKQUOTE_LINES_RE.exec(src);
    if (!m) return undefined;
    const block = m[0];
    const rawLines = block.replace(/\n$/, "").split("\n");
    const header = parseCalloutHeader(rawLines[0]);
    if (!header) return undefined; // a plain blockquote — let marked's default tokenizer handle it
    const bodyMd = rawLines
      .slice(1)
      .map((l) => l.replace(/^[ \t]{0,3}>[ \t]?/, ""))
      .join("\n");
    const token: CalloutToken = {
      type: "bismuthCallout",
      raw: block,
      header,
      titleTokens: this.lexer.inlineTokens(header.title),
      bodyTokens: this.lexer.blockTokens(bodyMd),
    };
    return token;
  },
  renderer(token) {
    const t = token as unknown as CalloutToken;
    const titleHtml = this.parser.parseInline(t.titleTokens);
    const bodyHtml = this.parser.parse(t.bodyTokens);
    return renderCalloutHtml(t.header, bodyHtml, titleHtml);
  },
};

marked.use({ extensions: [mathBlockExt, mathInlineExt, calloutBlockExt] });

// ── Lists inside table cells ──────────────────────────────────────────────────
// A GFM cell is one line, so a `<br>`-separated run of `- item` / `1. item` markers is
// rendered as a real <ul>/<ol> (shared convention + parser in editor/cellList.ts, so the
// note reader and the editor's editable-table widget agree). A non-list cell falls back to
// marked's default inline render (a literal `<br>` stays a soft line break). Overrides only
// `tablecell`; `table`/`tablerow` keep their defaults.
marked.use({
  renderer: {
    tablecell(token) {
      const listHtml = renderCellListHtml(token.text, (item) => marked.parseInline(item, { async: false }) as string);
      const content = listHtml ?? this.parser.parseInline(token.tokens);
      const tag = token.header ? "th" : "td";
      return (token.align ? `<${tag} align="${token.align}">` : `<${tag}>`) + content + `</${tag}>\n`;
    },
  },
});

// A lone `<!-- pagebreak -->` comment line marks a PDF page boundary (invisible on screen + in
// Obsidian). DOMPurify STRIPS HTML comments, so convert the marker into a real, zero-height
// <div class="bismuth-page-break"> BEFORE sanitize — the div survives, the PDF rasterizer
// (htmlToPdf) slices a new page at it, and `height:0` (htmlTemplate.ts) makes it a no-op on every
// other surface. Masked like wikilinks/tags so a marker inside a code fence/span stays literal.
const PAGEBREAK_RE = /^[ \t]*<!--[ \t]*pagebreak[ \t]*-->[ \t]*$/gm;
function pageBreaksToDivs(src: string): string {
  const { masked, codes } = maskCode(src);
  // Surround the injected div with blank lines: a bare `<div>` starts a CommonMark type-6 HTML
  // block that swallows the following lines as raw HTML until the next blank line, so content
  // right after the marker (e.g. a `# Heading` from the `<!-- pagebreak -->\n$0` snippet) would
  // stop being parsed as markdown. The blank lines close the HTML block so the rest renders normally.
  return unmaskCode(masked.replace(PAGEBREAK_RE, '\n\n<div class="bismuth-page-break"></div>\n\n'), codes);
}

/** Render a markdown string to sanitized HTML (synchronous). */
export function renderMarkdown(src: string): string {
  return sanitizeHtml(marked.parse(pageBreaksToDivs(src ?? ""), { async: false }) as string);
}

// Obsidian `[[wikilinks]]` aren't standard markdown, so `marked` would emit them
// verbatim (`[[Note]]`). Pre-convert them to anchors carrying the resolved path in
// `data-href`; a host (BodyCard) opens them via the global `bismuth-open` event — the
// same in-app navigation ListView uses. Done on the raw source, BEFORE marked, so
// the surrounding markdown (lists, headings, links) still renders normally and the
// anchor passes through marked's raw-HTML passthrough.
const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;
function wikilinksToAnchors(src: string): string {
  return src.replace(WIKILINK_RE, (_m, inner: string) => {
    const [rawTarget, alias] = inner.split("|");
    const target = rawTarget.split("#")[0].trim();
    const label = (alias ?? target.split("/").pop() ?? target).trim();
    const path = target.endsWith(".md") ? target : `${target}.md`;
    return `<a class="bismuth-wikilink" data-href="${escapeAttr(path)}">${escapeHtml(label)}</a>`;
  });
}

// Obsidian `#tags` aren't standard markdown either, so marked would emit them verbatim.
// Wrap them in a styled span (teal mono, mirroring the editor's `.cm-tag`) so a card /
// transclusion shows tags the same way a note does. Runs AFTER wikilinksToAnchors (which
// strips a `[[Note#Section]]` anchor first, so its `#Section` isn't wrapped) and BEFORE
// marked — same raw-source pass + in-code caveat as wikilinksToAnchors. `#` must follow
// start-of-string or whitespace/`(`, and a tag starts with a letter (so `# Heading`, which
// has a space, and bare `#123` never match).
const TAG_RE = /(^|[\s(])#([A-Za-zÀ-ɏ][\w/-]*)/g;
function tagsToSpans(src: string): string {
  return src.replace(TAG_RE, (_m, pre: string, tag: string) => `${pre}<span class="bismuth-tag">#${escapeHtml(tag)}</span>`);
}

// `wikilinksToAnchors`/`tagsToSpans` run on the RAW source before marked, so on their own they'd
// also rewrite `[[x]]`/`#y` that sit INSIDE a code span or fenced block — where they're literal —
// and the injected anchor/span HTML would then leak as visible text inside the `<code>`. Mask code
// regions (fenced ```/~~~ blocks + inline `…` spans) with null-delimited placeholders that can't
// match the wikilink/tag regexes, convert the rest, then restore the code verbatim before marked
// parses it. Fenced alternatives come first so a ``` block isn't chewed up by the inline rule.
const CODE_MASK_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*?`+/g;
function maskCode(src: string): { masked: string; codes: string[] } {
  const codes: string[] = [];
  const masked = src.replace(CODE_MASK_RE, (m) => `\u0000${codes.push(m) - 1}\u0000`);
  return { masked, codes };
}
function unmaskCode(s: string, codes: string[]): string {
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)] ?? "");
}
/** Resolve `[[wikilinks]]` + `#tags` on the source while leaving code spans/fences untouched. */
function linkifyOutsideCode(src: string): string {
  const { masked, codes } = maskCode(src);
  return unmaskCode(tagsToSpans(wikilinksToAnchors(masked)), codes);
}

/** Render a NOTE body to sanitized HTML — like `renderMarkdown`, but also resolves
 *  Obsidian `[[wikilinks]]` into clickable anchors and styles `#tags`. Use for any surface
 *  that renders a vault note's own body (cards, transclusion) rather than arbitrary markdown. */
export function renderNoteBody(src: string): string {
  return renderMarkdown(linkifyOutsideCode(src ?? ""));
}

/** Render a single cell/line of markdown to sanitized INLINE HTML — emphasis, code, inline
 *  `$math$` (via the shared KaTeX renderer + progressive upgrade), `[[wikilinks]]` and
 *  `#tags`, with NO block wrapping (`<p>`). Used by Base table/card cells so a cell renders
 *  the same markdown as the rest of the app. `marked.parseInline` runs the inline math
 *  extension above but not the block one, so `$$…$$` stays literal (correct for a cell). */
export function renderInline(src: string): string {
  return sanitizeHtml(marked.parseInline(tagsToSpans(wikilinksToAnchors(src ?? "")), { async: false }) as string);
}

// Cheap gate: only run the markdown renderer on strings that actually carry inline markup
// (emphasis, code, a wikilink, a #tag, raw HTML, or `$math$`); plain values stay literal.
const CELL_MARKUP_RE = /[*_~`$]|\[\[|<[a-z/]|(?:^|\s)#[A-Za-z]/;
export function hasInlineMarkup(s: string): boolean {
  return CELL_MARKUP_RE.test(s);
}

/** Render ONE table/sheet cell's string value to HTML: inline markdown + `$math$` (sanitized)
 *  when it carries markup, else just escaped text. Shared by the live Base view
 *  (via `hasInlineMarkup` + `renderInline` in renderValue.tsx) and the HTML/PDF/PNG export
 *  serializers (rowsHtml.ts, sheetHtml.ts) so a cell renders identically on screen and in a
 *  download. */
export function renderCellHtml(s: string): string {
  return hasInlineMarkup(s) ? renderInline(s) : escapeHtml(s);
}
