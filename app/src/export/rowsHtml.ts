// app/src/export/rowsHtml.ts
import type { TableData } from "./baseTable";
import { escapeHtml } from "./htmlTemplate";
import { renderCellHtml } from "../bases/markdown";

export function tableToHtml(t: TableData): string {
  const cols = t.columns.length ? t.columns : ["name"];
  // Headers are plain labels (escaped); data cells render inline markdown + `$math$` via the
  // SAME renderer the live Base view uses (renderValue.tsx), so an exported table matches
  // what's on screen instead of emitting literal `$x^2$`.
  const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = t.rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${renderCellHtml(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}
