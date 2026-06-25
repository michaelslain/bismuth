import { marked, type TokenizerAndRendererExtension } from "marked";
import { sanitizeHtml } from "../sanitizeHtml";
import { escapeHtml, escapeAttr } from "../htmlEscape";
import { renderMath, onMathReady } from "../editor/katexLoader";

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
    for (const el of document.querySelectorAll<HTMLElement>("span.oa-math[data-math]")) {
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
  const cls = display ? "oa-math oa-math-display" : "oa-math";
  const html = renderMath(expr, display);
  if (html) return `<span class="${cls}">${html}</span>`;
  scheduleMathUpgrade();
  return `<span class="${cls}" data-math="${escapeAttr(expr)}" data-display="${display ? "1" : "0"}"></span>`;
}

const mathBlockExt: TokenizerAndRendererExtension = {
  name: "oaMathBlock",
  level: "block",
  start(src) { const i = src.indexOf("$$"); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (!m) return undefined;
    return { type: "oaMathBlock", raw: m[0], text: m[1].trim() };
  },
  renderer(token) { return mathHtml(String(token.text), true); },
};

const mathInlineExt: TokenizerAndRendererExtension = {
  name: "oaMathInline",
  level: "inline",
  start(src) { const i = src.indexOf("$"); return i < 0 ? undefined : i; },
  tokenizer(src) {
    // Single `$…$` (not `$$`), single line, no whitespace just inside either delimiter,
    // `\$` escapes a literal dollar — same rule as the editor's inlineMarkdown.
    const m = /^\$(?![\s$])((?:\\.|[^\n$])*?)(?<!\s)\$(?!\$)/.exec(src);
    if (!m) return undefined;
    return { type: "oaMathInline", raw: m[0], text: m[1] };
  },
  renderer(token) { return mathHtml(String(token.text), false); },
};

marked.use({ extensions: [mathBlockExt, mathInlineExt] });

/** Render a markdown string to sanitized HTML (synchronous). */
export function renderMarkdown(src: string): string {
  return sanitizeHtml(marked.parse(src ?? "", { async: false }) as string);
}

// Obsidian `[[wikilinks]]` aren't standard markdown, so `marked` would emit them
// verbatim (`[[Note]]`). Pre-convert them to anchors carrying the resolved path in
// `data-href`; a host (BodyCard) opens them via the global `oa-open` event — the
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
    return `<a class="oa-wikilink" data-href="${escapeAttr(path)}">${escapeHtml(label)}</a>`;
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
  return src.replace(TAG_RE, (_m, pre: string, tag: string) => `${pre}<span class="oa-tag">#${escapeHtml(tag)}</span>`);
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
