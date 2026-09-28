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
// Framework-free so every rule is unit-tested (baseSettingsPlan.test.ts).

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
