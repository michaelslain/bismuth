/**
 * daemon/src/lib/activityLog.ts — the daemon's append-only activity log.
 *
 * WHY THIS EXISTS. Until now every cron outcome and every process lifecycle event was a
 * `console.log` that went wherever launchd pointed the daemon's stdout, and the only durable
 * per-vault record was `.last-fired.json` — which keeps ONE entry per cron and overwrites it on
 * the next run. cron.ts says so itself, at the failure branch: "the on-disk entry only keeps the
 * LATEST outcome, so the log is the only place a post-mortem can see which class of failure drove
 * a backoff". session.ts calls its own refusal line "a daemon log nobody reads". This module is
 * the log somebody can read.
 *
 * FORMAT: one JSON object per line (JSONL), one file per UTC day, in the `logs/` dir vaultPaths()
 * already resolves and ensureVaultDirs() already creates. Append-only is the whole point — there
 * is no read-modify-write, so a crash mid-write costs at most a truncated trailing line rather
 * than the corrupted blob an atomic-rename JSON file would risk on a growing record. Daily files
 * give rotation and retention for free (see pruneActivityLogs).
 *
 * The `<process>.stdout.log` / `.stderr.log` files written by process.ts live in this SAME dir and
 * are deliberately untouched: they are raw child streams, this is structured daemon behaviour. The
 * `activity-` prefix keeps the two sets disjoint, and every function here filters on it so a
 * prune can never eat a process's output.
 *
 * NEVER THROWS. Logging is observability, not work: a full disk or a read-only vault must not take
 * down a cron. Every I/O path here swallows its error (and says so on the console, which is where
 * such a failure belonged in the first place).
 */
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { enqueueWrite } from './writeQueue'
import { ACTIVITY_RETENTION_DAYS, type VaultContext } from './config'

export type ActivityKind = 'cron' | 'process' | 'daemon' | 'session'

/** Mirrors LastFiredEntry['result'] (daemon/src/daemon/cron.ts) so the log and `.last-fired.json`
 *  never disagree about vocabulary. */
export type ActivityOutcome =
    | 'success'
    | 'failed'
    | 'unknown'
    | 'killed'
    | 'skipped'

export interface ActivityEvent {
    /** ISO-8601 UTC. */
    ts: string
    kind: ActivityKind
    /** Cron/process name; the vault's daemon name for kind "daemon"/"session". */
    name: string
    /** What happened: "started" | "finished" | "skipped" | "exited" | … */
    event: string
    /** Terminal outcome — present only on an event that ENDS a unit of work. */
    outcome?: ActivityOutcome
    /** Failure class, mirroring cron.ts's FailureCause: "environment" | "timeout" | "job". */
    cause?: string
    /** Wall-clock duration in ms, on events that end a run. */
    durationMs?: number
    /** Human-readable one-liner — the thing an agent quotes back to the user. */
    detail?: string
}

const PREFIX = 'activity-'
const SUFFIX = '.jsonl'
/** `activity-YYYY-MM-DD.jsonl` and nothing else. */
const FILE_RE = /^activity-(\d{4}-\d{2}-\d{2})\.jsonl$/

/** Today's log file name, bucketed by UTC day so the boundary is the same on every machine. */
export function activityFileName(now: Date): string {
    return `${PREFIX}${now.toISOString().slice(0, 10)}${SUFFIX}`
}

/** One event as a newline-terminated JSON line. JSON.stringify escapes any newline inside a
 *  string field, so the emitted line is always safe to split a file on. */
export function formatActivityLine(event: ActivityEvent): string {
    return `${JSON.stringify(event)}\n`
}

/** Parse a whole log file, skipping anything unreadable. A truncated trailing line from a crash,
 *  a hand-edit, or a half-flushed write must cost that ONE line and nothing else. */
export function parseActivityLines(text: string): ActivityEvent[] {
    const out: ActivityEvent[] = []
    for (const line of text.split('\n')) {
        const trimmed = line.trim()
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
        // The four required fields. An entry missing any of them cannot be rendered or sorted, so
        // it is noise rather than data.
        if (
            typeof e.ts !== 'string' ||
            typeof e.kind !== 'string' ||
            typeof e.name !== 'string' ||
            typeof e.event !== 'string'
        )
            continue
        out.push(e as unknown as ActivityEvent)
    }
    return out
}

/** Which of `names` are activity files older than the retention window. Pure, so the arithmetic
 *  is testable without a filesystem; a non-activity file is never returned. */
export function expiredActivityFiles(
    names: string[],
    retentionDays: number,
    now: Date,
): string[] {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
        .toISOString()
        .slice(0, 10)
    return names.filter(n => {
        const m = FILE_RE.exec(n)
        return m !== null && m[1]! < cutoff
    })
}

/**
 * Append one event to this vault's log. Serialized per file path by the shared write queue, so
 * the many concurrent writers the cron tick creates (it fires every due job for every enabled
 * vault without awaiting) can never interleave inside a line.
 *
 * `ts` is stamped here when the caller omits it, so a call site only names what happened.
 */
export async function logActivity(
    ctx: VaultContext,
    event: Omit<ActivityEvent, 'ts'> & { ts?: string },
): Promise<void> {
    const stamped = event.ts ?? new Date().toISOString()
    // A caller-supplied ts that is not a real date would make activityFileName's toISOString
    // throw — and that call sits outside the try below, so it would escape this module's
    // never-throws contract entirely. Degrade to now: a mis-stamped event is worth far more
    // than a rejected promise in a fire-and-forget call site.
    const ts = Number.isNaN(Date.parse(stamped))
        ? new Date().toISOString()
        : stamped
    const full: ActivityEvent = { ...event, ts }
    const file = join(ctx.logsDir, activityFileName(new Date(full.ts)))
    try {
        await enqueueWrite(file, async () => {
            await mkdir(ctx.logsDir, { recursive: true })
            await appendFile(file, formatActivityLine(full), 'utf-8')
        })
    } catch (err) {
        // Observability must never take down the work it observes.
        console.error(`[activity] failed to log ${event.kind}/${event.name}:`, err)
    }
}

/** Delete activity files older than the retention window. Returns how many were removed.
 *  Never throws: a missing dir, an unreadable dir, or a failed unlink degrades to "removed
 *  fewer than we hoped", which is always survivable. */
export async function pruneActivityLogs(
    logsDir: string,
    retentionDays: number = ACTIVITY_RETENTION_DAYS,
    now: Date = new Date(),
): Promise<number> {
    let names: string[]
    try {
        names = await readdir(logsDir)
    } catch {
        return 0
    }
    let removed = 0
    for (const name of expiredActivityFiles(names, retentionDays, now)) {
        try {
            await unlink(join(logsDir, name))
            removed++
        } catch {
            // Another daemon instance pruned it first, or it is not ours to delete. Either way the
            // file is not our problem and the next boot will try again.
        }
    }
    return removed
}
