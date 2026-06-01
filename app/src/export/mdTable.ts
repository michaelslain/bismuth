// app/src/export/mdTable.ts
import type { Row } from "../../../core/src/bases/types";

export function deriveColumns(rows: Row[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.note ?? {})) keys.add(k);
  return ["name", ...Array.from(keys).sort()];
}

export function cellValue(row: Row, col: string): string {
  const raw = col === "name" ? (row.file?.name ?? "") : (row.note?.[col]);
  if (raw == null) return "";
  if (Array.isArray(raw)) return raw.map(String).join(", ");
  return String(raw);
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function rowsToMarkdownTable(rows: Row[]): string {
  const cols = deriveColumns(rows);
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (r) => `| ${cols.map((c) => escapeCell(cellValue(r, c))).join(" | ")} |`,
  );
  return [header, sep, ...body].join("\n") + "\n";
}
