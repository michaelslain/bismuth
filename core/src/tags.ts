/** Regex to match inline tags: #tag-name (preceded by whitespace or line start). */
const INLINE_TAG_REGEX = /(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

export function extractTags(data: Record<string, unknown>, body: string): string[] {
  const tags = new Set<string>();

  // Extract tags from frontmatter `tags` field (array or comma-separated string)
  const raw = data.tags;
  if (raw !== undefined && raw !== null) {
    const items = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string")
      : typeof raw === "string"
        ? raw.split(/[,\s]+/)
        : [];

    for (const item of items) {
      const tag = item.replace(/^#/, "").trim();
      if (tag) tags.add(tag);
    }
  }

  // Extract tags from markdown body (#tag patterns)
  for (const match of body.matchAll(INLINE_TAG_REGEX)) {
    const tag = match[1].trim();
    if (tag) tags.add(tag);
  }

  return [...tags];
}
