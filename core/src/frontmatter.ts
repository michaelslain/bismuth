import { parse, stringify } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(md: string): Frontmatter {
  const m = md.match(FM);
  if (!m) return { data: {}, body: md };
  // Real vaults contain notes with malformed YAML — tolerate it rather than crash.
  let data: Record<string, unknown> = {};
  try {
    data = (parse(m[1]) ?? {}) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { data, body: md.slice(m[0].length) };
}

/**
 * Set a single frontmatter key on a note, returning the rewritten markdown.
 * Preserves all other frontmatter keys and the body verbatim. If the note had
 * no frontmatter, a new block is prepended ahead of the existing body.
 */
export function setFrontmatterKey(md: string, key: string, value: unknown): string {
  const { data, body } = parseFrontmatter(md);
  data[key] = value;
  return `---\n${stringify(data)}---\n${body}`;
}
