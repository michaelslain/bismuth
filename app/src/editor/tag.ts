// app/src/editor/tag.ts
// Pure, DOM-free helper for `#tag` autocomplete. NO CodeMirror imports here, so it
// runs under `bun test` without a browser environment.
import { matchTriggerPrefix } from "./prefixMatch";

// A tag is `#` at start-of-line or after whitespace, followed by tag chars (word
// chars, `/` for nested tags, `-`). Requiring start-of-line/whitespace before the `#`
// excludes markdown headings (`# ` / `## ` have a space), `##` markers, and mid-word
// `#` such as `C#`.
const TAG = /(?:^|\s)#([\w/-]*)$/;

export function matchTagPrefix(
  textBefore: string,
): { from: number; query: string } | null {
  // The trigger (optional leading whitespace + `#`) precedes the captured query, so
  // matchTriggerPrefix reports `from` at the query start — just past the `#`.
  return matchTriggerPrefix(textBefore, TAG);
}
