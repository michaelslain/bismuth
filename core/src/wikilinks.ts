/** Regex pattern to match wikilinks: [[target]], [[target|display]], [[target#anchor]]. */
const WIKILINK_REGEX = /\[\[([^\]]+?)\]\]/g;

export function extractWikilinks(md: string): string[] {
  const targets = new Set<string>();
  for (const match of md.matchAll(WIKILINK_REGEX)) {
    const raw = match[1];
    // Extract the target, ignoring pipe (display text) and anchor (#hash)
    const target = raw.split("|")[0].split("#")[0].trim();
    if (target) targets.add(target);
  }
  return [...targets];
}
