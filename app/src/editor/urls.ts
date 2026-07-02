// app/src/editor/urls.ts
// Pure, DOM-free helper for detecting *bare* (inexplicit) URLs in a line of text — a
// plain `https://…` typed without markdown `[text](url)` syntax. Used both to decorate
// them as links in live preview and to resolve a click to its URL in Editor.tsx, so the
// two stay in lockstep. No CodeMirror imports, so it runs under `bun test`.

export interface UrlSpan {
  start: number; // offset of the first char of the URL within `text`
  end: number; // offset just past the last char of the URL
  url: string; // text.slice(start, end)
}

// `http(s)://` followed by any run of non-space, non-delimiter chars. We stop at
// whitespace and the brackets/quotes that would never belong to a URL; trailing
// sentence punctuation is trimmed afterwards (see below) so "see https://x.com." or
// "(https://x.com)" don't swallow the period / closing paren.
const URL_RE = /https?:\/\/[^\s<>"'`\]}]+/g;

// Punctuation that commonly trails a URL in prose but isn't part of it.
const TRAILING = new Set([".", ",", ";", ":", "!", "?"]);

// Hoisted: used via .match() (which resets lastIndex before scanning), called per
// trim iteration inside findBareUrls's hot loop.
const OPEN_PAREN_RE = /\(/g;
const CLOSE_PAREN_RE = /\)/g;

/** Find every bare URL in `text`, skipping those that are the destination of a markdown
 *  link (`](url)`) — those are handled by the markdown-link path, not as bare URLs. */
export function findBareUrls(text: string): UrlSpan[] {
  const spans: UrlSpan[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    // Skip a URL sitting inside `](…)`: it's a markdown link's target, not a bare URL.
    if (text.slice(start - 2, start) === "](") continue;

    let url = m[0];
    // Trim trailing sentence punctuation, and a closing `)` that has no matching `(`
    // inside the URL (so "(https://x.com)" → "https://x.com" but a balanced
    // "https://en.wikipedia.org/wiki/Foo_(bar)" keeps its paren).
    let trimmed = true;
    while (trimmed && url.length) {
      trimmed = false;
      const last = url[url.length - 1];
      if (TRAILING.has(last)) {
        url = url.slice(0, -1);
        trimmed = true;
      } else if (last === ")") {
        const opens = (url.match(OPEN_PAREN_RE) ?? []).length;
        const closes = (url.match(CLOSE_PAREN_RE) ?? []).length;
        if (closes > opens) {
          url = url.slice(0, -1);
          trimmed = true;
        }
      }
    }
    if (!url.length) continue;
    spans.push({ start, end: start + url.length, url });
  }
  return spans;
}
