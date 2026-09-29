// Pure logic behind BaseSettings' SAVE: which frontmatter keys to write or delete.
//
// A base has ONE view, and every key of it is a plain TOP-LEVEL frontmatter key: the kind is
// `view: <kind>` (never `type` — top-level `type` is `base`), the view's own settings (`sort`,
// `groupBy`, `limit`, `lat`, …) sit beside the base's (`filters`, `source`, `formulas`,
// `properties`). So a plan is just set/delete ops on top-level keys, computed against the
// PARSED config the panel opened with (whose `filters` already ANDs a legacy `views:` entry's
// filters and whose `source` already prefers that entry's). The server flattens a legacy
// `views:` file (`flattenBaseViews`) before the first write, so it becomes flat on save.
//
// One rule remains: `source:` in object form makes the string-form siblings (`where`, `from`,
// `ref`) dead, so writing or clearing `source` deletes them too.
//
// Also holds the panel's other pure decisions — which kinds show which sections, the per-kind
// column bindings, the keys a kind manages — and nothing else: SAVE's I/O lives in baseSettingsIO.ts.
// Framework-free so every rule is unit-tested (baseSettingsPlan.test.ts).

import type { ViewType } from '../../../core/src/bases/types'
import type { SelectOption } from '../ui/Select'

export type WriteOp =
    | { op: 'set'; key: string; value: unknown }
    | { op: 'delete'; key: string }

/** A set of changed keys; `undefined` means "remove this key". */
export type Patch = Record<string, unknown>

/** The shorthand top-level keys a `source:` STRING reads its fields from — dead once the
 *  source is written in object form, so they go with it. */
const SOURCE_SIBLINGS = ['where', 'from', 'ref'] as const

/** The top-level write ops for a patch of changed keys. */
export function planSettingsWrites(patch: Patch): WriteOp[] {
    const ops: WriteOp[] = []
    for (const [k, v] of Object.entries(patch))
        ops.push(
            v === undefined
                ? { op: 'delete', key: k }
                : { op: 'set', key: k, value: v },
        )
    // The legacy `calendarContent` spelling goes whenever `mode` is written (viewMode() reads
    // either; an explicit mode wins, but a leftover calendarContent is a second, stale answer).
    if ('mode' in patch) ops.push({ op: 'delete', key: 'calendarContent' })
    if ('source' in patch)
        for (const s of SOURCE_SIBLINGS) ops.push({ op: 'delete', key: s })
    return ops
}

/** The keys whose desired value differs from the value the panel opened with (JSON-compared;
 *  undefined and absent are the same). Only `keys` are considered, so switching the view's kind
 *  never deletes the settings of the kind it switched away from. */
export function diffPatch(
    initial: Record<string, unknown>,
    desired: Record<string, unknown>,
    keys: readonly string[],
): Patch {
    const out: Patch = {}
    for (const k of keys)
        if (stableJson(initial[k]) !== stableJson(desired[k]))
            out[k] = desired[k]
    return out
}

/** JSON with object keys sorted (arrays keep their order) — a map whose keys merely came back
 *  in a different order is not a change worth writing. */
function stableJson(v: unknown): string {
    return JSON.stringify(v, (_k, val) =>
        val && typeof val === 'object' && !Array.isArray(val)
            ? Object.fromEntries(
                  Object.keys(val as object)
                      .sort()
                      .map(k => [k, (val as Record<string, unknown>)[k]]),
              )
            : val,
    )
}

// ---------------------------------------------------------------------------------------
// Form text → frontmatter values (what an emptied field means: remove the key)
// ---------------------------------------------------------------------------------------

/** A typed number, or undefined when the field is empty / not a finite number. */
export function numberOrUndefined(text: string): number | undefined {
    if (text.trim() === '') return undefined
    const n = Number(text)
    return Number.isFinite(n) ? n : undefined
}

/** A positive whole-number row limit, or undefined (no limit). */
export function limitOrUndefined(text: string): number | undefined {
    const n = numberOrUndefined(text)
    return n !== undefined && n > 0 ? Math.floor(n) : undefined
}

/** A map `center`, only when BOTH coordinates are numbers. */
export function centerOrUndefined(
    lat: string,
    lng: string,
): { lat: number; lng: number } | undefined {
    const a = numberOrUndefined(lat)
    const b = numberOrUndefined(lng)
    return a !== undefined && b !== undefined ? { lat: a, lng: b } : undefined
}

/** '' → undefined, anything else as-is — for pickers whose "default" choice means "no key". */
export function orUndefined(v: string): string | undefined {
    return v === '' ? undefined : v
}

// ---------------------------------------------------------------------------------------
// Which kinds show which sections
// ---------------------------------------------------------------------------------------

/** Record view types get column-visibility + sort + group-by config. */
const RECORD_KINDS: readonly ViewType[] = [
    'table',
    'cards',
    'list',
    'bullets',
    'kanban',
    'map',
]

/** Chart view types get aggregate + date-bucket config. */
const CHART_KINDS: readonly ViewType[] = ['heatmap', 'bar', 'line', 'stat']

export const isRecordKind = (k: ViewType): boolean => RECORD_KINDS.includes(k)
export const isChartKind = (k: ViewType): boolean => CHART_KINDS.includes(k)
/** Kanban gets column visibility/order from the Properties section instead. */
export const showsColumns = (k: ViewType): boolean =>
    isRecordKind(k) && k !== 'kanban'
export const showsMode = (k: ViewType): boolean =>
    isRecordKind(k) || k === 'calendar'

// ---------------------------------------------------------------------------------------
// Column bindings (which column means what), per kind
// ---------------------------------------------------------------------------------------

export interface FieldDef {
    key: string
    /** Short role label shown next to the column dropdown. */
    role: string
    def: string
    /** Optional fields offer a "none" choice, labelled `noneLabel`. */
    optional?: boolean
    noneLabel?: string
    hint: string
}

// Chart views (heatmap/bar/line/stat) all bind the same axis columns.
const CHART_FIELDS: FieldDef[] = [
    {
        key: 'x',
        role: 'X axis',
        def: 'date',
        hint: 'column plotted along the x axis — a date or a category.',
    },
    {
        key: 'y',
        role: 'Value',
        def: '',
        optional: true,
        noneLabel: 'count rows',
        hint: 'numeric column to aggregate. leave unset to count rows.',
    },
]

const FIELDS_BY_KIND: Partial<Record<ViewType, FieldDef[]>> = {
    flashcards: [
        {
            key: 'frontField',
            role: 'Front',
            def: 'front',
            hint: 'column shown as the card front (the prompt).',
        },
        {
            key: 'backField',
            role: 'Back',
            def: 'back',
            hint: 'column revealed as the answer.',
        },
        {
            key: 'dueField',
            role: 'Due',
            def: 'due',
            hint: "column holding each card's next-review date.",
        },
        {
            key: 'easeField',
            role: 'Ease',
            def: 'ease',
            hint: "column holding each card's SM-2 ease factor.",
        },
        {
            key: 'intervalField',
            role: 'Interval',
            def: 'interval',
            hint: "column holding each card's review interval, in days.",
        },
    ],
    map: [
        {
            key: 'lat',
            role: 'Latitude',
            def: 'lat',
            hint: 'column holding each place’s latitude, in decimal degrees.',
        },
        {
            key: 'lng',
            role: 'Longitude',
            def: 'lng',
            hint: 'column holding each place’s longitude, in decimal degrees.',
        },
    ],
    cards: [
        {
            key: 'image',
            role: 'Image',
            def: '',
            optional: true,
            noneLabel: 'text cover',
            hint: 'column holding a cover image — a url or a vault image path.',
        },
    ],
    heatmap: CHART_FIELDS,
    bar: CHART_FIELDS,
    line: CHART_FIELDS,
    stat: CHART_FIELDS,
}

const NO_FIELDS: FieldDef[] = []

/** The column bindings a kind offers (none for most). */
export const fieldsFor = (k: ViewType): FieldDef[] =>
    FIELDS_BY_KIND[k] ?? NO_FIELDS

/** Every field binding across every kind, once each (x/y are shared by the charts). */
export const ALL_FIELDS: FieldDef[] = [
    ...new Map(
        Object.values(FIELDS_BY_KIND)
            .flat()
            .map(f => [f!.key, f!]),
    ).values(),
]

/** Options for a column-binding dropdown: the available columns, always unioned with the
 *  field's current value + default so an off-screen binding still shows. */
export function columnBindingOptions(
    f: FieldDef,
    current: string,
    columns: string[],
): SelectOption[] {
    const seen = new Set(columns)
    const extra = [current, f.def].filter(c => c && !seen.has(c))
    return [
        ...(f.optional ? [{ value: '', label: f.noneLabel ?? 'none' }] : []),
        ...columns.map(c => ({ value: c, label: c })),
        ...extra.map(c => ({ value: c, label: c })),
    ]
}

/** The keys the CURRENT kind manages — switching kind never deletes another kind's settings. */
export function viewKeysFor(k: ViewType): string[] {
    const keys = ['view', 'filters', 'source']
    if (showsMode(k)) keys.push('mode')
    if (isRecordKind(k) || isChartKind(k)) keys.push('limit')
    if (isRecordKind(k)) keys.push('sort', 'groupBy')
    if (showsColumns(k)) keys.push('order')
    if (k === 'kanban') keys.push('hideLabels')
    if (k === 'table') keys.push('summaries')
    keys.push(...fieldsFor(k).map(f => f.key))
    if (k === 'flashcards') keys.push('bidirectional')
    if (isChartKind(k)) keys.push('aggregate')
    if (isChartKind(k) && k !== 'heatmap') keys.push('bin')
    if (k === 'map') keys.push('zoom', 'center')
    if (k === 'cards') keys.push('cardContent', 'imageFit', 'imageAspectRatio')
    return keys
}

// ---------------------------------------------------------------------------------------
// The open property row
// ---------------------------------------------------------------------------------------

/** Which row stays open after row `removed` is deleted (null = none open). */
export function indexAfterRemove(
    open: number | null,
    removed: number,
): number | null {
    if (open === null || open === removed) return null
    return open > removed ? open - 1 : open
}

/** Which row stays open after rows `a` and `b` swap places — it follows its content. */
export function indexAfterMove(
    open: number | null,
    a: number,
    b: number,
): number | null {
    return open === a ? b : open === b ? a : open
}
