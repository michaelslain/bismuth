// core/src/memoryRef.ts
// The `??slug` MEMORY REFERENCE syntax — what `[[Wikilink]]` is for a vault note, but pointing at a
// 3rd-brain memory note (`<vault>/.daemon/memory/<slug>.md`). `??slug` is the SYNTAX, not just an
// autocomplete trigger: it PERSISTS in the saved markdown, and is re-resolved on every read.
//
// Pure + dependency-free (like its siblings `wikilinks.ts` / `tags.ts`) so the editor autocomplete,
// the live-preview decorator, the markdown→HTML renderer and any headless caller all share ONE
// definition of the grammar instead of each re-spelling the regex.
//
// GRAMMAR — `??` + a slug, where:
//   • the `??` must sit at start-of-input or after whitespace/`(`. This is what keeps prose like
//     `really??` / `what??` literal (a word char precedes the `??`), mirroring the `#tag` rule.
//   • the slug must START with a word char and then may contain word chars, `-`, and `/` (memory
//     notes are kebab-case; `/` supports a subfoldered memory dir, whose node id is a rel path).
//
// The leading-word-char requirement is load-bearing beyond prose: a line whose entire content is
// `??` is the SRS multi-reversed flashcard separator (`core/src/srs/parser.ts` matches
// `l.trim() === "??"`). Because a ref needs at least one slug char, a bare `??` line can never
// parse as a memory ref — flashcards keep working untouched.

/** The 3rd brain's on-disk home, relative to the vault root. Memory is gated on the daemon: when
 *  `settings.daemon.enabled` is off this directory is not a graph source at all, so there are no
 *  memory candidates and the `??` picker simply never opens (see `memoryCandidates` in App.tsx). */
export const MEMORY_DIR = ".daemon/memory";

/** The `mem:` namespace `core/src/memory.ts` gives every memory graph node. */
const MEM_PREFIX = "mem:";

/** Slug characters after the first: word chars, `-` (kebab-case) and `/` (subfolders). */
const SLUG_TAIL = String.raw`[\w/-]*`;
/** A slug: a leading word char (never `-`/`/`, and never empty) + the tail. */
const SLUG = String.raw`\w${SLUG_TAIL}`;

/** Scanner for rendering surfaces: every `??slug` in a source string. Capture 1 is the character
 *  that had to precede the `??` (start-of-line, whitespace or `(`) — re-emit it; capture 2 is the
 *  slug. `g` + `lastIndex`: always use with `.matchAll`/`.replace`, never a bare `.test`. */
export const MEMORY_REF_RE = new RegExp(String.raw`(^|[\s(])\?\?(${SLUG})`, "g");

/** The autocomplete TRIGGER: the caret sits just after `??` + an optional partial slug. Unlike
 *  `MEMORY_REF_RE` the slug may be EMPTY, so a bare `??` opens the picker the way `[[` opens the
 *  note picker. `$`-anchored so it matches the rightmost `??` before the caret. */
const OPEN = new RegExp(String.raw`(?:^|\s)\?\?(${SLUG_TAIL})$`);

/** Match an open `??…` at the end of `textBefore` (the line text left of the caret).
 *  Returns the offset where the SLUG starts (just past the `??`) + the partial slug typed. */
export function matchMemoryRefPrefix(
  textBefore: string,
): { from: number; query: string } | null {
  const m = textBefore.match(OPEN);
  if (!m) return null;
  // The chars before the query are the optional leading whitespace plus `??`, so the query
  // starts that many chars into the match (mirrors matchTagPrefix).
  return { from: (m.index ?? 0) + (m[0].length - m[1].length), query: m[1] };
}

/** True when this line is the SRS multi-reversed flashcard separator (a line that is exactly `??`).
 *  In that position an open `??` picker must not swallow Enter — see `srsSeparatorEnterGuard` in
 *  `app/src/editor/autocomplete.ts`. */
export function isSrsSeparatorLine(lineText: string): boolean {
  return lineText.trim() === "??";
}

/** A memory note offered by the picker / used for resolution. `slug` is the note's id relative to
 *  the memory dir (a `mem:` node id with the prefix stripped — may contain `/`); `label` is its
 *  basename, which is what the picker shows. */
export type MemoryCandidate = { label: string; slug: string };

/** Strip the graph's `mem:` namespace from a memory node id → the slug. */
export function memorySlugFromNodeId(id: string): string {
  return id.startsWith(MEM_PREFIX) ? id.slice(MEM_PREFIX.length) : id;
}

/** The vault-relative path a `??slug` points at. Memory notes are real files under the vault, so
 *  this is an ordinary path the app can open / read like any other note. */
export function memoryRefPath(slug: string): string {
  return `${MEMORY_DIR}/${slug}.md`;
}

/** Resolve a typed slug against the known memory notes. Exact slug (full rel path) wins over a
 *  basename match — the same precedence `resolveNotePath` uses for wikilinks. Returns the resolved
 *  slug (NOT the path) so callers can map it themselves; null when nothing matches. */
export function resolveMemorySlug(
  slug: string,
  candidates: MemoryCandidate[],
): string | null {
  const bySlug = candidates.find((c) => c.slug === slug);
  if (bySlug) return bySlug.slug;
  const byLabel = candidates.find((c) => c.label === slug);
  return byLabel ? byLabel.slug : null;
}

/** Text to insert when a memory note is picked: the slug, replacing the partial query. The caret
 *  lands just past it. `??` itself is left in place (the trigger match starts AFTER it), so the
 *  saved markdown reads `??slug` — the persisted reference. */
export function buildMemoryRefInsert(slug: string): { insert: string; cursorOffset: number } {
  return { insert: slug, cursorOffset: slug.length };
}
