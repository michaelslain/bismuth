// Pure logic behind BaseSettings' SAVE: which frontmatter keys to write or delete, and where.
//
// Two scopes:
//   - VIEW keys (name, type, sort, filters, lat, …) belong to ONE view, `views[viewIndex]`.
//     They go through `setViewProperty`/`deleteViewProperty`, which the server resolves to
//     `views[i][key]` — or to a TOP-LEVEL key when the base has no `views:` array.
//   - BASE keys (source, filters, formulas, properties) are top-level and shared by every view.
//
// The traps this module exists to route around (core/src/bases/parse.ts):
//   1. A flat top-level copy of a view key (`sort:`, `x:`, `mode:` …) is folded onto views[0]
//      AFTER the views array is read, so it OVERRIDES views[0]. Writing views[0].sort while a
//      flat `sort:` exists would change nothing visible — so the flat copy is deleted.
//   2. Only SOME keys are folded that way (FLAT_VIEW_KEYS). A base with no `views:` array
//      can't hold the others at all: a flat `name:` / `limit:` / `lat:` is simply ignored, a
//      flat `filters:` / `source:` is the BASE-level key, and a flat `type:` would overwrite the
//      note's own `type: base`. Such a base is first PROMOTED to a one-entry `views:` array
//      (its flat keys keep folding onto that entry), then written like any other.
//   3. A views-less base changes kind through the `view: <kind>` shorthand, never `type:`.
//
// Also holds the panel's other pure decisions — which kinds show which sections, the per-kind
// column bindings, the keys a kind manages — and the two I/O helpers SAVE runs (`readFrontmatter`,
// `runOp`). Framework-free so every rule is unit-tested (baseSettingsPlan.test.ts).

import { parse as parseYaml } from 'yaml'
import { api } from '../api'
import type { ViewType } from '../../../core/src/bases/types'
import { FRONTMATTER_RE } from '../../../core/src/bases/parse'
import type { SelectOption } from '../ui/Select'

export type WriteOp =
    | { op: 'set'; key: string; value: unknown }
    | { op: 'delete'; key: string }
    | { op: 'setView'; index: number; key: string; value: unknown }
    | { op: 'deleteView'; index: number; key: string }

/** A set of changed keys; `undefined` means "remove this key". */
export type Patch = Record<string, unknown>

/** Top-level keys `parseBaseFile` folds onto views[0] (its FIELD_KEYS plus every other flat
 *  read). Keep in sync with core/src/bases/parse.ts. */
export const FLAT_VIEW_KEYS: readonly string[] = [
    'frontField',
    'backField',
    'dueField',
    'easeField',
    'intervalField',
    'dateField',
    'startTimeField',
    'endTimeField',
    'recurrenceField',
    'categoryField',
    'googleCalendarId',
    'x',
    'y',
    'image',
    'descriptionField',
    'taskFile',
    'defaultCategory',
    'order',
    'columns',
    'groupColors',
    'hideLabels',
    'sort',
    'groupBy',
    'columnWidths',
    'cardContent',
    'calendarContent',
    'mode',
    'imageFit',
    'imageAspectRatio',
    'aggregate',
    'bin',
    'bidirectional',
    'googleCalendarSync',
]

/** The shorthand top-level keys a `source:` STRING reads its fields from — dead once the
 *  source is written in object form, so they go with it. */
const SOURCE_SIBLINGS = ['where', 'from', 'ref'] as const

const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v)

export interface PlanInput {
    /** The base file's parsed frontmatter, as it is on disk right now. */
    frontmatter: Record<string, unknown>
    viewIndex: number
    /** Changed view keys. */
    view: Patch
    /** Changed base keys. */
    base: Patch
    /** The view's kind + name AFTER the change — what a promoted `views:` entry is seeded with. */
    current: { type: string; name: string }
}

export type Plan = { ops: WriteOp[] } | { error: string }

export function planSettingsWrites(input: PlanInput): Plan {
    const fm = input.frontmatter
    const i = input.viewIndex
    const ops: WriteOp[] = []
    const view: Patch = { ...input.view }

    if (fm.views !== undefined && !Array.isArray(fm.views))
        return {
            error: '`views:` in this base is not a list — fix it in the file first',
        }
    let views = Array.isArray(fm.views) ? (fm.views as unknown[]) : null
    if (views && (i < 0 || i >= views.length || !isObj(views[i])))
        return { error: `this base has no view #${i + 1} to write to` }

    // The legacy `calendarContent` spelling goes whenever `mode` is written (viewMode() reads
    // either; an explicit mode wins, but a leftover calendarContent is a second, stale answer).
    // Removal is routed through the view patch so the same flat-copy rule below covers it.
    if ('mode' in view) {
        const own = views ? (views[i] as Record<string, unknown>) : null
        const flatApplies = !views || i === 0
        if (
            (own && 'calendarContent' in own) ||
            (flatApplies && 'calendarContent' in fm)
        )
            view.calendarContent = undefined
    }

    // Promote a views-less base when a key can't live at the top level.
    const needsViews = Object.keys(view).some(
        k => k !== 'type' && !FLAT_VIEW_KEYS.includes(k),
    )
    if (!views && needsViews) {
        ops.push({
            op: 'set',
            key: 'views',
            value: [{ type: input.current.type, name: input.current.name }],
        })
        if ('view' in fm) ops.push({ op: 'delete', key: 'view' })
        delete view.type
        delete view.name
        views = [{ type: input.current.type, name: input.current.name }]
    }

    if (!views) {
        // Every remaining key is flat-foldable (or the kind, via the `view:` shorthand).
        for (const [k, v] of Object.entries(view)) {
            if (k === 'type') ops.push({ op: 'set', key: 'view', value: v })
            else if (v === undefined) {
                if (k in fm) ops.push({ op: 'delete', key: k })
            } else ops.push({ op: 'set', key: k, value: v })
        }
    } else {
        const own = views[i] as Record<string, unknown>
        for (const [k, v] of Object.entries(view)) {
            if (v === undefined) {
                if (k in own) ops.push({ op: 'deleteView', index: i, key: k })
            } else ops.push({ op: 'setView', index: i, key: k, value: v })
            // Trap 1: a flat copy would override what was just written to views[0].
            if (i === 0 && FLAT_VIEW_KEYS.includes(k) && k in fm)
                ops.push({ op: 'delete', key: k })
        }
        // A view-level source in object form makes the view's own string-form siblings dead.
        if ('source' in view)
            for (const k of SOURCE_SIBLINGS)
                if (k in own) ops.push({ op: 'deleteView', index: i, key: k })
    }

    for (const [k, v] of Object.entries(input.base)) {
        if (v === undefined) {
            if (k in fm) ops.push({ op: 'delete', key: k })
        } else ops.push({ op: 'set', key: k, value: v })
        if (k === 'source')
            for (const s of SOURCE_SIBLINGS)
                if (s in fm) ops.push({ op: 'delete', key: s })
    }

    return { ops }
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

/** The view keys the CURRENT kind manages — switching kind never deletes another kind's settings. */
export function viewKeysFor(k: ViewType, sourceScope: 'base' | 'view'): string[] {
    const keys = ['name', 'type', 'filters']
    if (sourceScope === 'view') keys.push('source')
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

// ---------------------------------------------------------------------------------------
// SAVE's I/O
// ---------------------------------------------------------------------------------------

/** Run one planned write against the base file. */
export async function runOp(path: string, o: WriteOp): Promise<void> {
    if (o.op === 'set') await api.setProperty(path, o.key, o.value)
    else if (o.op === 'delete') await api.deleteProperty(path, o.key)
    else if (o.op === 'setView')
        await api.setViewProperty(path, o.index, o.key, o.value)
    else await api.deleteViewProperty(path, o.index, o.key)
}

/** The base file's frontmatter as it is on disk right now. */
export async function readFrontmatter(
    path: string,
): Promise<Record<string, unknown>> {
    const text = await api.read(path)
    const m = text.match(FRONTMATTER_RE)
    if (!m) return {}
    const data = parseYaml(m[2])
    return data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {}
}
