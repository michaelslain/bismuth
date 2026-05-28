import { parse, stringify, parseDocument } from "yaml";

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
 * Preserves the original YAML formatting (flow vs block arrays, key order,
 * quoting, comments) by editing via the `yaml` Document API rather than
 * round-tripping through a plain object. Preserves the body verbatim. If the
 * note had no frontmatter, a new block is prepended ahead of the existing body.
 */
export function setFrontmatterKey(md: string, key: string, value: unknown): string {
  const m = md.match(FM);
  if (!m) {
    // No existing frontmatter: synthesise a fresh block.
    return `---\n${stringify({ [key]: value })}---\n${md}`;
  }
  const fmText = m[1];
  const body = md.slice(m[0].length);
  try {
    const doc = parseDocument(fmText);
    doc.set(key, value);
    // `flowCollectionPadding: false` keeps flow arrays tight: `[book, fiction]`
    // rather than `[ book, fiction ]`. The previous default added padding on
    // every untouched flow array. Comma-space inside is still emitted by the
    // library, so the result matches Obsidian's idiom.
    let out = doc.toString({ flowCollectionPadding: false });
    if (!out.endsWith("\n")) out += "\n";
    return `---\n${out}---\n${body}`;
  } catch {
    // Malformed YAML: fall back to a clean rewrite via the parsed object.
    const { data } = parseFrontmatter(md);
    data[key] = value;
    return `---\n${stringify(data)}---\n${body}`;
  }
}
