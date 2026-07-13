// Pure helpers behind the kanban card's read-only meta section — extracted from the
// components (like flashcardsQueue) so they're unit-testable without JSX.
import type { Schema } from "../../../core/src/schema/types";
import { bareName } from "./propertyEdit";

/** The view's `order:` ids to show as read-only meta on each card: everything except the
 * title column and the description field. The description is excluded in BOTH spellings —
 * `order` ids are conventionally note.-namespaced while descriptionField is the bare
 * frontmatter key, and a mismatch would render the description twice. */
export function metaColumns(order: string[] | undefined, titleCol: string, descField: string): string[] {
  const skip = new Set([titleCol, descField, `note.${descField}`]);
  return (order ?? []).filter((id) => !skip.has(id));
}

/** Whether a meta value is worth a row on the card — empties are dropped entirely (no "—"
 * placeholder cluttering cards). `false` counts as empty (renderValue draws a false checkbox
 * as nothing, which would leave a dangling label), as does an array with no non-empty elements. */
export function hasValue(v: unknown): boolean {
  if (v == null || v === false) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.some(hasValue);
  return true;
}

/** Whether a kanban meta chip should render for property `id` holding `value` — like
 * `hasValue`, except a BOOLEAN property's chip always shows, even when the value is
 * `false`. `hasValue` treats `false` as empty (right for a bare read-only render — a false
 * checkbox draws as nothing), but the meta chip is the editor's only entry point: hiding a
 * `false` row would mean no chip to ever turn it on, and toggling `true`→`false` would make
 * the row (and the only way back to `true`) vanish out from under the click that caused it.
 * A property counts as boolean when EITHER the vault-wide registry declares it so (checked
 * first — the authoritative source for a property with no value yet, e.g. an unset
 * `done:`), or the value itself is already a runtime boolean (undeclared properties, where
 * the YAML-parsed value is the only type signal available). Everything else (unset
 * text/number/date/array properties) keeps the original `hasValue` behavior — no blank rows
 * for those. */
export function metaVisible(id: string, value: unknown, schema: Schema): boolean {
  if (schema[bareName(id)]?.type === "boolean") return true;
  if (typeof value === "boolean") return true;
  return hasValue(value);
}

/** Resolve the frontmatter key to WRITE for a property id, or null when the id names a
 * non-writable derived namespace (`file.`/`formula.`/`this.` — a filesystem fact or a
 * computed value, not a stored property). Shared by KanbanView (groupBy writes on drop)
 * and KanbanCard (the meta chip editor) so both agree on what's editable. */
export function writableKey(property: string): string | null {
  if (property.startsWith("file.") || property.startsWith("formula.") || property.startsWith("this.")) {
    return null;
  }
  if (property.startsWith("note.")) return property.slice(5);
  return property; // bare property name
}
