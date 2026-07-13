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
