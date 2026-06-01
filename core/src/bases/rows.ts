import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Row } from "./types";
import { syntheticBaseFile } from "./types";
import { parseMarkdownTable } from "./table";

// Re-export for callers that expect the helper to live here.
export { EMPTY_FILE, syntheticBaseFile } from "./types";

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
      file: syntheticBaseFile(meta.path),
      note: note as Record<string, unknown>,
      formula: {},
    }));
}

/**
 * Serialize rows to the canonical YAML-list body.
 * If `columnOrder` is provided, properties are serialized in that order,
 * with any additional properties appended alphabetically at the end.
 * This preserves user-configured column order across edits.
 */
export function serializeRows(rows: Row[], columnOrder?: string[]): string {
  if (rows.length === 0) return "";
  // Drop undefined values so empty cells don't serialize as `key: null`.
  const clean = rows.map((r) => {
    const out: Record<string, unknown> = {};

    if (columnOrder && columnOrder.length > 0) {
      // First add keys in the specified order
      for (const key of columnOrder) {
        const v = r.note[key];
        if (v !== undefined) out[key] = v;
      }
      // Then add any additional keys not in columnOrder, in alphabetical order
      const additionalKeys = Object.keys(r.note)
        .filter((k) => !columnOrder.includes(k))
        .sort();
      for (const key of additionalKeys) {
        const v = r.note[key];
        if (v !== undefined) out[key] = v;
      }
    } else {
      // No column order specified: use the original order (YAML preserves insertion order)
      for (const [k, v] of Object.entries(r.note)) if (v !== undefined) out[k] = v;
    }

    return out;
  });
  return stringifyYaml(clean).trimEnd();
}
