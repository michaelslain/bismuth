// Base-file storage backend for the existing calendar UI. Lets the full calendar
// (month/week/3day/day + drag + modals + recurrence) run against a calendar base file
// (markdown or JSON Lines) instead of localStorage. The file's format is kept across saves,
// and each write is a three-way merge with the file as it is on disk NOW, so an event the CLI
// or a sync added meanwhile survives an unrelated in-app edit.
import { api } from '../api'
import { pushToast } from '../ui/toastStore'
import type { CalendarStorage } from '../calendar/EventStore'
import { isBasePath, type BaseFormat } from '../../../core/src/bases/baseFile'
import type { CalendarEvent, Category } from '../calendar/types'
import type { EventsFile } from '../calendar/types'
import {
    parseCalendarFile,
    serializeCalendarFile,
    categoriesOf,
    mergeEvents,
} from './calendarSerialize'

export type CalendarIO = {
    read: (path: string) => Promise<string>
    write: (path: string, text: string) => Promise<unknown>
}

const same = (a: unknown, b: unknown): boolean =>
    JSON.stringify(a) === JSON.stringify(b)

export class BaseBackend implements CalendarStorage {
    private snapshot: EventsFile | null = null
    private frontmatter: Record<string, unknown> = {
        type: 'base',
        view: 'calendar',
    }
    private format: BaseFormat = 'md'
    // What the app last knew of the file (the merge base): events + categories as of the last
    // adopt or write. Merging against it tells an app edit from an external one.
    private known: CalendarEvent[] = []
    private knownCats: Category[] = []
    // The exact text we last wrote or read, so reloadIfChanged() can tell an EXTERNAL write (a
    // background Google-Calendar sync rewriting the file) from our own write echoing back.
    private lastText: string | null = null
    // Set when the file cannot be parsed without losing data (a JSONL line that is not JSON):
    // we refuse to write over it rather than drop those lines.
    parseError: Error | null = null
    // the last refusal message toasted, so queued saves refusing for the same reason toast once
    private refusedMsg: string | null = null
    // Serialize writes: a single recurrence op (e.g. deleteOccurrence) issues 2–3 saves
    // back-to-back. Each one merges the app state into the file as it is on disk when its turn
    // comes; chaining them guarantees writes land in order, without blocking the caller.
    private writeChain: Promise<void> = Promise.resolve()
    constructor(
        private readonly path: string,
        // the file I/O seam; tests inject an in-memory one
        private readonly io: CalendarIO = api,
    ) {}

    async init(): Promise<void> {
        let text: string
        try {
            text = await this.io.read(this.path)
        } catch {
            this.reset()
            return
        }
        try {
            this.adopt(text)
        } catch (e) {
            // unparseable: keep the file untouched, show an empty calendar, block writes
            this.reset()
            this.parseError = e as Error
        }
    }

    private reset(): void {
        this.frontmatter = { type: 'base', view: 'calendar' }
        this.snapshot = { events: [], categories: [] }
        this.format = isBasePath(this.path) ? 'jsonl' : 'md'
        this.known = []
        this.knownCats = []
        this.lastText = null
    }

    /** Parse `text` into the in-memory snapshot + remember it as the on-disk truth. */
    private adopt(text: string): void {
        const { frontmatter, events, format } = parseCalendarFile(text)
        this.frontmatter = frontmatter
        this.format = format
        this.snapshot = { events, categories: categoriesOf(frontmatter) }
        this.known = JSON.parse(JSON.stringify(events))
        this.knownCats = JSON.parse(JSON.stringify(categoriesOf(frontmatter)))
        this.lastText = text
        this.parseError = null
        this.refusedMsg = null
    }

    /**
     * Re-read the file IF it changed on disk underneath us (returns true when it did). An open
     * calendar otherwise keeps a snapshot from mount forever, so a background sync that rewrites
     * the file would be invisible. Waits for our own queued writes to land first so we never
     * mistake them for an external edit.
     */
    async reloadIfChanged(): Promise<boolean> {
        for (;;) {
            const chain = this.writeChain
            await chain.catch(() => {})
            let text: string
            try {
                text = await this.io.read(this.path)
            } catch {
                return false
            }
            // A save queued while we were reading flushes against a newer app state than this
            // read: adopting it would drop that edit from the UI. Wait for it and read again.
            if (this.writeChain !== chain) continue
            if (text === this.lastText) {
                // our own write (or unchanged) — nothing external; the file is readable again
                this.parseError = null
                this.refusedMsg = null
                return false
            }
            try {
                this.adopt(text)
            } catch (e) {
                this.parseError = e as Error
                return false
            }
            return true
        }
    }

    load(): EventsFile | null {
        return this.snapshot
    }

    save(data: EventsFile): void {
        this.snapshot = data
        // Snapshot NOW (synchronously) so the queued write persists this exact state even if
        // `data` mutates before the chain reaches it.
        const mine: CalendarEvent[] = JSON.parse(JSON.stringify(data.events))
        const mineCats: Category[] = JSON.parse(JSON.stringify(data.categories))
        this.writeChain = this.writeChain
            .then(() => this.flush(mine, mineCats))
            .catch(() => {})
    }

    /** Block a write and tell the user once per refusal. */
    private refuse(err: Error): void {
        this.parseError = err
        if (err.message !== this.refusedMsg)
            pushToast(`Calendar not saved: ${err.message}`, { tone: 'danger' })
        this.refusedMsg = err.message
    }

    private withCats(
        fm: Record<string, unknown>,
        cats: Category[],
    ): Record<string, unknown> {
        const out = { ...fm }
        if (cats.length) out.categories = cats
        else delete out.categories
        return out
    }

    private async flush(
        mine: CalendarEvent[],
        mineCats: Category[],
    ): Promise<void> {
        let disk: string | null = null
        try {
            disk = await this.io.read(this.path)
        } catch {
            disk = null
        }
        if (disk === null && this.lastText !== null) {
            // the file existed at load and cannot be read now: moved or deleted. Writing would
            // recreate it at the old path.
            this.refuse(
                new Error(
                    `Calendar moved or deleted: ${this.path} could not be read, so your change was not saved`,
                ),
            )
            return
        }
        let fm = this.frontmatter
        let format = this.format
        let events = mine
        let cats = mineCats
        if (disk !== null) {
            let theirs
            try {
                theirs = parseCalendarFile(disk)
            } catch (e) {
                this.refuse(e as Error)
                return // refuse: writing would drop the unparseable lines
            }
            fm = theirs.frontmatter
            format = theirs.format
            events = mergeEvents(this.known, mine, theirs.events)
            // categories: an app change wins, otherwise follow the file
            cats = same(mineCats, this.knownCats)
                ? categoriesOf(theirs.frontmatter)
                : mineCats
        }
        const text = serializeCalendarFile(
            this.withCats(fm, cats),
            events,
            format,
            disk ?? undefined,
        )
        const intent = serializeCalendarFile(
            this.withCats(this.frontmatter, mineCats),
            mine,
            this.format,
        )
        if (text !== disk) await this.io.write(this.path, text)
        this.refusedMsg = null
        // The merge base is what the APP knows. If the merge pulled in external changes the
        // app does not show yet, remember our own intent as lastText so reloadIfChanged() sees
        // the difference and adopts them; otherwise this write is our own echo.
        this.known = mine
        this.knownCats = mineCats
        const byId = (a: CalendarEvent, b: CalendarEvent) =>
            a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        const unchanged =
            same([...events].sort(byId), [...mine].sort(byId)) &&
            same(cats, mineCats)
        this.lastText = unchanged ? text : intent
        if (unchanged) {
            this.frontmatter = fm
            this.format = format
        }
    }
}
