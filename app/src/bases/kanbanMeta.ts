// Pure helpers behind the kanban card's read-only meta section — extracted from the
// components (like flashcardsQueue) so they're unit-testable without JSX.

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
