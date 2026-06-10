import { parse, stringify, parseDocument } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

/** Regex to match YAML frontmatter block at start of markdown (handles \r\n too). */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(md: string): Frontmatter {
  const m = md.match(FRONTMATTER_REGEX);
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
 * Mutate frontmatter in markdown: set a key, delete a key, or apply a mutation function.
 * Preserves YAML formatting (flow vs block arrays, key order, quoting, comments) by editing
 * via the `yaml` Document API. Falls back to stringify on malformed YAML.
 * Preserves body verbatim. If no frontmatter exists, prepends a new block.
 * If the last key is removed, drops the whole `---` block.
 */
function mutateFrontmatter(
  md: string,
  mutate: (doc: any, data: Record<string, unknown>, fmText: string) => { keep: boolean; result: string },
): string {
  const m = md.match(FRONTMATTER_REGEX);
  const fmText = m?.[1] ?? "";
  const body = m ? md.slice(m[0].length) : md;

  // Try Document API (preserves formatting).
  try {
    const doc = parseDocument(fmText);
    const { keep, result } = mutate(doc, doc.toJSON() as Record<string, unknown>, fmText);
    if (result) return result;
    if (!keep) return body; // Last key removed → body only.
    let out = doc.toString({ flowCollectionPadding: false });
    if (!out.endsWith("\n")) out += "\n";
    return `---\n${out}---\n${body}`;
  } catch {
    // Malformed YAML: fall back to stringify via parsed object.
    let data: Record<string, unknown> = {};
    try { data = (parse(fmText) ?? {}) as Record<string, unknown>; } catch { /* data stays {} */ }
    const { keep, result } = mutate({}, data, fmText);
    if (result) return result;
    if (!keep || Object.keys(data).length === 0) return body;
    return `---\n${stringify(data)}---\n${body}`;
  }
}

/**
 * Set a single frontmatter key on a note, returning the rewritten markdown.
 * Preserves the original YAML formatting (flow vs block arrays, key order,
 * quoting, comments) by editing via the `yaml` Document API rather than
 * round-tripping through a plain object. Preserves the body verbatim. If the
 * note had no frontmatter, a new block is prepended ahead of the existing body.
 */
export function setFrontmatterKey(md: string, key: string, value: unknown): string {
  const m = md.match(FRONTMATTER_REGEX);
  if (!m) {
    // No existing frontmatter: synthesise a fresh block.
    return `---\n${stringify({ [key]: value })}---\n${md}`;
  }
  return mutateFrontmatter(md, (doc, data) => {
    // Document.set() returns void, so branch explicitly rather than via ??.
    if (doc.set) doc.set(key, value);
    else data[key] = value;
    return { keep: true, result: "" };
  });
}

/**
 * Remove a single frontmatter key from a note, returning the rewritten markdown.
 * Preserves the rest of the YAML (order, formatting, other keys) and the body.
 * If the key isn't present, the note is returned unchanged. If removing the key
 * empties the frontmatter, the whole `---` block is dropped (no dangling fence or
 * blank line is left behind).
 */
export function deleteFrontmatterKey(md: string, key: string): string {
  const m = md.match(FRONTMATTER_REGEX);
  if (!m) return md; // no frontmatter — nothing to delete
  return mutateFrontmatter(md, (doc, data) => {
    const hasKey = doc.has?.(key) ?? (key in data);
    if (!hasKey) return { keep: true, result: m.input! }; // unchanged
    doc.delete?.(key);
    delete data[key];
    const isEmpty = Object.keys(data).length === 0;
    return { keep: !isEmpty, result: "" };
  });
}
