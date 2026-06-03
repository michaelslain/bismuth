// app/src/export/rowsHtml.ts
import type { TableData } from "./baseTable";
import { escapeHtml } from "./htmlTemplate";

export function tableToHtml(t: TableData): string {
  const cols = t.columns.length ? t.columns : ["name"];
  const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = t.rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}
