// Header label for a column id. Pure + dependency-free (no JSX/Icon UI) so both the
// live BaseView (renderValue.tsx) and the export path (export/baseTable.ts) can share
// it — the export path can't import the JSX/Icon module under the test runner / worker.
import type { BaseConfig } from "../../../core/src/bases/types";

export function columnLabel(id: string, config: BaseConfig): string {
  const customLabel = config.properties?.[id]?.displayName;
  if (customLabel) return customLabel;
  if (id.startsWith("file.")) return id.slice(5);
  if (id.startsWith("note.")) return id.slice(5);
  if (id.startsWith("this.")) return id.slice(5);
  if (id.startsWith("formula.")) return id.slice(8);
  return id;
}
