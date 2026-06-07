import { marked } from "marked";
import { sanitizeHtml } from "../sanitizeHtml";

// GFM + single-newline line breaks. marked passes raw HTML in the markdown
// straight through (Obsidian-style passthrough), so the result is sanitized
// before it is injected as innerHTML (card faces, calendar descriptions, `.md`
// transclusion, md export).
marked.use({ gfm: true, breaks: true });

/** Render a markdown string to sanitized HTML (synchronous). */
export function renderMarkdown(src: string): string {
  return sanitizeHtml(marked.parse(src ?? "", { async: false }) as string);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    return `<a class="oa-wikilink" data-href="${escapeAttr(path)}">${escapeText(label)}</a>`;
  });
}

/** Render a NOTE body to sanitized HTML — like `renderMarkdown`, but also resolves
 *  Obsidian `[[wikilinks]]` into clickable anchors. Use for any surface that renders
 *  a vault note's own body (cards, transclusion) rather than arbitrary markdown. */
export function renderNoteBody(src: string): string {
  return renderMarkdown(wikilinksToAnchors(src ?? ""));
}
