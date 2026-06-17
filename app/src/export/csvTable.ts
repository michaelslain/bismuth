// app/src/export/csvTable.ts
// Flat-table -> CSV (the "data" export companion to mdTable.ts). RFC-4180 quoting:
// a field is wrapped in double quotes when it contains a comma, a quote, or a newline,
// and embedded quotes are doubled. Cells already carry the same display text as the
// on-screen table (via baseTable.cellText), so CSV matches what's shown.
import type { TableData } from "./baseTable";

function escapeCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableToCsv(t: TableData): string {
  const cols = t.columns.length ? t.columns : ["name"];
  const header = cols.map(escapeCell).join(",");
  const body = t.rows.map((cells) => cells.map(escapeCell).join(","));
  // CRLF line endings per RFC-4180 (spreadsheets accept LF too, but CRLF is the spec).
  return [header, ...body].join("\r\n") + "\r\n";
}
