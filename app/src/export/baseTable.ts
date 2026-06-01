// app/src/export/baseTable.ts
// Resolve a .base file to a flat table the SAME way the live BaseView does:
// parseBase -> resolve the base's source (notes/tasks/base, defaulting to all
// notes) -> runView, which applies the base's filters, formulas, sort and column
// selection. We then flatten the resulting ViewResult to plain string cells so the
// HTML/Markdown exporters don't need the bases engine. This is why a filters-style
// base (filters: + views:, no source:) exports its real rows instead of nothing.
import { parseBase } from "../../../core/src/bases/parse";
import { runView, resolveProperty } from "../../../core/src/bases/query";
import type { ExportDeps } from "./types";
import type { Row, BaseConfig, ViewResult } from "../../../core/src/bases/types";

export interface TableData {
  columns: string[];   // display labels (header row)
  rows: string[][];    // one string[] per data row, aligned to columns
}

// Header label for a column id — mirrors app/src/bases/renderValue.ts columnLabel,
// inlined here so the export path doesn't import the JSX/Icon UI module (which is
// client-only and can't load under the test runner or in a worker).
function columnLabel(id: string, config: BaseConfig): string {
  const custom = config.properties?.[id]?.displayName;
  if (custom) return custom;
  if (id.startsWith("file.") || id.startsWith("note.") || id.startsWith("this.")) return id.slice(5);
  if (id.startsWith("formula.")) return id.slice(8);
  return id;
}

// Mirror renderValue's value-to-text mapping (minus the JSX) so exported cells read
// the same as the on-screen table.
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function viewResultToTable(config: BaseConfig, vr: ViewResult): TableData {
  const ids = vr.columns;
  const rows = vr.groups.flatMap((g) => g.rows).map(
    (r: Row) => ids.map((id) => cellText(resolveProperty(id, r))),
  );
  return { columns: ids.map((id) => columnLabel(id, config)), rows };
}

// Read a .base file and resolve it to a flat table. The source defaults to all
// vault notes (kind: "notes") when the base declares only filters: — runView then
// narrows them, exactly as the live view does.
export async function baseToTable(path: string, deps: ExportDeps): Promise<TableData> {
  const config = parseBase(await deps.read(path));
  const allRows = await deps.resolveRows(config.source ?? { kind: "notes" });
  return viewResultToTable(config, runView(config, allRows, 0));
}
