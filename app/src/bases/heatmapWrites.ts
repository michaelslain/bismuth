// Pure decision logic for heatmap-square interaction — kept out of HeatmapView.tsx/BaseView.tsx
// so "what does a click DO" is one small, fully unit-tested module instead of being buried in
// two components' event handlers. See CLAUDE.md's heatmap write-seam comment on BaseView.tsx for
// how a day's rows get resolved before calling into this module.
import { propName } from '../../../core/src/bases/chartText'

/** Where the heatmap's rows come from — decides both what a click does and what it writes to.
 *  `'base'`: the base file's own row table IS the data (no `source:` on the view/base) — no
 *  daily notes required. `'query'`: rows come from a notes/tasks source — squares map to notes,
 *  and a note's OWN frontmatter is the write target, never the base file. */
export type HeatmapOrigin = 'base' | 'query'

export type DayAction =
    | { kind: 'edit'; current: number | undefined }
    | { kind: 'toggle' }
    | { kind: 'drill'; message: string }

export interface DayActionInput {
    origin: HeatmapOrigin
    /** The view's aggregate is `count` (or has no `y` at all) — squares count ROWS, not a value. */
    isCount: boolean
    /** `Tue Jul 8`-style label (heatmapLayout.ts's `dayLabel`) for the message text. */
    dateLabel: string
    /** How many rows/notes land on this day. */
    rowCount: number
    /** The day's current aggregated value, when there is exactly one contributing row. */
    current: number | undefined
}

/**
 * What clicking a square should do. A base-owned numeric chart edits a single row's value
 * directly UNLESS more than one row already shares the day (nothing to disambiguate which row a
 * typed number belongs to, so that opens the read-only drill instead). A base-owned count chart
 * always toggles — day present/absent is the whole story, so multiple rows just means "delete
 * them all". A query-sourced chart only ever edits when there is exactly one note behind the
 * square; every other case (no note, several notes, or the chart is counting rows rather than
 * plotting one) has nowhere unambiguous to write, so it drills instead.
 */
export function dayAction(input: DayActionInput): DayAction {
    const { origin, isCount, dateLabel, rowCount, current } = input
    if (origin === 'base') {
        if (isCount) return { kind: 'toggle' }
        if (rowCount <= 1) return { kind: 'edit', current }
        return { kind: 'drill', message: `${rowCount} entries — edit in the table` }
    }
    // query origin — never toggles; a note's existence isn't the heatmap's to create.
    if (!isCount && rowCount === 1) return { kind: 'edit', current }
    if (rowCount === 0) return { kind: 'drill', message: `no note on ${dateLabel}` }
    if (rowCount === 1) return { kind: 'drill', message: '1 note — open to edit' }
    return { kind: 'drill', message: `${rowCount} notes — open one to edit` }
}

/** One row's write handles + its current note, exactly as much as `planSetValue`/`planToggle`
 *  need — never the full `Row` type, so this module stays independent of `core/src/bases/types`
 *  wiring and easy to construct directly in tests. */
export interface WriteRow {
    /** Present only for a base-owned row (`Row.index`); undefined for a query-sourced note. */
    index?: number
    /** The file a write targets: the base file for a base-owned row, the note itself for query. */
    path: string
    note: Record<string, unknown>
}

export type WriteIntent =
    | { kind: 'none' }
    | { kind: 'create'; note: Record<string, unknown> }
    | { kind: 'update'; index: number; note: Record<string, unknown> }
    | { kind: 'delete'; index: number }
    | { kind: 'delete-many'; indices: number[] }
    | { kind: 'set-property'; path: string; key: string; value: number }

/** Decide the write for saving a typed number on a day — the `edit` action's Enter/blur. Base
 *  origin: no row yet → `rowCreate` with `{[x]: date, [y]: n}`; an existing row → `rowUpdate`
 *  merging `n` into its note, or `rowDelete` when the field was cleared (or entered as 0) on an
 *  existing row so a "0" doesn't linger as a phantom logged day. Query origin writes the note's
 *  own frontmatter via `setProperty`, keyed WITHOUT the `note.`/`formula.` prefix `y` may carry
 *  (`propName`, the same stripping `chartText.ts`'s caption uses) — and does nothing when
 *  cleared, since deleting a note's property isn't this control's job. */
export function planSetValue(params: {
    origin: HeatmapOrigin
    xKey: string
    yKey: string
    date: string
    row: WriteRow | undefined
    entered: number | undefined
}): WriteIntent {
    const { origin, xKey, yKey, date, row, entered } = params
    if (origin === 'query') {
        if (!row || entered === undefined) return { kind: 'none' }
        return { kind: 'set-property', path: row.path, key: propName(yKey), value: entered }
    }
    if (!row) {
        if (entered === undefined || entered === 0) return { kind: 'none' }
        return { kind: 'create', note: { [xKey]: date, [yKey]: entered } }
    }
    if (row.index === undefined) return { kind: 'none' }
    if (entered === undefined || entered === 0) return { kind: 'delete', index: row.index }
    return { kind: 'update', index: row.index, note: { ...row.note, [yKey]: entered } }
}

/** Decide the write for the `toggle` action (base-owned, counting rows) — empty day → `rowCreate`
 *  with just `{[x]: date}`; a filled day → delete every row on it, highest index first so an
 *  earlier delete never shifts a later one's index out from under it. */
export function planToggle(params: {
    xKey: string
    date: string
    rows: WriteRow[]
}): WriteIntent {
    const { xKey, date, rows } = params
    if (rows.length === 0) return { kind: 'create', note: { [xKey]: date } }
    const indices = rows
        .map(r => r.index)
        .filter((i): i is number => i !== undefined)
        .sort((a, b) => b - a)
    if (indices.length === 0) return { kind: 'none' }
    return { kind: 'delete-many', indices }
}

/** The write seam HeatmapView is handed by BaseView — undefined when the view has no write
 *  target at all (an inline ```query block with no base file), in which case every square is
 *  read-only and a click only ever opens the drill list. */
export type HeatmapWriteSeam = {
    origin: HeatmapOrigin
    isCount: boolean
    onSetDay: (date: string, value: number | undefined) => Promise<void>
    onToggleDay: (date: string) => Promise<void>
}
