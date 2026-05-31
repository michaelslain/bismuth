import { parseList, normalizeTag } from "./schema/coerce";

/** Regex to match inline tags: #tag-name (preceded by whitespace or line start). */
const INLINE_TAG_REGEX = /(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

export function extractTags(data: Record<string, unknown>, body: string): string[] {
  const tags = new Set<string>();

  // Frontmatter `tags`: YAML sequence OR comma-separated string. parseList is
  // comma-split only (so multi-word tags survive), array passthrough, null -> [].
  for (const item of parseList(data.tags)) {
    const tag = normalizeTag(item);
    if (tag) tags.add(tag);
  }

  // Extract tags from markdown body (#tag patterns)
  for (const match of body.matchAll(INLINE_TAG_REGEX)) {
    const tag = match[1].trim();
    if (tag) tags.add(tag);
  }

  return [...tags];
}
