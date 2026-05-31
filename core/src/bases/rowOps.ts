import { parseBaseFile } from "./parse";
import { rowsToMarkdownTable } from "./table";
import type { Row } from "./types";

const FM_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/;

type Meta = { name: string; path: string };

function emptyFile(meta: Meta): Row["file"] {
  return { name: meta.name, basename: meta.name, path: meta.path, folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] };
}

/** Stable column order: existing row keys (insertion order) plus any new keys. */
function columnsOf(rows: Row[], extra?: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  rows.forEach((r) => Object.keys(r.note).forEach((k) => keys.add(k)));
  if (extra) Object.keys(extra).forEach((k) => keys.add(k));
  return [...keys];
}

/** Rebuild the file text: keep the frontmatter block verbatim, replace the table body. */
function reassemble(text: string, columns: string[], rows: Row[]): string {
  const m = text.match(FM_RE);
  const fm = m ? m[1].replace(/\n*$/, "\n") : "";
  return `${fm}\n${rowsToMarkdownTable(columns, rows)}\n`;
}

/** Insert (index === null) or replace (index >= 0) a row in a base file's table. */
export function upsertRow(text: string, meta: Meta, index: number | null, note: Record<string, unknown>): string {
  const { rows } = parseBaseFile(text, meta);
  const newRow: Row = { file: rows[0]?.file ?? emptyFile(meta), note, formula: {} };
  if (index == null) rows.push(newRow);
  else rows[index] = newRow;
  return reassemble(text, columnsOf(rows, note), rows);
}

/** Remove the row at `index` from a base file's table. */
export function deleteRow(text: string, meta: Meta, index: number): string {
  const { rows } = parseBaseFile(text, meta);
  rows.splice(index, 1);
  return reassemble(text, columnsOf(rows), rows);
}
