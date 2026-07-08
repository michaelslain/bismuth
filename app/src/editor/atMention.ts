// app/src/editor/atMention.ts
// Pure, DOM-free matcher for the chat composer's `@file` mention (Row 79a): typing `@` opens a
// fuzzy switcher over EVERY vault file, and picking one inserts a `[[wikilink]]` reference. NO
// CodeMirror imports here, so this runs under `bun test` without a browser environment (mirrors
// tag.ts / wikilink.ts). Composer-only — the note editor never wires this source in.

// One `@file` candidate shown in the popup: `label` is what's displayed + inserted (the wikilink
// target — a note basename, or a full filename for non-markdown files), `path` is the real vault
// path (used to wire the reference into the chat context), `folder` is the top-level folder shown
// as autocomplete detail. Same shape as NoteCandidate, but spans every file, not just notes.
export type FileCandidate = { label: string; path: string; folder?: string };

// `@` at start-of-line or after whitespace, then the query. Vault file names can contain spaces, so
// the query greedily takes the rest of the line up to the caret — but stops at another `@` so each
// `@…` mention is its own token (a second `@` starts a fresh match). Requiring start-of-line or
// whitespace before the `@` keeps it from firing inside an email address (`a@b`) or a mid-word `@`.
const AT = /(?:^|\s)@([^@\n]*)$/;

/** Match an open `@query` mention at the caret. Returns `from` — the document offset of the `@`
 *  ITSELF (so the completion replaces the whole `@query` span with the inserted `[[wikilink]]`) —
 *  and the raw `query` text typed after it. Null when the caret isn't inside an open `@` mention. */
export function matchAtMentionPrefix(
  textBefore: string,
): { from: number; query: string } | null {
  const m = textBefore.match(AT);
  if (!m) return null;
  // m[0] is (optional leading whitespace) + "@" + query; m[1] is the query. The `@` is the last
  // char of the (whitespace + "@") prefix, i.e. one before where the query starts.
  const queryStart = (m.index ?? 0) + (m[0].length - m[1].length);
  return { from: queryStart - 1, query: m[1] };
}

/** Rank file candidates for a `@query`: case-insensitive substring on the label OR the path, with
 *  label-prefix hits first, then other label hits, then path-only hits — so the closest name floats
 *  to the top. An empty query returns the list unranked (offer everything). Pure so it's unit-tested
 *  without a browser; the completion source just slices the top N and maps them to popup options. */
export function rankFileCandidates(files: FileCandidate[], query: string): FileCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  const prefix: FileCandidate[] = [];
  const label: FileCandidate[] = [];
  const path: FileCandidate[] = [];
  for (const f of files) {
    const l = f.label.toLowerCase();
    if (l.startsWith(q)) prefix.push(f);
    else if (l.includes(q)) label.push(f);
    else if (f.path.toLowerCase().includes(q)) path.push(f);
  }
  return [...prefix, ...label, ...path];
}
