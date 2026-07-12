// Pure helpers behind the kanban card's property rendering — extracted from the
// components (like flashcardsQueue) so they're unit-testable without JSX.

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

/** Whether a meta value is worth a row on the card — empties are dropped entirely (no "—"
 * placeholder cluttering cards). `false` counts as empty (renderValue draws a false checkbox
 * as nothing, which would leave a dangling label), as does an array with no non-empty elements. */
export function hasValue(v: unknown): boolean {
  if (v == null || v === false) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.some(hasValue);
  return true;
}
