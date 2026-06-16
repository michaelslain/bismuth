// app/src/export/sheetHtml.ts
import { renderCellHtml } from "../bases/markdown";

interface CellLike { v?: unknown }
interface SheetLike { cellData?: Record<string, Record<string, CellLike>> }

function firstSheet(snap: any): SheetLike | null {
  const sheets = snap?.sheets;
  if (!sheets || typeof sheets !== "object") return null;
  const order: string[] = Array.isArray(snap.sheetOrder) ? snap.sheetOrder : Object.keys(sheets);
  for (const id of order) if (sheets[id]) return sheets[id];
  return null;
}

export function snapshotToHtmlTable(snap: any): string {
  const sheet = firstSheet(snap);
  const cellData = sheet?.cellData ?? {};
  let maxRow = -1, maxCol = -1;
  for (const r of Object.keys(cellData)) {
    maxRow = Math.max(maxRow, Number(r));
    for (const c of Object.keys(cellData[r] ?? {})) maxCol = Math.max(maxCol, Number(c));
  }
  const rowsHtml: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const v = cellData[r]?.[c]?.v;
      // Render inline markdown + `$math$` (sanitized) so a sheet cell exports the same way
      // it shows on screen; plain values stay escaped text.
      cells.push(`<td>${v == null ? "" : renderCellHtml(String(v))}</td>`);
    }
    rowsHtml.push(`<tr>${cells.join("")}</tr>`);
  }
  return `<table>\n<tbody>\n${rowsHtml.join("\n")}\n</tbody>\n</table>`;
}
