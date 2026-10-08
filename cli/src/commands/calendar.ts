// Calendar command group for the `bismuth` CLI. Lets the daemon/agents edit a
// calendar base file BY API instead of hand-editing raw YAML (which the app rewrites:
// strips quotes, adds localUpdated, and can't remove one recurring occurrence).
//
// A calendar is a `type: base` + `view: calendar` markdown file: events in the base's
// row table, categories in frontmatter. Every write preserves the WHOLE frontmatter and
// touches only events + categories (core/src/calendar.ts, ported from BaseBackend). All
// commands are headless — the app's vault watcher picks up the writes live.
//
// Bridged to the MCP as `bismuth_cli` (no new MCP tool) so `bismuth_cli_help` lists these.
import type { CommandMap } from '../types'
import { fail, flag, out, parseJsonFlag, positionals, requireVault } from '../args'
import {
    createEntry,
    listBases,
    listMarkdown,
    readNote,
    writeNote,
} from '../../../core/src/files'
import { baseNameOf, isBasePath, BASE_EXT, readBaseConfigRaw, type BaseFormat } from '../../../core/src/bases/baseFile'
import { resolveBasePath } from '../baseResolve'
import {
    agentDenyEntries,
    isDeniedPath,
} from '../../../core/src/visibilityFilter'
import {
    parseCalendarFile,
    serializeCalendarFile,
    emptyCalendarFile,
    isCalendarBase,
    categoriesOf,
    eventsForDay,
    eventsForRange,
    eventsInWindow,
    searchEvents,
    detectOverlaps,
    findEvent,
    addEvent,
    moveEvent,
    deleteEvent,
    overrideOccurrence,
    deleteOccurrence,
    recurrenceFromRRule,
    addCategory,
    updateCategory,
    removeCategory,
    type CalendarEvent,
    type Recurrence,
} from '../../../core/src/calendar'

/** Read + parse a calendar base file into its frontmatter + events. */
async function readCalendar(vault: string, given: string) {
    const path = resolveBasePath(vault, given)
    const text = await readNote(vault, path)
    return { ...parseCalendarFile(text), path }
}

/** Re-serialize (frontmatter preserved) + write the calendar back to disk, in the format it was
 *  read in (`format` comes from `readCalendar`). */
async function writeCalendar(
    vault: string,
    path: string,
    frontmatter: Record<string, unknown>,
    events: CalendarEvent[],
    format: BaseFormat,
) {
    await writeNote(
        vault,
        path,
        serializeCalendarFile(frontmatter, events, format),
    )
}

/** Parse an optional `--json '{...}'` flag into an object; fail on malformed JSON. */
function optJson(args: string[]): Record<string, unknown> | undefined {
    return parseJsonFlag(args, 'json')
}

/** Parse the optional `--recurrence '{...}'` flag into a Recurrence (fills seriesId if absent).
 *  parseJsonFlag rejects an array — tighter than this used to be on its own, since a
 *  recurrence is never one. */
function optRecurrence(args: string[]): Recurrence | undefined {
    const parsed = parseJsonFlag(args, 'recurrence')
    if (!parsed) return undefined
    const rec = parsed as unknown as Recurrence
    if (!rec.seriesId) rec.seriesId = crypto.randomUUID()
    return rec
}

/** Build event fields from --json first, then overlay convenience flags (flags win). */
function eventFieldsFromArgs(args: string[]): Record<string, unknown> {
    const fields: Record<string, unknown> = { ...(optJson(args) ?? {}) }
    const set = (key: string, name: string) => {
        const v = flag(args, name)
        if (v !== undefined) fields[key] = v
    }
    set('title', 'title')
    set('date', 'date')
    set('startTime', 'start')
    set('endTime', 'end')
    set('location', 'location')
    set('link', 'link')
    set('description', 'description')
    set('category', 'category')
    const rec = optRecurrence(args)
    if (rec) fields.recurrence = rec
    return fields
}

export const commands: CommandMap = {
    'calendar bases': {
        summary:
            'Discover calendar base files in the vault (path, title, event/category counts)',
        usage: '',
        run: async args => {
            const vault = requireVault(args)
            const result: {
                path: string
                title: string
                events: number
                categories: string[]
                error?: 'unparseable'
            }[] = []
            // Agents: a restricted base is dropped at the enumeration, before it is read, so
            // neither its path, title nor counts reach the output. Throws when undeterminable.
            const deny = await agentDenyEntries(vault)
            const paths = [
                ...(await listMarkdown(vault)),
                ...(await listBases(vault)),
            ].sort()
            for (const path of paths) {
                if (isDeniedPath(deny, path)) continue
                let text: string
                try {
                    text = await readNote(vault, path)
                } catch {
                    continue
                }
                const data = readBaseConfigRaw(text) ?? {}
                if (!isCalendarBase(data)) continue
                const title =
                    typeof data.title === 'string' && data.title
                        ? data.title
                        : baseNameOf(path)
                const categories = categoriesOf(data).map(c => c.name)
                // A calendar with a broken line is still a calendar: list it, flagged, and
                // carry on with the rest.
                let events: CalendarEvent[]
                try {
                    events = parseCalendarFile(text).events
                } catch {
                    result.push({
                        path,
                        title,
                        events: 0,
                        categories,
                        error: 'unparseable',
                    })
                    continue
                }
                result.push({ path, title, events: events.length, categories })
            }
            out(result, args)
        },
    },

    'calendar create': {
        summary:
            'Create a new empty calendar base (`<name>.base.jsonl`; an explicit `.md` path makes a markdown calendar). Fails if the path exists',
        usage: "<basePath> [--title '...']",
        run: async args => {
            const vault = requireVault(args)
            let [path] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!/\.md$/i.test(path) && !isBasePath(path)) path += BASE_EXT
            createEntry(vault, path, 'file') // EEXIST guard
            // emptyCalendarFile returns JSONL; an explicit `.md` path keeps the markdown form.
            let text = emptyCalendarFile({ title: flag(args, 'title') })
            if (!isBasePath(path)) {
                const parsed = parseCalendarFile(text)
                text = serializeCalendarFile(parsed.frontmatter, parsed.events, 'md')
            }
            await writeNote(vault, path, text)
            out({ ok: true, path }, args)
        },
    },

    'calendar list': {
        summary:
            'List RAW stored events (masters unexpanded, with real ids) — optionally windowed',
        usage: '<basePath> [--from YYYY-MM-DD --to YYYY-MM-DD]',
        run: async args => {
            const vault = requireVault(args)
            const [path] = positionals(args)
            if (!path) fail('<basePath> required')
            const { events } = await readCalendar(vault, path)
            out(
                eventsInWindow(events, flag(args, 'from'), flag(args, 'to')),
                args,
            )
        },
    },

    'calendar range': {
        summary:
            'List concrete event instances in a date range (recurrences expanded)',
        usage: '<basePath> <from> <to>',
        run: async args => {
            const vault = requireVault(args)
            const [path, from, to] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!from || !to) fail('<from> and <to> (YYYY-MM-DD) required')
            const { events } = await readCalendar(vault, path)
            out(eventsForRange(events, from, to), args)
        },
    },

    'calendar get': {
        summary: 'Print one event by id (as stored)',
        usage: '<basePath> <id>',
        run: async args => {
            const vault = requireVault(args)
            const [path, id] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!id) fail('<id> required')
            const { events } = await readCalendar(vault, path)
            const event = findEvent(events, id)
            if (!event) fail(`no event with id ${id}`)
            out(event, args)
        },
    },

    'calendar search': {
        summary:
            'Search events by text (title/description/location/category); --from/--to searches expanded instances',
        usage: '<basePath> <text> [--from YYYY-MM-DD --to YYYY-MM-DD]',
        run: async args => {
            const vault = requireVault(args)
            const [path, ...words] = positionals(args)
            if (!path) fail('<basePath> required')
            const text = words.join(' ').trim()
            if (!text) fail('<text> required')
            const { events } = await readCalendar(vault, path)
            const from = flag(args, 'from')
            const to = flag(args, 'to')
            const pool =
                from && to
                    ? eventsForRange(events, from, to)
                    : eventsInWindow(events, from, to)
            out(searchEvents(pool, text), args)
        },
    },

    'calendar day': {
        summary:
            "List a day's events (recurrences expanded to concrete instances)",
        usage: '<basePath> <date>',
        run: async args => {
            const vault = requireVault(args)
            const [path, date] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!date) fail('<date> (YYYY-MM-DD) required')
            const { events } = await readCalendar(vault, path)
            out(eventsForDay(events, date), args)
        },
    },

    'calendar overlaps': {
        summary: 'Detect overlapping timed events on a given day',
        usage: '<basePath> <date>',
        run: async args => {
            const vault = requireVault(args)
            const [path, date] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!date) fail('<date> (YYYY-MM-DD) required')
            const { events } = await readCalendar(vault, path)
            const pairs = detectOverlaps(eventsForDay(events, date))
            out({ date, overlaps: pairs }, args)
        },
    },

    'calendar add': {
        summary:
            'Add an event (fields via --json and/or --title/--date/--start/--end/--recurrence/--rrule …)',
        usage: "<basePath> --date YYYY-MM-DD --title '...' [--start HH:MM --end HH:MM] [--rrule 'FREQ=WEEKLY;BYDAY=MO']",
        run: async args => {
            const vault = requireVault(args)
            const [path] = positionals(args)
            if (!path) fail('<basePath> required')
            const fields = eventFieldsFromArgs(args)
            if (!fields.date) fail('--date (YYYY-MM-DD) required')
            // --rrule: an iCal RRULE as an alternative to --recurrence JSON (--recurrence wins).
            const rrule = flag(args, 'rrule')
            if (rrule !== undefined && fields.recurrence === undefined) {
                const rec = recurrenceFromRRule(rrule, String(fields.date))
                fields.recurrence = rec
                fields.date = rec.startDate // normalized to the first valid occurrence (BYDAY off-day starts)
            }
            const { frontmatter, events, format, path: file } = await readCalendar(
                vault,
                path,
            )
            const { events: next, event } = addEvent(
                events,
                fields as Omit<CalendarEvent, 'id' | 'localUpdated'>,
            )
            await writeCalendar(vault, file, frontmatter, next, format)
            out({ ok: true, event }, args)
        },
    },

    'calendar move': {
        summary:
            'Move/edit an event by id: set --date/--start/--end (and other fields)',
        usage: '<basePath> <id> [--date YYYY-MM-DD --start HH:MM --end HH:MM]',
        run: async args => {
            const vault = requireVault(args)
            const [path, id] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!id) fail('<id> required')
            const updates = eventFieldsFromArgs(args)
            if (Object.keys(updates).length === 0)
                fail('nothing to update — pass --date/--start/--end/--json …')
            const { frontmatter, events, format, path: file } = await readCalendar(
                vault,
                path,
            )
            const next = moveEvent(
                events,
                id,
                updates as Partial<CalendarEvent>,
            )
            await writeCalendar(vault, file, frontmatter, next, format)
            out({ ok: true, event: findEvent(next, id) }, args)
        },
    },

    'calendar delete': {
        summary: 'Delete an event by id',
        usage: '<basePath> <id>',
        run: async args => {
            const vault = requireVault(args)
            const [path, id] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!id) fail('<id> required')
            const { frontmatter, events, format, path: file } = await readCalendar(
                vault,
                path,
            )
            const next = deleteEvent(events, id)
            await writeCalendar(vault, file, frontmatter, next, format)
            out({ ok: true }, args)
        },
    },

    'calendar override': {
        summary:
            'Override ONE occurrence of a recurring event on a date (splits the series)',
        usage: '<basePath> <id> <date> [--title/--start/--end/--json …]',
        run: async args => {
            const vault = requireVault(args)
            const [path, id, date] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!id) fail('<id> (recurring event) required')
            if (!date) fail('<date> (YYYY-MM-DD occurrence) required')
            const updates = eventFieldsFromArgs(args)
            delete updates.date // the occurrence date is the positional; a --date flag would be ambiguous
            const { frontmatter, events, format, path: file } = await readCalendar(
                vault,
                path,
            )
            const next = overrideOccurrence(
                events,
                id,
                date,
                updates as Partial<CalendarEvent>,
            )
            await writeCalendar(vault, file, frontmatter, next, format)
            out({ ok: true }, args)
        },
    },

    'calendar delete-occurrence': {
        summary:
            'Delete ONE occurrence of a recurring event on a date (splits the series)',
        usage: '<basePath> <id> <date>',
        run: async args => {
            const vault = requireVault(args)
            const [path, id, date] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!id) fail('<id> (recurring event) required')
            if (!date) fail('<date> (YYYY-MM-DD occurrence) required')
            const { frontmatter, events, format, path: file } = await readCalendar(
                vault,
                path,
            )
            const next = deleteOccurrence(events, id, date)
            await writeCalendar(vault, file, frontmatter, next, format)
            out({ ok: true }, args)
        },
    },

    'calendar categories': {
        summary: "List a calendar's categories ({name, color})",
        usage: '<basePath>',
        run: async args => {
            const vault = requireVault(args)
            const [path] = positionals(args)
            if (!path) fail('<basePath> required')
            const { frontmatter } = await readCalendar(vault, path)
            out(categoriesOf(frontmatter), args)
        },
    },

    'calendar category add': {
        summary:
            'Add a category (--color = any CSS color or a theme token like accent/teal)',
        usage: "<basePath> <name> [--color '#b00020']",
        run: async args => {
            const vault = requireVault(args)
            const [path, name] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!name) fail('<name> required')
            const { frontmatter, events, format, path: file } = await readCalendar(
                vault,
                path,
            )
            const next = addCategory(frontmatter, {
                name,
                color: flag(args, 'color') ?? 'accent',
            })
            await writeCalendar(vault, file, next, events, format)
            out({ ok: true, categories: categoriesOf(next) }, args)
        },
    },

    'calendar category update': {
        summary:
            'Rename (--rename, cascades into events) and/or recolor (--color) a category',
        usage: '<basePath> <name> [--rename <newName>] [--color <c>]',
        run: async args => {
            const vault = requireVault(args)
            const [path, name] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!name) fail('<name> required')
            const rename = flag(args, 'rename')
            const color = flag(args, 'color')
            if (rename === undefined && color === undefined)
                fail('nothing to update — pass --rename and/or --color')
            const { frontmatter, events, format, path: file } = await readCalendar(
                vault,
                path,
            )
            const next = updateCategory(frontmatter, events, name, {
                ...(rename !== undefined ? { name: rename } : {}),
                ...(color !== undefined ? { color } : {}),
            })
            await writeCalendar(vault, file, next.frontmatter, next.events, format)
            out({ ok: true, categories: categoriesOf(next.frontmatter) }, args)
        },
    },

    'calendar category remove': {
        summary:
            'Remove a category, clearing it from events (or --reassign <other>)',
        usage: '<basePath> <name> [--reassign <otherCategory>]',
        run: async args => {
            const vault = requireVault(args)
            const [path, name] = positionals(args)
            if (!path) fail('<basePath> required')
            if (!name) fail('<name> required')
            const { frontmatter, events, format, path: file } = await readCalendar(
                vault,
                path,
            )
            const next = removeCategory(
                frontmatter,
                events,
                name,
                flag(args, 'reassign'),
            )
            await writeCalendar(vault, file, next.frontmatter, next.events, format)
            out({ ok: true, categories: categoriesOf(next.frontmatter) }, args)
        },
    },
}
