// Pure (no api/DOM) parse + serialize for a calendar base file. Keeps the full
// frontmatter intact across saves (only the events table + categories change) and
// renders categories as an idiomatic YAML list of {name, color}.
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parseRows, serializeRows } from '../../../core/src/bases/rows'
import type { Row } from '../../../core/src/bases/types'
import {
    baseFormatOf,
    parseBaseJsonl,
    reassembleBaseJsonl,
    serializeBaseJsonl,
    type BaseFormat,
} from '../../../core/src/bases/baseFile'
import { AppError } from '../../../core/src/error'
import type { CalendarEvent, Category, Recurrence } from '../calendar/types'

function str(v: unknown): string | undefined {
    return v === undefined || v === null || v === '' ? undefined : String(v)
}

// Which row columns carry each event field. Mirrors the calendar ViewConfig field
// overrides (dateField/startTimeField/…); when no view is passed every field falls
// back to its standard key, so existing callers (the live calendar's BaseBackend)
// are unaffected.
export interface EventFieldMap {
    dateField?: string
    startTimeField?: string
    endTimeField?: string
    recurrenceField?: string
    categoryField?: string
}

/**
 * Map a base Row to a CalendarEvent using the SAME field conventions the live
 * calendar view uses. `view` lets a calendar view override the date/time/recurrence/
 * category columns; title/location/link/description always read their standard keys.
 */
export function rowToEvent(
    row: Row,
    i: number,
    view?: EventFieldMap,
): CalendarEvent {
    const n = row.note
    const dateKey = view?.dateField || 'date'
    const startKey = view?.startTimeField || 'startTime'
    const endKey = view?.endTimeField || 'endTime'
    const recKey = view?.recurrenceField || 'recurrence'
    const catKey = view?.categoryField || 'category'
    const rawRec = n[recKey]
    let recurrence: Recurrence | undefined
    if (rawRec) {
        try {
            recurrence =
                typeof rawRec === 'string'
                    ? (JSON.parse(rawRec) as Recurrence)
                    : (rawRec as Recurrence)
        } catch {
            recurrence = undefined
        }
    }
    // Multiple categories are stored as a JSON array string (same convention as
    // recurrence). Tolerate an already-parsed array or a bare single string too.
    const rawCats = n.categories
    let categories: string[] | undefined
    if (Array.isArray(rawCats)) {
        categories = rawCats.map(String)
    } else if (typeof rawCats === 'string' && rawCats) {
        try {
            const parsed = JSON.parse(rawCats)
            categories = Array.isArray(parsed) ? parsed.map(String) : [rawCats]
        } catch {
            categories = [rawCats]
        }
    }
    return {
        id: str(n.id) ?? `row-${i}`,
        title: String(n.title ?? ''),
        date: String(n[dateKey] ?? ''),
        startTime: str(n[startKey]),
        endTime: str(n[endKey]),
        location: str(n.location),
        link: str(n.link),
        description: str(n.description),
        category: str(n[catKey]),
        ...(categories && categories.length ? { categories } : {}),
        recurrence,
        localUpdated: str(n.localUpdated),
    }
}

function rowOf(note: Record<string, unknown>): Row {
    return {
        file: {
            name: '',
            basename: '',
            path: '',
            folder: '',
            ext: 'md',
            size: 0,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note,
        formula: {},
    }
}

function eventToRow(e: CalendarEvent): Row {
    return rowOf({
        id: e.id,
        title: e.title,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        location: e.location,
        link: e.link,
        description: e.description,
        category: e.category,
        categories:
            e.categories && e.categories.length
                ? JSON.stringify(e.categories)
                : undefined,
        recurrence: e.recurrence ? JSON.stringify(e.recurrence) : undefined,
        localUpdated: e.localUpdated,
    })
}

export interface ParsedCalendar {
    frontmatter: Record<string, unknown>
    events: CalendarEvent[]
    format: BaseFormat
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseCalendarFile(text: string): ParsedCalendar {
    const format = baseFormatOf(text)
    if (format === 'jsonl') {
        const { raw, rows, skipped } = parseBaseJsonl(text, {
            name: '',
            path: '',
        })
        // Never drop data silently: a rewrite of this file would lose the unparseable lines.
        if (skipped > 0)
            throw new AppError(
                'PARSE_ERROR',
                `calendar has ${skipped} unparseable line${skipped === 1 ? '' : 's'}`,
            )
        return {
            frontmatter: raw,
            events: rows.map((r, i) => rowToEvent(r, i)),
            format,
        }
    }
    const m = text.match(FM_RE)
    let frontmatter: Record<string, unknown> = {}
    let body = text
    if (m) {
        try {
            frontmatter = (parseYaml(m[1]) as Record<string, unknown>) ?? {}
        } catch {
            frontmatter = {}
        }
        body = m[2]
    }
    const rows = parseRows(body, { name: '', path: '' })
    return { frontmatter, events: rows.map((r, i) => rowToEvent(r, i)), format }
}

export function categoriesOf(frontmatter: Record<string, unknown>): Category[] {
    const c = frontmatter.categories
    return Array.isArray(c) ? (c as Category[]) : []
}

// The row keys the app models; every other key on a row is carried through edits untouched.
const MODELED = new Set([
    'id',
    'title',
    'date',
    'startTime',
    'endTime',
    'location',
    'link',
    'description',
    'category',
    'categories',
    'recurrence',
    'localUpdated',
])

/** The rows of a prior copy of the file, by event id (empty when it cannot be parsed). */
function priorNotes(prior: string): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>()
    try {
        const rows =
            baseFormatOf(prior) === 'jsonl'
                ? parseBaseJsonl(prior, { name: '', path: '' }).rows
                : prior.match(FM_RE)
                  ? parseRows(prior.match(FM_RE)![2], {
                        name: '',
                        path: '',
                    })
                  : parseRows(prior, { name: '', path: '' })
        rows.forEach((r, i) => {
            const id = str(r.note.id) ?? `row-${i}`
            if (!out.has(id)) out.set(id, r.note)
        })
    } catch {
        // an unreadable prior just means no extras to carry
    }
    return out
}

/**
 * Re-emit the calendar base file: canonical YAML frontmatter (all original keys
 * preserved; categories as a list of {name, color}) + the events table.
 *
 * `prior` is the file as it is on disk now. Row keys the app does not model (`color`,
 * `x-custom`) are carried over from it by event id, and in a JSON Lines file every event the app
 * did not change keeps its original line byte for byte.
 */
export function serializeCalendarFile(
    frontmatter: Record<string, unknown>,
    events: CalendarEvent[],
    format: BaseFormat = 'md',
    prior?: string,
): string {
    const old = prior ? priorNotes(prior) : new Map()
    const notes = events.map(e => {
        const note = eventToRow(e).note
        const p = old.get(e.id) as Record<string, unknown> | undefined
        if (!p) return note
        // unchanged by the app: the original row as it was
        if (same({ ...rowToEvent(rowOf(p), 0), id: e.id }, e)) return p
        const extras: Record<string, unknown> = {}
        for (const k of Object.keys(p)) if (!MODELED.has(k)) extras[k] = p[k]
        return { ...extras, ...note }
    })
    if (format === 'jsonl') {
        if (prior && baseFormatOf(prior) === 'jsonl') {
            const lines = reassembleBaseJsonl(prior, notes).split('\n')
            try {
                if (!same(JSON.parse(lines[0]), frontmatter))
                    lines[0] = JSON.stringify(frontmatter)
            } catch {
                lines[0] = JSON.stringify(frontmatter)
            }
            return lines.join('\n')
        }
        return serializeBaseJsonl(frontmatter, notes)
    }
    const fm = stringifyYaml(frontmatter).trimEnd()
    const body = serializeRows(notes.map(rowOf))
    return body ? `---\n${fm}\n---\n\n${body}\n` : `---\n${fm}\n---\n`
}

const same = (a: unknown, b: unknown): boolean =>
    JSON.stringify(a) === JSON.stringify(b)

/**
 * Three-way merge of the events by id: `base` is what the app last knew of the file, `mine` is
 * the app's state, `theirs` is the file as it is now. An app edit or delete wins over the file;
 * an event the app did not touch follows the file (external edit, add or delete). Order follows
 * the file, then events only the app has.
 */
export function mergeEvents(
    base: CalendarEvent[],
    mine: CalendarEvent[],
    theirs: CalendarEvent[],
): CalendarEvent[] {
    const b = new Map(base.map(e => [e.id, e]))
    const m = new Map(mine.map(e => [e.id, e]))
    const out: CalendarEvent[] = []
    const seen = new Set<string>()
    for (const t of theirs) {
        seen.add(t.id)
        const bb = b.get(t.id)
        const mm = m.get(t.id)
        if (!mm) {
            if (!bb) out.push(t) // external add
            continue // app deleted it
        }
        out.push(bb && same(mm, bb) ? t : mm)
    }
    for (const mm of mine) {
        if (seen.has(mm.id)) continue
        // only the app has it: new in the app, or deleted externally. An unchanged one stays gone.
        const bb = b.get(mm.id)
        if (!bb || !same(mm, bb)) out.push(mm)
    }
    return out
}
