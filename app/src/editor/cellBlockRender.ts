// app/src/editor/cellBlockRender.ts
// The table-cell DISPLAY face, rendered through the FULL BLOCK markdown engine (#15, the
// user-requested "block thing"): a cell's source renders exactly like a note body in reading
// mode — real `<ul>/<ol>/<li>` lists, paragraphs, nested lists — via the SAME shared renderer
// every reading surface uses (bases/markdown.ts `renderNoteBody`: marked with `breaks:true`,
// KaTeX math with progressive upgrade, `[[wikilink]]` anchors, `#tag` spans, code masking,
// iridescent bismuth, DOMPurify sanitize). This supersedes the previous inline-tokens +
// `<br>`-marker convention (cellList/inlineMarkdown) for the DISPLAY face only:
//
//   • the EDIT face (raw source with real line breaks on focus) is untouched;
//   • the READ-BACK (cellSourceFromDom → `<br>`-joined single-line source) is untouched;
//   • only what the idle cell SHOWS changes engine.
//
// The bridge between the two worlds is one line: the cell's stored `<br>` markers (a GFM cell
// is a single source line; `<br>` is its break carrier) become real newlines before the block
// parse — so `- a<br>- b<br>- c` parses as a real 3-item list, and `line one<br>line two`
// stays two lines (the reader's marked instance sets `breaks:true`).
//
// EMBEDS need special handling: the reader engine doesn't resolve `![[img.png]]` (embed
// transclusion is editor-side), and its DOMPurify pass would strip a PDF `<iframe>`. So embeds
// are cut out BEFORE the block render into inert `<span class="cm-cell-embed-slot">`
// placeholders (span + data-attrs survive sanitize), and `upgradeCellEmbeds` swaps each slot
// for the real media DOM AFTER innerHTML assignment — reusing the exact same `renderEmbedHtml`
// (images / pdf iframes / audio / video / note-chip fallback with GET /asset URLs) the inline
// renderer used, so #30 image-into-cell drops render identically.
import { renderNoteBody, maskCode, unmaskCode } from "../bases/markdown";
import { renderEmbedHtml } from "./inlineMarkdown";
import { escapeAttr } from "../htmlEscape";

/** A cell's stored single-line source → block markdown: every `<br>`/`<br/>` marker becomes a
 *  real newline for the block parser. Pure. */
export function cellSourceToBlockMarkdown(src: string): string {
  return src.replace(/<br\s*\/?>/gi, "\n");
}

// `![[target]]` wiki embeds + `![alt](url)` markdown images (same shapes tokenizeInline split).
const WIKI_EMBED_RE = /!\[\[([^\]\n]+?)\]\]/g;
const MD_IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const embedSlot = (wiki: boolean, target: string, alt: string | null): string =>
  `<span class="cm-cell-embed-slot" data-wiki="${wiki ? "1" : "0"}" data-target="${escapeAttr(target)}"` +
  (alt != null ? ` data-alt="${escapeAttr(alt)}"` : "") +
  `></span>`;

/** Render a cell's markdown source to sanitized BLOCK HTML — the note reader's engine over the
 *  `<br>`→newline source, with embeds slotted out (see the module note; call `upgradeCellEmbeds`
 *  on the element after assigning this as innerHTML). Pure string → string. */
export function renderCellBlockHtml(src: string): string {
  // Mask code first so an embed-looking string inside a code span stays literal.
  const { masked, codes } = maskCode(src ?? "");
  const slotted = masked
    .replace(WIKI_EMBED_RE, (_m, target: string) => embedSlot(true, target.trim(), null))
    .replace(MD_IMAGE_RE, (_m, alt: string, url: string) => embedSlot(false, url, alt));
  return renderNoteBody(cellSourceToBlockMarkdown(unmaskCode(slotted, codes)));
}

/** Swap every embed slot in a rendered cell for its real media DOM (img / pdf iframe / audio /
 *  video / clickable note chip), built by the shared `renderEmbedHtml` with the injected
 *  GET /asset URL builder — after the sanitizer, exactly like the pre-block-render path did. */
export function upgradeCellEmbeds(cell: HTMLElement, assetUrl: (target: string) => string): void {
  for (const slot of Array.from(cell.querySelectorAll<HTMLElement>("span.cm-cell-embed-slot"))) {
    const wiki = slot.getAttribute("data-wiki") === "1";
    const target = slot.getAttribute("data-target") ?? "";
    const alt = slot.getAttribute("data-alt");
    const tmp = cell.ownerDocument.createElement("div");
    tmp.innerHTML = renderEmbedHtml({ type: "embed", wiki, target, alt }, assetUrl);
    slot.replaceWith(...Array.from(tmp.childNodes));
  }
}
