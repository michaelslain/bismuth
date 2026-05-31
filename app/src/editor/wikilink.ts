// app/src/editor/wikilink.ts
// Pure, DOM-free helpers for wikilink autocomplete. NO CodeMirror imports here, so
// these run under `bun test` without a browser environment.

// `label` is the basename (what gets inserted + shown in autocomplete); `path` is the
// note's real vault path (the graph node id), needed to resolve a clicked wikilink to
// the file on disk; `folder` is the top-level folder, shown as autocomplete detail.
export type NoteCandidate = { label: string; path: string; folder?: string };

// The cursor (end of `textBefore`) sits inside an open `[[…` with no closing `]]` yet.
// `[^\]\n]*` after `[[` ensures we only match while the link is still open, and the
// `$` anchor makes `.match` pick the rightmost such `[[` on the line.
const OPEN = /\[\[([^\]\n]*)$/;

export function matchWikilinkPrefix(
  textBefore: string,
): { from: number; query: string } | null {
  const m = textBefore.match(OPEN);
  if (!m) return null;
  // m.index points at the `[[`; the query starts two characters later.
  return { from: (m.index ?? 0) + 2, query: m[1] };
}

// Parse the inside of a `[[…]]` token (the text between the brackets) into its parts.
// Obsidian syntax is `[[target#heading|alias]]`: `#` precedes `|`. `display` is what to
// show off the cursor line — the alias if given, else the target's basename (last path segment).
export function parseWikilink(inner: string): {
  target: string;
  alias?: string;
  heading?: string;
  display: string;
} {
  const pipe = inner.indexOf("|");
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
  const beforeAlias = pipe === -1 ? inner : inner.slice(0, pipe);
  const hash = beforeAlias.indexOf("#");
  const heading = hash === -1 ? undefined : beforeAlias.slice(hash + 1).trim();
  const target = (hash === -1 ? beforeAlias : beforeAlias.slice(0, hash)).trim();
  const basename = target.slice(target.lastIndexOf("/") + 1);
  const result: { target: string; alias?: string; heading?: string; display: string } = {
    target,
    display: alias || basename,
  };
  if (alias) result.alias = alias;
  if (heading) result.heading = heading;
  return result;
}

// Given a `[[…]]` match — `inner` is the text between the brackets, `start` is the
// document offset of the opening "[[" — return the [from, to) document slice to *reveal*
// in live preview: the alias if present, else the target's basename. Everything else
// (the brackets, any folder path, the "#heading") falls outside this range and is hidden.
export function wikilinkVisibleRange(inner: string, start: number): { from: number; to: number } {
  const innerStart = start + 2; // skip the opening "[["
  const pipe = inner.indexOf("|");
  if (pipe !== -1) {
    // alias: from just after "|" to the end of the inner text (before the closing "]]")
    return { from: innerStart + pipe + 1, to: innerStart + inner.length };
  }
  const hash = inner.indexOf("#");
  const targetLen = hash === -1 ? inner.length : hash;
  const basenameStart = inner.slice(0, targetLen).lastIndexOf("/") + 1;
  return { from: innerStart + basenameStart, to: innerStart + targetLen };
}

// Resolve a wikilink target (a basename like "My Note" or a full path like
// "reading/My Note") to a real note path. Wikilinks are filename-based, so a bare
// basename must be looked up against the vault's notes. Exact path wins over basename.
// Returns null when nothing matches (caller treats it as a brand-new note).
export function resolveNotePath(
  target: string,
  notes: { label: string; path: string }[],
): string | null {
  const byPath = notes.find((n) => n.path === target);
  if (byPath) return byPath.path;
  const byBase = notes.find((n) => n.label === target);
  return byBase ? byBase.path : null;
}

// Text to insert when a note is chosen. Append the closing `]]` only when it isn't
// already immediately ahead (avoids `]]]]`); the cursor always lands just past `]]`.
export function buildInsert(
  label: string,
  hasClosingAhead: boolean,
): { insert: string; cursorOffset: number } {
  return {
    insert: hasClosingAhead ? label : label + "]]",
    // Cursor lands just past the closing `]]`, whether we inserted it (label + "]]")
    // or it was already ahead — hence `+ 2` in both branches.
    cursorOffset: label.length + 2,
  };
}
