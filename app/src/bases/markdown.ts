import { marked } from "marked";

// GFM + single-newline line breaks. Content is the user's own vault text (trusted),
// rendered into card faces; we inject it as innerHTML.
marked.use({ gfm: true, breaks: true });

/** Render a markdown string to HTML (synchronous). */
export function renderMarkdown(src: string): string {
  return marked.parse(src ?? "", { async: false }) as string;
}
