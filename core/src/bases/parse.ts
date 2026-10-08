import { parse as parseYaml } from 'yaml'
import type {
    BaseConfig,
    FilterNode,
    ViewConfig,
    SortSpec,
    ParsedBase,
    BasePropertyDef,
} from './types'
import { isValidType } from './types'
import { parseBasePropertyType } from './properties'
import { parseRows } from './rows'
import { normalizeSource } from './sourceSpec'
import { combineFilters } from './filters'
import { baseFormatOf, parseBaseJsonl, FRONTMATTER_RE } from './baseFile'

export { FRONTMATTER_RE }

const AGGREGATE_VALUES: readonly string[] = [
    'sum',
    'avg',
    'count',
    'min',
    'max',
]
const BIN_VALUES: readonly string[] = ['day', 'week', 'month']

function strOrUndef(v: unknown): string | undefined {
    return typeof v === 'string' ? v : undefined
}
// A finite number, tolerating a value that round-tripped through YAML as a string ("1.45").
function numOrUndef(v: unknown): number | undefined {
    const n =
        typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    return Number.isFinite(n) ? n : undefined
}
function safeYaml(text: string): Record<string, unknown> | null {
    try {
        const d = parseYaml(text)
        return d && typeof d === 'object'
            ? (d as Record<string, unknown>)
            : null
    } catch {
        return null
    }
}

function normalizeDir(raw: unknown): 'ASC' | 'DESC' {
    return String(raw ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
}

function normalizeSort(raw: unknown): SortSpec[] | undefined {
    if (!raw) return undefined
    const items = Array.isArray(raw) ? raw : [raw]
    const out: SortSpec[] = []
    for (const it of items) {
        let spec: SortSpec | null = null
        if (typeof it === 'string') {
            spec = { property: it, direction: 'ASC' }
        } else if (it && typeof it === 'object') {
            const o = it as Record<string, unknown>
            const property =
                typeof o.property === 'string'
                    ? o.property
                    : typeof o.column === 'string'
                      ? o.column
                      : null
            if (property) {
                spec = { property, direction: normalizeDir(o.direction) }
            }
        }
        if (spec) out.push(spec)
    }
    return out.length ? out : undefined
}

function normalizeGroupBy(raw: unknown): ViewConfig['groupBy'] {
    if (!raw) return undefined
    if (typeof raw === 'string') {
        return { property: raw, direction: 'ASC' }
    }
    if (raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>
        if (typeof o.property === 'string') {
            return {
                property: o.property,
                direction: normalizeDir(o.direction),
            }
        }
    }
    return undefined
}

// Coerce a `columnWidths` map (propertyId -> px) into a clean number map. Tolerates
// values that round-tripped through YAML as strings ("240"); drops non-finite/non-positive.
function normalizeColumnWidths(
    raw: unknown,
): Record<string, number> | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const n =
            typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
        if (Number.isFinite(n) && n > 0) out[k] = n
    }
    return Object.keys(out).length ? out : undefined
}

// Coerce a `groupColors` map (kanban group key -> CSS color string) into a clean
// string->string map. Drops empty/non-string values; keeps arbitrary keys (column names).
function normalizeGroupColors(
    raw: unknown,
): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim()
    }
    return Object.keys(out).length ? out : undefined
}

// One property definition's optional fields, shared by both `properties:` forms.
// `type` (+ its sibling carriers: options/number/unit/expr) is parsed into the canonical
// BasePropertyType by parseBasePropertyType (undefined when no `type`; malformed → text);
// `default` keeps any non-null value (false/0/"" are real defaults).
function normalizePropertyDef(raw: unknown): BasePropertyDef {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
        string,
        unknown
    >
    return {
        displayName:
            typeof o.displayName === 'string' ? o.displayName : undefined,
        hidden: o.hidden === true ? true : undefined,
        type: parseBasePropertyType(o),
        default:
            o.default !== undefined && o.default !== null
                ? o.default
                : undefined,
    }
}

/**
 * Normalize the `properties:` key. Two forms:
 *  • MAP (classic) — `Record<name, {displayName?, hidden?, type?, default?}>`: per-property
 *    metadata over the auto-derived property set. `declaredProperties` stays undefined.
 *  • LIST (per-base declaration) — each entry a bare name string or `{name, type?, default?,
 *    displayName?, hidden?}`. The list DECLARES the base's own property set:
 *    `declaredProperties` carries the names in declaration order (deduped, first wins;
 *    entries without a usable name are skipped).
 */
function normalizeProperties(
    raw: unknown,
): Pick<BaseConfig, 'properties' | 'declaredProperties'> {
    if (Array.isArray(raw)) {
        const properties: Record<string, BasePropertyDef> = {}
        const declared: string[] = []
        for (const item of raw) {
            let name: string
            let def: BasePropertyDef
            if (typeof item === 'string') {
                name = item.trim()
                def = {}
            } else if (item && typeof item === 'object') {
                const o = item as Record<string, unknown>
                if (typeof o.name !== 'string' || o.name.trim() === '') continue
                name = o.name.trim()
                def = normalizePropertyDef(o)
            } else {
                continue
            }
            if (!name || name in properties) continue
            properties[name] = def
            declared.push(name)
        }
        if (declared.length === 0) return {}
        return { properties, declaredProperties: declared }
    }
    if (raw && typeof raw === 'object') {
        return {
            properties: Object.fromEntries(
                Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
                    k,
                    normalizePropertyDef(v),
                ]),
            ),
        }
    }
    return {}
}

// Normalize the `stats:` key of a stat view. Each entry is either a bare string
// (label = value = the string) or `{label?, value}` with a string `value` (label
// defaults to `value`). Anything else — a non-array, a non-string `value`, a
// missing `value` — is dropped rather than surfacing a broken tile.
function normalizeStats(raw: unknown): ViewConfig['stats'] {
    if (!Array.isArray(raw)) return undefined
    const out: { label: string; value: string }[] = []
    for (const item of raw) {
        if (typeof item === 'string') {
            out.push({ label: item, value: item })
        } else if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>
            if (typeof o.value === 'string') {
                out.push({
                    label: typeof o.label === 'string' ? o.label : o.value,
                    value: o.value,
                })
            }
        }
    }
    return out.length ? out : undefined
}

function normalizeView(raw: unknown): ViewConfig {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
        string,
        unknown
    >

    const strArr = (x: unknown) =>
        Array.isArray(x) ? x.map(String) : undefined

    const type = isValidType(o.type) ? o.type : 'table'
    const limit = typeof o.limit === 'number' ? o.limit : undefined
    const order = strArr(o.order)
    const summaries =
        o.summaries && typeof o.summaries === 'object'
            ? Object.fromEntries(
                  Object.entries(o.summaries as Record<string, unknown>).map(
                      ([k, v]) => [k, String(v)],
                  ),
              )
            : undefined
    const cardContent =
        o.cardContent === 'body'
            ? 'body'
            : o.cardContent === 'tasks'
              ? 'tasks'
              : o.cardContent === 'properties'
                ? 'properties'
                : undefined
    const calendarContent =
        o.calendarContent === 'tasks'
            ? 'tasks'
            : o.calendarContent === 'events'
              ? 'events'
              : undefined
    const mode =
        o.mode === 'tasks' ? 'tasks' : o.mode === 'normal' ? 'normal' : undefined
    const imageFit =
        o.imageFit === 'contain'
            ? 'contain'
            : o.imageFit === 'cover'
              ? 'cover'
              : undefined
    const groupOrder = strArr(o.columns)
    const groupColors = normalizeGroupColors(o.groupColors)
    const columnWidths = normalizeColumnWidths(o.columnWidths)
    const lat = typeof o.lat === 'string' ? o.lat : undefined
    const lng = typeof o.lng === 'string' ? o.lng : undefined
    const zoom = typeof o.zoom === 'number' ? o.zoom : undefined

    const centerObj = o.center as { lat?: unknown; lng?: unknown } | undefined
    const center =
        centerObj &&
        typeof centerObj.lat === 'number' &&
        typeof centerObj.lng === 'number'
            ? { lat: centerObj.lat, lng: centerObj.lng }
            : undefined

    return {
        type,
        limit,
        order,
        sort: normalizeSort(o.sort),
        groupBy: normalizeGroupBy(o.groupBy),
        summaries,
        cardContent,
        image: strOrUndef(o.image),
        imageFit,
        imageAspectRatio: numOrUndef(o.imageAspectRatio),
        groupOrder,
        groupColors,
        hideLabels: o.hideLabels === true ? true : undefined,
        descriptionField: strOrUndef(o.descriptionField),
        columnWidths,
        lat,
        lng,
        zoom,
        center,
        // calendar field bindings
        dateField: strOrUndef(o.dateField),
        startTimeField: strOrUndef(o.startTimeField),
        endTimeField: strOrUndef(o.endTimeField),
        recurrenceField: strOrUndef(o.recurrenceField),
        categoryField: strOrUndef(o.categoryField),
        calendarContent,
        mode,
        taskFile: strOrUndef(o.taskFile),
        defaultCategory: strOrUndef(o.defaultCategory),
        // per-calendar Google Calendar sync bindings
        googleCalendarId: strOrUndef(o.googleCalendarId),
        googleCalendarSync:
            o.googleCalendarSync === true
                ? true
                : o.googleCalendarSync === false
                  ? false
                  : undefined,
        // flashcards field bindings
        frontField: strOrUndef(o.frontField),
        backField: strOrUndef(o.backField),
        dueField: strOrUndef(o.dueField),
        easeField: strOrUndef(o.easeField),
        intervalField: strOrUndef(o.intervalField),
        bidirectional: o.bidirectional === true ? true : undefined,
        // chart bindings
        x: strOrUndef(o.x),
        y: strOrUndef(o.y),
        aggregate: AGGREGATE_VALUES.includes(o.aggregate as string)
            ? (o.aggregate as ViewConfig['aggregate'])
            : undefined,
        bin: BIN_VALUES.includes(o.bin as string)
            ? (o.bin as ViewConfig['bin'])
            : undefined,
        stats: normalizeStats(o.stats),
    }
}

const EMPTY_BASE: BaseConfig = { view: { type: 'table' } }

/** Top-level frontmatter keys that belong to the BASE (or to the note itself), never to its
 *  one view. Every other top-level key is read as a view key — the flat spelling is the only
 *  one Bismuth writes. */
const BASE_LEVEL_KEYS = new Set([
    'type',
    'view',
    'views',
    'name',
    'filters',
    'source',
    'from',
    'where',
    'ref',
    'formulas',
    'properties',
    'schema',
    'categories',
])

/** The first entry of a legacy `views:` list, when there is one. A base has exactly ONE view:
 *  a file written before that still reads, through its first entry only. Any further entries
 *  are ignored here and reported by `bismuth base validate`; the first write to the file
 *  flattens it (core/src/frontmatter.ts's `flattenBaseViews`). */
export function legacyView(
    o: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const first = Array.isArray(o.views) ? o.views[0] : undefined
    return first && typeof first === 'object'
        ? (first as Record<string, unknown>)
        : undefined
}

function parseBaseObject(o: Record<string, unknown>): BaseConfig {
    const legacy = legacyView(o) ?? {}
    const flat = Object.fromEntries(
        Object.entries(o).filter(([k]) => !BASE_LEVEL_KEYS.has(k)),
    )
    // The kind: a legacy list's own `type:` keeps the precedence it always had over the
    // `view:` shorthand; a flat file only has `view:`.
    const type = isValidType(legacy.type)
        ? legacy.type
        : isValidType(o.view)
          ? o.view
          : 'table'
    // Flat top-level keys win over a legacy entry's — the same override the flat
    // persistence path has always had.
    const view = normalizeView({ ...legacy, ...flat, type })

    const { properties, declaredProperties } = normalizeProperties(o.properties)

    const formulas =
        o.formulas && typeof o.formulas === 'object'
            ? Object.fromEntries(
                  Object.entries(o.formulas as Record<string, unknown>).map(
                      ([k, v]) => [k, String(v)],
                  ),
              )
            : undefined

    return {
        // A legacy entry's own `filters:` narrowed the base's; the two AND together.
        filters: combineFilters(
            o.filters as FilterNode | undefined,
            legacy.filters as FilterNode | undefined,
        ),
        formulas,
        properties,
        declaredProperties,
        view,
        // A legacy entry's own `source:` overrode the base's.
        source:
            normalizeSource(legacy.source, legacy) ??
            normalizeSource(o.source, o),
        schema:
            o.schema && typeof o.schema === 'object'
                ? (o.schema as BaseConfig['schema'])
                : undefined,
        // Same tolerance as core/src/calendar.ts's categoriesOf: an array, or nothing — no
        // per-entry validation, matching what that reader already accepts.
        categories: Array.isArray(o.categories)
            ? (o.categories as BaseConfig['categories'])
            : undefined,
    }
}

export function parseBase(text: string): BaseConfig {
    const o = safeYaml(text)
    if (!o) return EMPTY_BASE
    return parseBaseObject(o)
}

/**
 * Parse a base file in either format: JSON Lines (line 1 config, one row per line) or a
 * `type: base` markdown file (YAML frontmatter config + YAML-list or GFM-table rows).
 * The base's one view is spelled flat — `view: <kind>` plus top-level view keys.
 */
export function parseBaseFile(
    text: string,
    meta: { name: string; path: string },
): ParsedBase {
    if (baseFormatOf(text) === 'jsonl') {
        const { raw, rows } = parseBaseJsonl(text, meta)
        return { config: parseBaseObject(raw), rows }
    }
    const m = text.match(FRONTMATTER_RE)
    const fmText = m ? m[2] : ''
    const body = m ? m[3] : text
    const raw = fmText ? safeYaml(fmText) : null
    const config = raw ? parseBaseObject(raw) : { view: { type: 'table' as const } }
    const rows = parseRows(body, meta)
    return { config, rows }
}
