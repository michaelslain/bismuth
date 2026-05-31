import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Row, FileMeta } from "./types";
import { parseMarkdownTable } from "./table";

const EMPTY_FILE: Omit<FileMeta, "name" | "path" | "basename"> = {
  folder: "",
  ext: "md",
  size: 0,
  ctime: 0,
  mtime: 0,
  tags: [],
  links: [],
};

function looksLikeTable(body: string): boolean {
  // a GFM table: a header line with a pipe followed by a |---|---| separator
  return /^[^\n]*\|[^\n]*\n\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/m.test(body);
}

/**
 * Parse a base file's body into rows. The canonical form is a YAML list of objects;
 * a GFM markdown table is still read as a fallback (so older table-based bases load).
 */
export function parseRows(body: string, meta: { name: string; path: string }): Row[] {
  const trimmed = body.trim();
  if (trimmed === "") return [];

  // Back-compat: a markdown table body.
  if (looksLikeTable(trimmed)) return parseMarkdownTable(body, meta);

  // Canonical: a YAML list of row objects.
  let doc: unknown;
  try {
    doc = parseYaml(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(doc)) return [];
  // Base rows are not distinct notes — leave file.name empty (path keeps the base file
  // for write-back) so it isn't auto-shown as a meaningless repeated column.
  return doc
    .filter((r) => r && typeof r === "object")
    .map((note) => ({
      file: { ...EMPTY_FILE, name: "", basename: "", path: meta.path },
      note: note as Record<string, unknown>,
      formula: {},
    }));
}

/** Serialize rows to the canonical YAML-list body. */
export function serializeRows(rows: Row[]): string {
  if (rows.length === 0) return "";
  // Drop undefined values so empty cells don't serialize as `key: null`.
  const clean = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.note)) if (v !== undefined) out[k] = v;
    return out;
  });
  return stringifyYaml(clean).trimEnd();
}
