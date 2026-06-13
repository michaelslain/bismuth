import { marked } from "marked";
import { sanitizeHtml } from "../sanitizeHtml";
import { escapeHtml, escapeAttr } from "../htmlEscape";

// GFM + single-newline line breaks. marked passes raw HTML in the markdown
// straight through (Obsidian-style passthrough), so the result is sanitized
// before it is injected as innerHTML (card faces, calendar descriptions, `.md`
// transclusion, md export).
marked.use({ gfm: true, breaks: true });

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

/** Render a NOTE body to sanitized HTML — like `renderMarkdown`, but also resolves
 *  Obsidian `[[wikilinks]]` into clickable anchors and styles `#tags`. Use for any surface
 *  that renders a vault note's own body (cards, transclusion) rather than arbitrary markdown. */
export function renderNoteBody(src: string): string {
  return renderMarkdown(tagsToSpans(wikilinksToAnchors(src ?? "")));
}
