// core/src/statusBarItems.ts — the `statusBar:` setting's item model. PURE and browser-safe: the
// settings schema imports these constants and the app bundles the schema, so nothing here may
// import Bun or node modules.

export const STATUS_BUILTINS = ['location', 'connection', 'inbox', 'daemon'] as const
export type StatusBuiltin = (typeof STATUS_BUILTINS)[number]

export const STATUS_TONES = [
    'faint',
    'muted',
    'fg',
    'accent',
    'warning',
    'danger',
    'success',
    'teal',
    'blue',
    'violet',
    'green',
    'gold',
    'rose',
] as const
export type StatusTone = (typeof STATUS_TONES)[number]

export const STATUS_QUERY_SOURCES = ['notes', 'tasks', 'base'] as const
export type StatusQuery = {
    source: 'notes' | 'tasks' | 'base'
    ref?: string
    where?: string
}

export type StatusBarItem = {
    id: string
    builtin?: StatusBuiltin
    text?: string
    query?: StatusQuery
    run?: string
    every: number
    align: 'left' | 'right'
    tone?: StatusTone
    command?: string
    tooltip?: string
    icon?: string
}

/** The schema default — reproduces the bar as it was before it became configurable. */
export const DEFAULT_STATUS_BAR: Array<Record<string, unknown>> = [
    { builtin: 'location' },
    { builtin: 'connection' },
    { builtin: 'inbox', align: 'right' },
    { builtin: 'daemon', align: 'right' },
]

const BUILTIN_SET: ReadonlySet<string> = new Set(STATUS_BUILTINS)
const TONE_SET: ReadonlySet<string> = new Set(STATUS_TONES)
const QUERY_SOURCE_SET: ReadonlySet<string> = new Set(STATUS_QUERY_SOURCES)

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

function normalizeQuery(raw: unknown): StatusQuery | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const o = raw as Record<string, unknown>
    if (typeof o.source !== 'string' || !QUERY_SOURCE_SET.has(o.source)) return undefined
    const q: StatusQuery = { source: o.source as StatusQuery['source'] }
    const ref = str(o.ref)
    const where = str(o.where)
    if (ref) q.ref = ref
    if (where) q.where = where
    return q
}

function normalizeItem(raw: unknown, index: number): StatusBarItem | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const o = raw as Record<string, unknown>
    const hasBuiltin = o.builtin !== undefined
    if (hasBuiltin && !(typeof o.builtin === 'string' && BUILTIN_SET.has(o.builtin))) return undefined
    const builtin = hasBuiltin ? (o.builtin as StatusBuiltin) : undefined
    const text = typeof o.text === 'string' ? o.text : undefined
    const query = normalizeQuery(o.query)
    const run = str(o.run)?.trim() || undefined
    if (builtin === undefined && text === undefined && !query && !run) return undefined
    const every =
        typeof o.every === 'number' && Number.isFinite(o.every) ? Math.max(5, o.every) : 60
    const defaultAlign =
        builtin === 'location' || builtin === 'connection' ? 'left' : 'right'
    const item: StatusBarItem = {
        id: `s${index}`,
        every,
        align: o.align === 'left' || o.align === 'right' ? o.align : defaultAlign,
    }
    if (builtin) item.builtin = builtin
    if (text !== undefined) item.text = text
    if (query) item.query = query
    if (run) item.run = run
    if (typeof o.tone === 'string' && TONE_SET.has(o.tone)) item.tone = o.tone as StatusTone
    const command = str(o.command)
    const tooltip = str(o.tooltip)
    const icon = str(o.icon)
    if (command) item.command = command
    if (tooltip) item.tooltip = tooltip
    if (icon) item.icon = icon
    return item
}

/** Non-array/undefined -> normalize(DEFAULT_STATUS_BAR). Items with none of builtin/text/query/run,
 *  or an unknown builtin, are dropped (ids still count raw positions). Unknown tone/align -> omitted/default. */
export function normalizeStatusBar(raw: unknown): StatusBarItem[] {
    const list = Array.isArray(raw) ? raw : DEFAULT_STATUS_BAR
    const out: StatusBarItem[] = []
    list.forEach((r, i) => {
        const item = normalizeItem(r, i)
        if (item) out.push(item)
    })
    return out
}
