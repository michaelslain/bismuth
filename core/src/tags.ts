const INLINE_TAG = /(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

/**
 * Extract and normalize tags from parsed frontmatter data and markdown body.
 *
 * Frontmatter `data.tags` may be:
 *   - string[]   e.g. ["foo", "bar"]
 *   - string     e.g. "foo, bar" or "#prefixed"
 *
 * Body inline tags: #word-chars (not headings, because headings have `# ` with a space).
 *
 * Returns: deduplicated, trimmed, non-empty tag strings (case preserved).
 */
export function extractTags(data: Record<string, unknown>, body: string): string[] {
  const seen = new Set<string>();

  // --- Frontmatter tags ---
  const raw = data.tags;
  if (raw !== undefined && raw !== null) {
    const candidates: string[] = [];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") candidates.push(item);
      }
    } else if (typeof raw === "string") {
      // Could be "foo" or "foo, bar" or "foo bar"
      candidates.push(...raw.split(/[,\s]+/));
    }
    for (const c of candidates) {
      const t = c.replace(/^#/, "").trim();
      if (t) seen.add(t);
    }
  }

  // --- Inline body tags ---
  for (const m of body.matchAll(INLINE_TAG)) {
    const t = m[1].trim();
    if (t) seen.add(t);
  }

  return [...seen];
}
