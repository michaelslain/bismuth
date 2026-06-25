import { parseBaseFile, FRONTMATTER_RE } from "./parse";
import { serializeRows } from "./rows";
import type { Row } from "./types";
import type { BaseConfig } from "./types";

type Meta = { name: string; path: string };

function emptyFile(meta: Meta): Row["file"] {
  return { name: meta.name, basename: meta.name, path: meta.path, folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] };
}

/**
 * Rebuild the file: keep the frontmatter block verbatim, replace the body with the YAML rows.
 * Preserves the column order defined in the base config's first view (or the original data).
 */
export function reassemble(text: string, rows: Row[], config?: BaseConfig): string {
  const m = text.match(FRONTMATTER_RE);
  const fm = m ? m[1].replace(/\n*$/, "\n") : "";

  // Extract column order from the base config's first view (if present).
  // Only the view's explicit display `order` is a list of property ids; serializeRows
  // handles `undefined` by falling back to natural row key order. (We must NOT fall back
  // to `groupOrder` — that's a list of GROUP keys for a grouped view, not column ids,
  // and using it as columns would emit empty rows.)
  const columnOrder = config?.views?.[0]?.order;

  const body = serializeRows(rows, columnOrder);
  return body ? `${fm}\n${body}\n` : fm;
}

/** Insert (index === null) or replace (index >= 0) a row in a base file. */
export function upsertRow(text: string, meta: Meta, index: number | null, note: Record<string, unknown>): string {
  if (!meta.name || !meta.path) throw new Error("meta.name and meta.path are required");
  const { rows, config } = parseBaseFile(text, meta);
  const newRow: Row = { file: rows[0]?.file ?? emptyFile(meta), note, formula: {} };
  if (index == null) rows.push(newRow);
  else rows[index] = newRow;
  return reassemble(text, rows, config);
}

/** Remove the row at `index` from a base file. */
export function deleteRow(text: string, meta: Meta, index: number): string {
  const { rows, config } = parseBaseFile(text, meta);
  if (index < 0 || index >= rows.length) throw new Error(`row index out of range: ${index}`);
  rows.splice(index, 1);
  return reassemble(text, rows, config);
}

/** Move the row at `from` to position `to` (drag-reorder), rewriting the row order. */
export function reorderRow(text: string, meta: Meta, from: number, to: number): string {
  const { rows, config } = parseBaseFile(text, meta);
  if (from < 0 || from >= rows.length) throw new Error(`row index out of range: ${from}`);
  if (to < 0 || to >= rows.length) throw new Error(`row index out of range: ${to}`);
  if (from === to) return text;
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  return reassemble(text, rows, config);
}
