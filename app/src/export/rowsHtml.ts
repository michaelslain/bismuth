// app/src/export/rowsHtml.ts
import type { Row } from "../../../core/src/bases/types";
import { deriveColumns, cellValue } from "./mdTable";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function rowsToHtmlTable(rows: Row[]): string {
  const cols = deriveColumns(rows);
  const head = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const body = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${esc(cellValue(r, c))}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}
