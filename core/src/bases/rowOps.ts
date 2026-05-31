import { parseBaseFile } from "./parse";
import { serializeRows } from "./rows";
import type { Row } from "./types";

const FM_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/;

type Meta = { name: string; path: string };

function emptyFile(meta: Meta): Row["file"] {
  return { name: meta.name, basename: meta.name, path: meta.path, folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] };
}

/** Rebuild the file: keep the frontmatter block verbatim, replace the body with the YAML rows. */
function reassemble(text: string, rows: Row[]): string {
  const m = text.match(FM_RE);
  const fm = m ? m[1].replace(/\n*$/, "\n") : "";
  const body = serializeRows(rows);
  return body ? `${fm}\n${body}\n` : fm;
}

/** Insert (index === null) or replace (index >= 0) a row in a base file. */
export function upsertRow(text: string, meta: Meta, index: number | null, note: Record<string, unknown>): string {
  if (!meta.name || !meta.path) throw new Error("meta.name and meta.path are required");
  const { rows } = parseBaseFile(text, meta);
  const newRow: Row = { file: rows[0]?.file ?? emptyFile(meta), note, formula: {} };
  if (index == null) rows.push(newRow);
  else rows[index] = newRow;
  return reassemble(text, rows);
}

/** Remove the row at `index` from a base file. */
export function deleteRow(text: string, meta: Meta, index: number): string {
  const { rows } = parseBaseFile(text, meta);
  if (index < 0 || index >= rows.length) throw new Error(`row index out of range: ${index}`);
  rows.splice(index, 1);
  return reassemble(text, rows);
}
