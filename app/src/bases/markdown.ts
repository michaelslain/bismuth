import { marked, type Token, type TokenizerAndRendererExtension } from "marked";
import { sanitizeHtml } from "../sanitizeHtml";
import { MEMORY_REF_RE, memoryRefPath } from "../../../core/src/memoryRef";
import { escapeHtml, escapeAttr } from "../htmlEscape";
import { renderMath, onMathReady } from "../editor/katexLoader";
import { parseCalloutHeader, renderCalloutHtml, type CalloutHeader } from "../editor/callout";
import { BISMUTH_SCAN_RE, bismuthWrapSource } from "../editor/bismuthWord";
import { renderCellListHtml } from "../editor/cellList";
import { specForWikiEmbed } from "../editor/embedSpec";
import { api } from "../api";

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

// ── Iridescent "bismuth" ──────────────────────────────────────────────────────
// Wrap every whole-word (case-insensitive) occurrence of the literal word "bismuth" in a
// `.bismuth-word` span, styled with a shimmering bismuth-crystal gradient (App.css) — mirroring the
// editor's live-preview `.cm-bismuth` decoration. Done as a source pre-pass (BEFORE marked) rather
// than an inline extension because marked re-tokenizes the text INSIDE pre-injected wikilink/tag
// anchors, which would leak the effect into a wikilink's label. Instead we MASK every region the
// effect must never touch — fenced/inline code, injected `<a>`/`<span>` elements + any other HTML
// tag, markdown links, `[[wikilinks]]`, and bare URLs — wrap "bismuth" in the remaining bare prose,
// then restore. Over-masking only ever SKIPS the effect on a rare edge (e.g. a `<`…`>` span of
// literal prose); it never corrupts marked's output, since every masked region is restored verbatim
// before marked ever sees it. The injected span passes through marked as inline HTML (its inner
// "bismuth" is plain text — no extension re-wraps it) and survives `sanitizeHtml` (span + class).
const BISMUTH_PROTECT_RE =
  /```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*?`+|<a\b[^>]*>[\s\S]*?<\/a>|<span\b[^>]*>[\s\S]*?<\/span>|<[^>]+>|\[\[[^\]]*?\]\]|\[[^\]]*?\]\([^)]*?\)|https?:\/\/[^\s<>)\]]+/gi;
function iridescentBismuth(src: string): string {
  // Shared mask → wrap → restore transform (editor/bismuthWord.ts) — this surface passes its own
  // protected-span set (fenced/inline code, injected <a>/<span> + any tag, wikilinks, md links,
  // bare URLs); the editable-table-cell renderer passes a different one.
  return bismuthWrapSource(src, BISMUTH_PROTECT_RE, (w) => `<span class="bismuth-word">${escapeHtml(w)}</span>`);
}

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
      // Centering in tables is not supported (#53): a `:-:` separator column still parses
      // (source round-trips untouched) but renders LEFT, matching the editor's table widget.
      const align = token.align === "center" ? null : token.align;
      return (align ? `<${tag} align="${align}">` : `<${tag}>`) + content + `</${tag}>\n`;
    },
  },
});

// A lone `<!-- pagebreak -->` comment line marks a PDF page boundary (invisible on screen + in
// Obsidian). DOMPurify STRIPS HTML comments, so convert the marker into a real, zero-height
// <div class="bismuth-page-break"> BEFORE sanitize — the div survives, the PDF rasterizer
// (htmlToPdf) slices a new page at it, and `height:0` (htmlTemplate.ts) makes it a no-op on every
// other surface. Masked like wikilinks/tags so a marker inside a code fence/span stays literal.
// Exported so export/pageBreaks.ts can split a note's raw markdown at the SAME marker (for the
// PNG exporter, which renders each page-break section to its own file — see that module).
export const PAGEBREAK_RE = /^[ \t]*<!--[ \t]*pagebreak[ \t]*-->[ \t]*$/gm;
function pageBreaksToDivs(src: string): string {
  const { masked, codes } = maskCode(src);
  // Surround the injected div with blank lines: a bare `<div>` starts a CommonMark type-6 HTML
  // block that swallows the following lines as raw HTML until the next blank line, so content
  // right after the marker (e.g. a `# Heading` from the `<!-- pagebreak -->\n$0` snippet) would
  // stop being parsed as markdown. The blank lines close the HTML block so the rest renders normally.
  return unmaskCode(masked.replace(PAGEBREAK_RE, '\n\n<div class="bismuth-page-break"></div>\n\n'), codes);
}

// ── Image embeds: `![[picture.png]]` → a real <img> ──────────────────────────────────────────
// `![[…]]` is Obsidian syntax marked knows nothing about, so WITHOUT this pass an image embed
// reaches the browser as literal `![[picture.png]]` text (renderMarkdown) or — once
// wikilinksToAnchors had rewritten the inner `[[…]]` — as a stray `!` followed by a broken
// `<a>` (renderNoteBody). Either way the picture is stored in the vault but VISIBLE NOWHERE,
// which is exactly why an image dropped onto a kanban card's `description` showed up as
// nothing. Convert the embed to an `<img>` pointing at the backend's `/asset` route on the raw
// source BEFORE marked parses it (marked passes injected HTML through, and the result is
// sanitized like every other rendered surface).
//
// Reuses the editor's OWN embed resolver (`specForWikiEmbed` + `api.assetUrl`), so a card face
// resolves `![[x]]` byte-identically to the note editor's embedBlock widget — one rule for what
// an embed means, including the `|WIDTH` / `|WxH` size alias. NON-image embeds (`![[Note]]`
// transclusion, pdf/audio/video) are deliberately left as raw source: a card face / table cell
// is no place to mount an iframe or a media player, and returning the match unchanged keeps
// their existing behavior exactly as it was.
const IMAGE_EMBED_RE = /!\[\[([^\]\n]+?)\]\]/g;
function imageEmbedsToImgs(src: string): string {
  return src.replace(IMAGE_EMBED_RE, (raw, inner: string) => {
    const spec = specForWikiEmbed(inner, api.assetUrl);
    if (!spec || spec.kind !== "image" || !spec.src) return raw; // not an image → leave source as-is
    const size = (spec.width ? `width:${spec.width}px;` : "") + (spec.height ? `height:${spec.height}px;` : "");
    return (
      `<img class="bismuth-embed-img" src="${escapeAttr(spec.src)}" alt="${escapeAttr(spec.alt ?? "")}"` +
      `${size ? ` style="${escapeAttr(size)}"` : ""} />`
    );
  });
}

/** Resolve `![[image.png]]` embeds to `<img>` while leaving code spans/fences untouched — a
 *  literal `![[x]]` inside backticks stays literal, exactly like the wikilink/tag passes. */
function imagesOutsideCode(src: string): string {
  const { masked, codes } = maskCode(src);
  return unmaskCode(imageEmbedsToImgs(masked), codes);
}

/** Render a markdown string to sanitized HTML (synchronous). */
export function renderMarkdown(src: string): string {
  return sanitizeHtml(
    marked.parse(iridescentBismuth(imagesOutsideCode(pageBreaksToDivs(src ?? ""))), { async: false }) as string,
  );
}

// Obsidian `[[wikilinks]]` aren't standard markdown, so `marked` would emit them
// verbatim (`[[Note]]`). Pre-convert them to anchors carrying the resolved path in
// `data-href`; a host (BodyCard) opens them via the global `bismuth-open` event — the
// same in-app navigation ListView uses. Done on the raw source, BEFORE marked, so
// the surrounding markdown (lists, headings, links) still renders normally and the
// anchor passes through marked's raw-HTML passthrough.
// The `(?<!!)` guard leaves an EMBED (`![[picture.png]]`) alone: its `[[…]]` is not a link to
// rewrite, it's the target of an embed that imageEmbedsToImgs renders as an <img> (or leaves as
// raw source for a non-image). Without the guard this pass ate the brackets first and emitted a
// stray `!` + a broken anchor, so an embedded image could never render.
const WIKILINK_RE = /(?<!!)\[\[([^\]\n]+?)\]\]/g;
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
// Exported so export/pageBreaks.ts can mask code the same way before splitting a note on
// PAGEBREAK_RE — a literal `<!-- pagebreak -->` inside a fenced/inline code span must not split
// the document.
export function maskCode(src: string): { masked: string; codes: string[] } {
  const codes: string[] = [];
  const masked = src.replace(CODE_MASK_RE, (m) => `\u0000${codes.push(m) - 1}\u0000`);
  return { masked, codes };
}
export function unmaskCode(s: string, codes: string[]): string {
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)] ?? "");
}
// `??slug` MEMORY REFERENCES — the 3rd-brain twin of a `[[wikilink]]`, and just as non-standard, so
// marked would emit them verbatim. Convert them to the SAME kind of anchor a wikilink produces,
// pointing at the memory note's real vault path (`.daemon/memory/<slug>.md`).
//
// The anchor deliberately carries `bismuth-wikilink` ALONGSIDE `bismuth-memory-ref`: every existing
// host already opens `a.bismuth-wikilink[data-href]` via the global `bismuth-open` event (the chat
// bubble's delegated click, the reader, export), so reusing that class means a memory ref navigates
// through the exact same machinery instead of a parallel one — `bismuth-memory-ref` only adds the
// distinct look. Runs alongside tagsToSpans/wikilinksToAnchors on the RAW source (before marked)
// with the same code-masking caveat, so a `??x` inside code stays literal.
const MEMORY_REF_SCAN_RE = new RegExp(MEMORY_REF_RE.source, "g");
function memoryRefsToAnchors(src: string): string {
  return src.replace(MEMORY_REF_SCAN_RE, (_m, pre: string, slug: string) =>
    `${pre}<a class="bismuth-wikilink bismuth-memory-ref" data-href="${escapeAttr(memoryRefPath(slug))}">${escapeHtml(slug)}</a>`,
  );
}

/** Resolve `[[wikilinks]]`, `??memory-refs` + `#tags` on the source while leaving code untouched. */
function linkifyOutsideCode(src: string): string {
  const { masked, codes } = maskCode(src);
  // Memory refs BEFORE tags: a slug can contain `/` and `-` but never `#`, so the two can't
  // overlap — but ordering after wikilinksToAnchors keeps a `??x` inside an injected anchor's
  // attributes (there are none today) out of reach, matching the tag pass's placement.
  return unmaskCode(tagsToSpans(memoryRefsToAnchors(wikilinksToAnchors(masked))), codes);
}

/** Render a NOTE body to sanitized HTML — like `renderMarkdown`, but also resolves
 *  Obsidian `[[wikilinks]]` into clickable anchors and styles `#tags`. Use for any surface
 *  that renders a vault note's own body (cards, transclusion) rather than arbitrary markdown. */
export function renderNoteBody(src: string): string {
  return renderMarkdown(linkifyOutsideCode(src ?? ""));
}

/** Render a single cell/line of markdown to sanitized INLINE HTML — emphasis, code, inline
 *  `$math$` (via the shared KaTeX renderer + progressive upgrade), `[[wikilinks]]`, `??memory-refs`
 *  and `#tags`, with NO block wrapping (`<p>`). Used by Base table/card cells so a cell renders
 *  the same markdown as the rest of the app. `marked.parseInline` runs the inline math
 *  extension above but not the block one, so `$$…$$` stays literal (correct for a cell). */
export function renderInline(src: string): string {
  // imagesOutsideCode runs INNERMOST so an `![[shot.png]]` in a cell renders as a real <img>
  // (the table-cell image drop) rather than as literal text, and so it is resolved before
  // wikilinksToAnchors sees the inner `[[…]]`. memoryRefsToAnchors stays in the chain (main) so
  // `??slug` refs still resolve in cells.
  return sanitizeHtml(
    marked.parseInline(iridescentBismuth(tagsToSpans(memoryRefsToAnchors(wikilinksToAnchors(imagesOutsideCode(src ?? ""))))), {
      async: false,
    }) as string,
  );
}

// Cheap gate: only run the markdown renderer on strings that actually carry inline markup
// (emphasis, code, a wikilink, a #tag, raw HTML, or `$math$`); plain values stay literal.
const CELL_MARKUP_RE = /[*_~`$]|\[\[|<[a-z/]|(?:^|\s)#[A-Za-z]|(?:^|[\s(])\?\?\w/;
export function hasInlineMarkup(s: string): boolean {
  // Also treat a bare "bismuth" as markup so a plain-text cell carrying the word still
  // routes through renderInline and picks up the iridescent gradient. BISMUTH_SCAN_RE is
  // stateless (no `g` flag), so `.test()` is safe here.
  return CELL_MARKUP_RE.test(s) || BISMUTH_SCAN_RE.test(s);
}

/** Render ONE table/sheet cell's string value to HTML: inline markdown + `$math$` (sanitized)
 *  when it carries markup, else just escaped text. Shared by the live Base view
 *  (via `hasInlineMarkup` + `renderInline` in renderValue.tsx) and the HTML/PDF/PNG export
 *  serializers (rowsHtml.ts, sheetHtml.ts) so a cell renders identically on screen and in a
 *  download. */
export function renderCellHtml(s: string): string {
  return hasInlineMarkup(s) ? renderInline(s) : escapeHtml(s);
}
