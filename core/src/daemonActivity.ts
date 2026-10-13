/**
 * core/src/daemonActivity.ts — core's window onto the daemon's activity log.
 *
 * The daemon writes `<vault>/.daemon/logs/activity-YYYY-MM-DD.jsonl` (one JSON object per line,
 * one file per UTC day; see daemon/src/lib/activityLog.ts). Core reads it, and writes it in two
 * places: appendActivity (`doctor`, one event per repair the doctor applies, so a repair shows up
 * beside the daemon's events in the daemon page and `bismuth daemon logs`) and deleteActivityEntry
 * (the daemon page's `[ delete ]` on a log row). Appending a whole line is the daemon's own write
 * discipline, so the writers never corrupt each other.
 *
 * NEVER THROWS, like every other reader in this family: a missing dir, an unreadable file, a
 * truncated line, or a hand-edited file degrades to fewer events, never an exception. A cron
 * post-mortem is exactly the moment the tree is most likely to be in a strange state.
 *
 * The ActivityEvent shape here is a DELIBERATE literal duplicate of the daemon's, not an import:
 * @bismuth/daemon is a separately-versioned, separately-bundled binary and core must not depend on
 * it (the same convention daemon/src/lib/bismuthPaths.ts documents in the other direction). The
 * two are joined by the on-disk format, and this reader validates every field it relies on at
 * runtime, so a daemon that adds a field is forward-compatible and one that drops a required
 * field degrades to skipping those lines.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { writeFileAtomicSync } from './atomicWrite'
import { join } from 'node:path'

export interface ActivityEvent {
    ts: string
    kind: string
    name: string
    event: string
    outcome?: string
    cause?: string
    durationMs?: number
    detail?: string
    /** A cron's closing report line, on `finished`. */
    summary?: string
    /** The day file the event was read from (`activity-YYYY-MM-DD.jsonl`, under `.daemon/logs/`).
     *  Set by readActivity, never written by the daemon. */
    file?: string
}

export interface ActivityQuery {
    /** Newest N events. Defaults to ACTIVITY_DEFAULT_LIMIT, clamped to ACTIVITY_MAX_LIMIT. */
    limit?: number
    /** Only this kind ("cron" | "process" | "daemon" | "session"). */
    kind?: string
    /** Only this cron/process name. */
    name?: string
    /** Only events at or after this ISO instant. An unparseable value is ignored. */
    since?: string
}

export const ACTIVITY_DEFAULT_LIMIT = 100
export const ACTIVITY_MAX_LIMIT = 1000

const FILE_RE = /^activity-(\d{4}-\d{2}-\d{2})\.jsonl$/

/** Clamp a caller-supplied limit into range; anything non-finite or <= 0 falls back to default. */
function resolveLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0)
        return ACTIVITY_DEFAULT_LIMIT
    return Math.min(Math.floor(limit), ACTIVITY_MAX_LIMIT)
}

/**
 * Read this vault's activity events, newest first.
 *
 * Day files are visited newest-first and the scan stops once the limit is met, so asking for the
 * last 50 events never reads a year of history.
 */
export function readActivity(
    daemonDir: string,
    q: ActivityQuery = {},
): ActivityEvent[] {
    const limit = resolveLimit(q.limit)
    const logsDir = join(daemonDir, 'logs')

    let files: string[]
    try {
        files = readdirSync(logsDir)
            .filter(n => FILE_RE.test(n))
            .sort()
            .reverse()
    } catch {
        return []
    }

    const sinceMs = q.since ? Date.parse(q.since) : Number.NaN
    const hasSince = !Number.isNaN(sinceMs)

    const out: ActivityEvent[] = []
    for (const file of files) {
        let text: string
        try {
            text = readFileSync(join(logsDir, file), 'utf-8')
        } catch {
            continue
        }

        const inFile: ActivityEvent[] = []
        for (const raw of text.split('\n')) {
            const trimmed = raw.trim()
            if (!trimmed) continue
            let parsed: unknown
            try {
                parsed = JSON.parse(trimmed)
            } catch {
                continue
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                continue
            const e = parsed as Record<string, unknown>
            if (
                typeof e.ts !== 'string' ||
                typeof e.kind !== 'string' ||
                typeof e.name !== 'string' ||
                typeof e.event !== 'string'
            )
                continue
            if (q.kind && e.kind !== q.kind) continue
            if (q.name && e.name !== q.name) continue
            if (hasSince) {
                const ms = Date.parse(e.ts)
                if (Number.isNaN(ms) || ms < sinceMs) continue
            }
            inFile.push({ ...(e as unknown as ActivityEvent), file })
        }

        // Within one day file the lines are already append-ordered (oldest first); reverse for
        // newest-first, then sort the accumulated set defensively — a clock step or a manual edit
        // can put a line out of order, and "newest first" should survive that.
        inFile.reverse()
        out.push(...inFile)
        if (out.length >= limit) break
    }

    out.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    return out.slice(0, limit)
}

/**
 * Append one event to `<daemonDir>/logs/activity-<UTC day of event.ts>.jsonl`, the file the daemon
 * itself appends to. Does nothing when `daemonDir` does not exist (a vault that never ran the
 * daemon has no log to show the event in). Never throws.
 */
export function appendActivity(daemonDir: string, event: ActivityEvent): void {
    try {
        readdirSync(daemonDir)
    } catch {
        return
    }
    try {
        const logsDir = join(daemonDir, 'logs')
        mkdirSync(logsDir, { recursive: true })
        const day = new Date(event.ts).toISOString().slice(0, 10)
        appendFileSync(
            join(logsDir, `activity-${day}.jsonl`),
            `${JSON.stringify(event)}\n`,
        )
    } catch {
        // observability, not work: a full disk must not fail the repair it describes
    }
}

/** What identifies one logged event inside its day file. */
export type ActivityEntryRef = Pick<
    ActivityEvent,
    'ts' | 'kind' | 'name' | 'event' | 'outcome'
> & { file: string }

const sameEntry = (e: Record<string, unknown>, ref: ActivityEntryRef) =>
    e.ts === ref.ts &&
    e.kind === ref.kind &&
    e.name === ref.name &&
    e.event === ref.event &&
    (e.outcome ?? undefined) === (ref.outcome ?? undefined)

/**
 * Remove one event's line from its day file; true when a line was removed. Only the first match
 * goes, so two identical lines lose one per call. The file name must be a day file (no path), so a
 * caller cannot reach outside `logs/`.
 *
 * The daemon appends to today's file while this rewrites it. The rewrite re-reads just before the
 * rename and starts over when the file grew, so an append that lands while it runs is kept.
 */
export function deleteActivityEntry(
    daemonDir: string,
    ref: ActivityEntryRef,
): boolean {
    if (!FILE_RE.test(ref.file)) return false
    const path = join(daemonDir, 'logs', ref.file)
    for (let attempt = 0; attempt < 5; attempt++) {
        let text: string
        try {
            text = readFileSync(path, 'utf-8')
        } catch {
            return false
        }
        const lines = text.split('\n')
        const at = lines.findIndex(raw => {
            try {
                const parsed: unknown = JSON.parse(raw.trim())
                return (
                    !!parsed &&
                    typeof parsed === 'object' &&
                    sameEntry(parsed as Record<string, unknown>, ref)
                )
            } catch {
                return false
            }
        })
        if (at === -1) return false
        lines.splice(at, 1)
        if (readFileSync(path, 'utf-8') !== text) continue
        writeFileAtomicSync(path, lines.join('\n'))
        return true
    }
    return false
}
