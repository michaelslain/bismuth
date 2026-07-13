// Pure helpers behind the kanban card's property rendering — extracted from the
// components (like flashcardsQueue) so they're unit-testable without JSX.
import type { Schema } from "../../../core/src/schema/types";
import { bareName } from "./propertyEdit";

// The frontmatter key a bare `description` in `order:` binds the editable slot to.
const DESCRIPTION_KEY = "description";

/** The frontmatter key holding the card's editable description, or null when the view doesn't
 * opt in. Description is NOT built-in: the slot exists only when the view's config lists it —
 * either an explicit `descriptionField:` or `description` in `order:` (bare or note.-spelled).
 * A board that never mentions a description renders no slot, no "Add a description…"
 * affordance, and writes no description key. */
export function descriptionField(order: string[] | undefined, explicit: string | undefined): string | null {
  if (explicit != null && explicit.trim() !== "") return explicit;
  const ids = order ?? [];
  if (ids.includes(DESCRIPTION_KEY) || ids.includes(`note.${DESCRIPTION_KEY}`)) return DESCRIPTION_KEY;
  return null;
}

/** The view's `order:` ids to show as read-only meta on each card: everything except the
 * title column and (when the view opted into one) the description field. The description is
 * excluded in BOTH spellings — `order` ids are conventionally note.-namespaced while
 * descriptionField is the bare frontmatter key, and a mismatch would render it twice. */
export function metaColumns(order: string[] | undefined, titleCol: string, descField: string | null): string[] {
  const skip = new Set(descField === null ? [titleCol] : [titleCol, descField, `note.${descField}`]);
  return (order ?? []).filter((id) => !skip.has(id));
}

/** Which id list feeds metaColumns: an explicit view `order:` always wins; without one, a
 * base that DECLARES its own properties (list-form `properties:` → config.declaredProperties)
 * shows the engine-resolved columns (which runView derived from that declaration), minus the
 * `groupBy` property — the column a card sits in already conveys it, and kanban deliberately
 * never echoes it unless an explicit `order:` opts in. A base with neither keeps today's
 * behavior — no meta (deriveColumns' row-frontmatter union would leak unrelated fields onto
 * cards). */
export function metaSource(
  order: string[] | undefined,
  declared: string[] | undefined,
  columns: string[],
  groupByProperty?: string,
): string[] | undefined {
  if (order && order.length) return order;
  if (declared && declared.length) {
    if (!groupByProperty) return columns;
    // Compare in bare-frontmatter form so `status`, `note.status` and a `note.status`
    // column id all line up regardless of which spelling the config used.
    const bare = (id: string) => (id.startsWith("note.") ? id.slice(5) : id);
    const gb = bare(groupByProperty);
    return columns.filter((c) => bare(c) !== gb);
  }
  return undefined;
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
