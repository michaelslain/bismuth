// app/src/export/mdTable.ts
import type { TableData } from "./baseTable";

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function tableToMarkdown(t: TableData): string {
  const cols = t.columns.length ? t.columns : ["name"];
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = t.rows.map((cells) => `| ${cells.map(escapeCell).join(" | ")} |`);
  return [header, sep, ...body].join("\n") + "\n";
}
