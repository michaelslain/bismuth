/** Regex pattern to match wikilinks: [[target]], [[target|display]], [[target#anchor]].
 *  The negative lookbehind `(?<!!)` skips EMBEDS (`![[target]]`): an embed is a
 *  render-only directive (image/PDF/audio/video/note transclusion), not a graph
 *  relationship, so it must not produce a link edge. Plain `[[link]]` is unaffected
 *  (only a `!` immediately before `[[` is excluded). */
const WIKILINK_REGEX = /(?<!!)\[\[([^\]]+?)\]\]/g;

/**
 * Blank out fenced (``` / ~~~) and inline (`) code spans so that tags/wikilinks
 * inside code don't pollute the graph or the change fingerprint. Code regions are
 * replaced with spaces (newlines preserved) so character offsets and line/whitespace
 * context (e.g. a tag's `(?:^|\s)` boundary) are unaffected for the surrounding prose.
 *
 * Shared by extractWikilinks and extractTags. Mirrors the editor's live-preview, which
 * also skips code fences when rendering links/tags.
 */
export function stripCode(md: string): string {
  // Fast path: the only code regions stripped below are backtick spans/fences and
  // `~~~` fences. A note containing neither delimiter has nothing to strip, so return
  // it unchanged — this skips two full-content regex passes for the ~95% of notes with
  // no code, the single biggest cost in the vault graph build.
  if (md.indexOf("`") === -1 && md.indexOf("~~~") === -1) return md;

  // Replace each matched code region with a same-length run that keeps newlines but
  // drops every other character, so nothing inside reads as a tag or link.
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");

  let out = md;
  // Fenced blocks first: a fence opener (``` or ~~~, optional info string) on its own
  // line through the matching closing fence (or end of document if unterminated).
  out = out.replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\3[^\n]*(?=\n|$)|$)/g, (m) => blank(m));
  // Inline code spans: one or more backticks, then the shortest run up to a matching
  // backtick run on the same line.
  out = out.replace(/(`+)(?:(?!\1)[^\n])*?\1/g, (m) => blank(m));
  return out;
}

export function extractWikilinks(md: string): string[] {
  // Fast path: no "[[" anywhere means no wikilinks, so skip the code-strip and the
  // matchAll scan entirely (~45% of notes have no wikilinks).
  if (md.indexOf("[[") === -1) return [];
  const masked = stripCode(md);
  const targets = new Set<string>();
  for (const match of masked.matchAll(WIKILINK_REGEX)) {
    const raw = match[1];
    // Extract the target, ignoring pipe (display text) and anchor (#hash)
    const target = raw.split("|")[0].split("#")[0].trim();
    if (target) targets.add(target);
  }
  return [...targets];
}
