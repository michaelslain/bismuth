/**
 * core/src/appErrors.ts — the log of errors the app window threw and nothing caught.
 *
 * The window reports every uncaught error and unhandled promise rejection (app/src/errorReport.ts)
 * to `POST /app-errors`, which appends one JSON line to `~/.bismuth/logs/app-errors.jsonl`. The
 * log is machine-wide, so each entry names the vault its window had open. `bismuth errors` reads
 * it, which is how a person or an agent finds out what broke.
 *
 * Appending a whole line per entry keeps concurrent windows from corrupting each other. Once the
 * file passes `MAX_BYTES` it is rewritten with its newest `KEEP_ENTRIES` lines, so a window that
 * throws in a loop cannot fill the disk. The reader never throws: a missing file or a malformed
 * line degrades to fewer entries.
 */
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { bismuthHome } from './bismuthHome'

export type AppErrorKind = 'error' | 'rejection'

export type AppErrorEntry = {
    ts: string
    kind: AppErrorKind
    message: string
    stack?: string
    /** `file:line:col` of the throw, when the browser reported one. */
    source?: string
    /** The vault the reporting window had open. */
    vault?: string
}

const MAX_MESSAGE = 2_000
const MAX_STACK = 8_000
const MAX_SOURCE = 500
export const MAX_BYTES = 512 * 1024
export const KEEP_ENTRIES = 500

export function appErrorsPath(): string {
    return bismuthHome('logs', 'app-errors.jsonl')
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

/** Validate a report body from the window; null when it is not a report. */
export function parseAppErrorReport(
    body: unknown,
): Omit<AppErrorEntry, 'ts' | 'vault'> | null {
    if (typeof body !== 'object' || body === null) return null
    const b = body as Record<string, unknown>
    if (b.kind !== 'error' && b.kind !== 'rejection') return null
    if (typeof b.message !== 'string' || !b.message.trim()) return null
    const out: Omit<AppErrorEntry, 'ts' | 'vault'> = {
        kind: b.kind,
        message: clip(b.message, MAX_MESSAGE),
    }
    if (typeof b.stack === 'string' && b.stack.trim())
        out.stack = clip(b.stack, MAX_STACK)
    if (typeof b.source === 'string' && b.source.trim())
        out.source = clip(b.source, MAX_SOURCE)
    return out
}

/** Append one entry, trimming the file to its newest entries once it grows past `MAX_BYTES`.
 *  `now` and `file` are injectable for tests. */
export function recordAppError(
    report: Omit<AppErrorEntry, 'ts'>,
    now: Date = new Date(),
    file: string = appErrorsPath(),
): AppErrorEntry {
    const entry: AppErrorEntry = { ts: now.toISOString(), ...report }
    if (!entry.vault) delete entry.vault
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(entry) + '\n')
    let size = 0
    try {
        size = statSync(file).size
    } catch {}
    if (size > MAX_BYTES) {
        const lines = readFileSync(file, 'utf8')
            .split('\n')
            .filter(l => l.trim())
        writeFileSync(file, lines.slice(-KEEP_ENTRIES).join('\n') + '\n')
    }
    return entry
}

/** Every entry, oldest first. `since` (an ISO instant) keeps only later entries; `vault` keeps
 *  only that vault's; `limit` keeps the newest `limit`. */
export function readAppErrors(
    opts: { since?: string; vault?: string; limit?: number } = {},
    file: string = appErrorsPath(),
): AppErrorEntry[] {
    let text: string
    try {
        text = readFileSync(file, 'utf8')
    } catch {
        return []
    }
    const floor = opts.since ? Date.parse(opts.since) : NaN
    const out: AppErrorEntry[] = []
    for (const line of text.split('\n')) {
        if (!line.trim()) continue
        let e: unknown
        try {
            e = JSON.parse(line)
        } catch {
            continue
        }
        if (typeof e !== 'object' || e === null) continue
        const entry = e as AppErrorEntry
        if (typeof entry.ts !== 'string' || typeof entry.message !== 'string')
            continue
        if (!Number.isNaN(floor) && !(Date.parse(entry.ts) > floor)) continue
        if (opts.vault && entry.vault !== opts.vault) continue
        out.push(entry)
    }
    return opts.limit && opts.limit > 0 ? out.slice(-opts.limit) : out
}

/** Empty the log; returns how many entries it held. */
export function clearAppErrors(file: string = appErrorsPath()): number {
    const n = readAppErrors({}, file).length
    try {
        writeFileSync(file, '')
    } catch {}
    return n
}
