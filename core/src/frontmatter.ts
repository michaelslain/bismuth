import { parse } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(md: string): Frontmatter {
  const m = md.match(FM);
  if (!m) return { data: {}, body: md };
  const data = (parse(m[1]) ?? {}) as Record<string, unknown>;
  return { data, body: md.slice(m[0].length) };
}
