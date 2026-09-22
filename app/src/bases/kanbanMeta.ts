// Pure helpers behind the kanban card's property rendering — extracted from the
// components (like flashcardsQueue) so they're unit-testable without JSX.
import type { Schema } from '../../../core/src/schema/types'
import { bareName } from './propertyEdit'

/** The view's `order:` ids to show as meta on each card: everything except the title
 * column. Description is NOT special-cased (#103) — a base that declares (or an `order:`
 * that lists) `description`/`note.description` flows through here like any other
 * property, rendered + edited via the same generic type-aware meta path. */
export function metaColumns(
    order: string[] | undefined,
    titleCol: string,
): string[] {
    return (order ?? []).filter(id => id !== titleCol)
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
    if (order && order.length) return order
    if (declared && declared.length) {
        if (!groupByProperty) return columns
        // Compare in bare-frontmatter form so `status`, `note.status` and a `note.status`
        // column id all line up regardless of which spelling the config used.
        const bare = (id: string) => (id.startsWith('note.') ? id.slice(5) : id)
        const gb = bare(groupByProperty)
        return columns.filter(c => bare(c) !== gb)
    }
    return undefined
}

/** Whether a meta value is worth a row on the card — empties are dropped entirely (no "—"
 * placeholder cluttering cards). `false` counts as empty (renderValue draws a false checkbox
 * as nothing, which would leave a dangling label), as does an array with no non-empty elements. */
export function hasValue(v: unknown): boolean {
    if (v == null || v === false) return false
    if (typeof v === 'string') return v.trim() !== ''
    if (Array.isArray(v)) return v.some(hasValue)
    return true
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
export function metaVisible(
    id: string,
    value: unknown,
    schema: Schema,
): boolean {
    if (schema[bareName(id)]?.type === 'boolean') return true
    if (typeof value === 'boolean') return true
    return hasValue(value)
}

/** Which `order:` id is the TITLE for a board that owns its own rows (no `source:` — a card
 * is a row in the base's own body, not a note, so there is no `file.name` to bind to). The
 * first `order:` id that resolves to a writable note property; `title` when the view
 * declares no writable column at all (still a valid frontmatter key to write under, even
 * though nothing currently reads it back as a heading — the row's own `title` property). */
export function storedTitleColumn(order: string[]): string {
    return order.find(id => writableKey(id) !== null) ?? 'title'
}

/** Which of a column's CURRENT rows is the real row a stored-row optimistic add resolved
 * to — the one whose CONTENT was NOT present before the add was made, and whose written
 * property carries the value the add wrote. Returns that row's id, or `undefined` when the
 * real row hasn't landed yet (nothing new, or nothing new matching).
 *
 * Exists because the server APPENDS a stored row to the base file's raw row array
 * (core/src/bases/rowOps.ts `upsertRow`), not at a position this view's filtered/grouped
 * index can predict — a `filters:` block, or any row this view drops, makes a client-guessed
 * index wrong, and a wrong guess means the optimistic placeholder's rowId never matches the
 * real one and lingers forever (a permanent ghost duplicate). Matching by "new since the add"
 * + "carries the written value" needs no index at all.
 *
 * `priorSnapshots` is a set of the pre-add rows' CONTENT (e.g. `JSON.stringify(storedNote(r))`),
 * not their ids. Ids are the wrong thing to diff against: `rowOps.ts`'s `rows.splice(index, 1)`
 * (a delete, possibly of an unrelated row, landing between the add and this resolve) shifts
 * every later row's id down by one, so the newly-added row can land at an id a PRIOR row already
 * held — an id-keyed "was this id here before" check then wrongly excludes it forever. A row's
 * content survives that shift unchanged, so a content-keyed check is immune to it. */
/** Not airtight under concurrency: two rapid same-column adds from this client, or another
 * client's concurrent add of an identical value, can both match the same "new since the add"
 * row and cross-claim each other's placeholder. The visible effect is a brief flicker (a
 * placeholder resolving to the wrong sibling's real row for one refetch) — the board is
 * correct again once every in-flight add has resolved, since each add's own value eventually
 * lands on some row and the content-keyed match self-corrects on the next refetch. */
export function matchedStoredRowId(
    rows: { id: string; snapshot: string; value: unknown }[],
    priorSnapshots: Set<string>,
    matchValue: unknown,
): string | undefined {
    const want = JSON.stringify(matchValue)
    return rows.find(
        r => !priorSnapshots.has(r.snapshot) && JSON.stringify(r.value) === want,
    )?.id
}

/** Resolve the frontmatter key to WRITE for a property id, or null when the id names a
 * non-writable derived namespace (`file.`/`formula.`/`this.` — a filesystem fact or a
 * computed value, not a stored property). Shared by KanbanView (groupBy writes on drop)
 * and KanbanCard (the meta chip editor) so both agree on what's editable. */
export function writableKey(property: string): string | null {
    if (
        property.startsWith('file.') ||
        property.startsWith('formula.') ||
        property.startsWith('this.')
    ) {
        return null
    }
    if (property.startsWith('note.')) return property.slice(5)
    return property // bare property name
}
