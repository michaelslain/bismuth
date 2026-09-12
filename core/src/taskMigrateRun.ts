// The vault-wide, once-per-vault conversion of emoji task signifiers to bracket fields.
//
// `core/src/tasks.ts` no longer reads the emoji spelling at all (see taskLegacy.ts for why),
// so an un-migrated vault does not merely look different — it silently stops having dates,
// priorities and recurrences. This pass is what stands between an old vault and that loss.
//
// It REWRITES THE USER'S OWN NOTES, automatically, with no prompt. That was a deliberate
// choice over a confirmation dialog, and it was made on one condition: a local git snapshot
// is taken first. Hence the ordering below, which is the whole design of this module:
//
//   1. SCAN   — read every markdown file once, pre-filter on hasLegacySignifier, and compute
//               the migrated content IN MEMORY. Nothing is written.
//   2. GATE   — if no line actually changed, stop here. `hasLegacySignifier` matches ✅, an
//               ordinary emoji people write in prose, so "the scan found a signifier" is NOT
//               the same question as "anything needs migrating". Reporting a run off the
//               scan would git-commit a user's whole vault to snapshot a rewrite that never
//               happened.
//   3. SNAPSHOT — commitVault(). If it THROWS the run is BLOCKED: nothing is rewritten and the
//               report says so, because a silent abort on a machine with no usable git means
//               the vault is never migrated and its dates are invisible to the app forever
//               with no message anywhere.
//   4. VERIFY — a directory walk and a git snapshot do not see the same vault. `git add -A`
//               honours .gitignore/.git/info/exclude/core.excludesFile and records a nested
//               repo as a gitlink; `listMarkdown` honours none of that. So ask git what it
//               actually tracks and DROP everything it does not: a skipped file keeps its
//               emoji syntax and can be converted by hand, an overwritten file that is in no
//               commit is gone. Never `git add -f` — that would start permanently tracking a
//               file the user deliberately ignored, which is not ours to decide.
//   5. WRITE  — from the content computed in step 1, but only after RE-READING each file and
//               confirming the bytes still match what was scanned. The snapshot subprocess
//               chain sits between the scan and the write, and at boot that window overlaps
//               the daemon starting; an external write landing in it must not be clobbered.
//
// Everything held back at any step lands in `skipped` with its reason, because a console
// warning is invisible in a bundled app and an un-migrated note is a note that has lost its
// dates until someone notices.
//
// A second boot re-scans and finds nothing to DO — note the gate is `pending.length === 0`,
// not "no signifier anywhere". Signifiers legitimately survive a successful run: a dangling
// `📅` with no date, a `✅` in prose, a fenced example, a signifier inside an inline code
// span. Those files re-enter the scan every boot forever and cost one read each, which is why
// the gate is phrased against pending work rather than against the pre-filter. There is no
// marker file — the vault's own content is the state.
//
// DESKTOP AND DEV ONLY. `createServer` is the only caller. Do not wire this into
// localBackend.ts: commitVault shells out to `git`, and there is no git on iPad, so a
// mobile-side run would be exactly the un-undoable mass rewrite the snapshot exists to
// prevent. An iPad-only vault therefore keeps its emoji syntax, and because tasks.ts no
// longer reads that spelling, its dates/priorities/recurrences stay invisible in the app
// until the vault is next opened on a desktop. Nothing is lost — the file text itself is
// untouched. This is accepted, not a bug, while the app is desktop-first; see
// docs/mobile/overview.md. Reads and writes still go through getFileAccess() rather than
// files.ts so this module never pulls `node:fs` into a graph that might be bundled for the
// WebView.
import { commitVault, trackedPaths } from './backup'
import { getFileAccess } from './fileAccess'
import { hasLegacySignifier } from './taskLegacy'
import { migrateContent } from './taskMigrate'

/** A line the rewrite could not round-trip, named so a human can go and look at it. `text`
 *  is the line AS WRITTEN BACK, and `line` is 0-indexed within `file`. In practice this is a
 *  calendar-impossible date (`📅 2026-02-30`): the emoji path validated only the shape, the
 *  bracket grammar additionally requires a real day, so it lands as literal description text
 *  — visible at last, instead of a date that could never match a real day. */
export interface FlaggedLine {
    file: string
    line: number
    text: string
}

/** A note that still holds legacy syntax after this run, and why. Every one of these has lost
 *  its dates and priorities as far as the app is concerned, so the user has to be told. */
export interface SkippedFile {
    file: string
    reason:
        /** git does not track it, so the snapshot could not hold it (ignored, or inside a
         *  nested repo). Rewriting it would be an edit with no undo. */
        | 'not-snapshotted'
        /** The scan could not read it. */
        | 'unreadable'
        /** Its bytes changed between the scan and the write — something else owns it right now. */
        | 'modified-during-migration'
        /** The write itself failed. */
        | 'write-failed'
    error?: string
}

export interface MigrationReport {
    /** Did this run actually rewrite anything? Keyed off `changed > 0`, never off the scan. */
    ran: boolean
    /** The snapshot could not be taken, so NOTHING was rewritten and the vault still needs
     *  migrating. Distinct from `ran: false`, which means there was nothing to do. */
    blocked: boolean
    /** Why the snapshot failed, when `blocked`. */
    snapshotError?: string
    /** Total task lines rewritten across every file. */
    changed: number
    /** The notes that were rewritten, with each one's count, in scan order. */
    files: Array<{ file: string; changed: number }>
    flagged: FlaggedLine[]
    skipped: SkippedFile[]
    /** Did THIS run write a snapshot commit? `false` alongside `ran: true` means the vault's
     *  repo was already clean, so its pre-migration content is HEAD and is just as
     *  recoverable — which is why step 4 verifies capture against git's index rather than
     *  trusting this flag. */
    snapshot: boolean
}

const SNAPSHOT_MESSAGE = 'before task syntax migration'

const emptyReport = (): MigrationReport => ({
    ran: false,
    blocked: false,
    changed: 0,
    files: [],
    flagged: [],
    skipped: [],
    snapshot: false,
})

/** One file's pending rewrite, held in memory between the scan and the write. */
interface Pending {
    rel: string
    /** Exactly what the scan read, so the write phase can prove nothing moved underneath it. */
    original: string
    content: string
    changed: number
    /** 0-indexed line numbers within `content` whose rewrite did not round-trip. */
    flagged: number[]
}

/**
 * Convert every legacy task line in `root` to bracket fields, once. Safe to call on every
 * boot: a migrated vault costs one read per markdown file and writes nothing.
 *
 * Never throws — a boot-time fire-and-forget caller has nowhere to put an error. Every failure
 * is reported instead: an unlistable vault as an empty report, a failed snapshot as
 * `blocked`, and a per-file problem in `skipped`.
 */
export async function runTaskMigration(root: string): Promise<MigrationReport> {
    // Must stay BEFORE the first `await`: core/test/server.test.ts sets this variable around a
    // single synchronous `createServer(...)` call and deletes it immediately after, which only
    // works while this check runs in that same synchronous turn.
    if (process.env.BISMUTH_NO_TASK_MIGRATE === '1') return emptyReport()

    const { listMarkdown, readNote, writeNote } = await getFileAccess()

    let rels: string[]
    try {
        rels = await listMarkdown(root)
    } catch (err) {
        warn(`could not list ${root}`, err)
        return emptyReport()
    }

    // ── 1. Scan ──────────────────────────────────────────────────────────────────────
    // Reads run together (the same shape collectVaultTasks uses) and each one carries its own
    // failure, so a single unreadable file is skipped and reported rather than aborting the
    // run and leaving the vault half migrated. Order is preserved, so `files` is stable.
    const scanned = await Promise.all(
        rels.map(async rel => {
            try {
                return { rel, text: await readNote(root, rel), error: '' }
            } catch (err) {
                return { rel, text: null, error: message(err) }
            }
        }),
    )

    const skipped: SkippedFile[] = []
    const pending: Pending[] = []
    for (const { rel, text, error } of scanned) {
        if (text === null) {
            warn(`could not read ${rel}`, error)
            skipped.push({ file: rel, reason: 'unreadable', error })
            continue
        }
        // Cheap whole-file pre-filter: most notes hold no signifier at all and never reach
        // the per-line work. migrateContent gates AGAIN per line, which is what stops a note
        // holding one emoji task from having its already-correct lines reformatted too.
        if (!hasLegacySignifier(text)) continue
        const res = migrateContent(text)
        if (res.changed === 0) continue
        pending.push({
            rel,
            original: text,
            content: res.content,
            changed: res.changed,
            flagged: res.flagged,
        })
    }

    // ── 2. Gate ──────────────────────────────────────────────────────────────────────
    if (pending.length === 0) return { ...emptyReport(), skipped }

    // ── 3. Snapshot ──────────────────────────────────────────────────────────────────
    let snapshot: boolean
    try {
        // The boolean is "a commit was written". `false` means there was nothing to commit —
        // the repo was already clean, so HEAD already holds the pre-migration content. Only a
        // THROW (no git on PATH, an unresolvable work tree, a redirected repo) means the state
        // is not captured, and that is the case that must block.
        snapshot = await commitVault(root, SNAPSHOT_MESSAGE)
    } catch (err) {
        warn('snapshot failed — leaving the vault untouched', err)
        return { ...emptyReport(), blocked: true, snapshotError: message(err) }
    }

    // ── 4. Verify the snapshot actually holds what we are about to overwrite ─────────
    // Compared in NFC on both sides. macOS preserves whatever bytes created a file (APFS keeps
    // NFD), while git sets core.precomposeunicode and records NFC in its index — so the WALKED
    // name and the TRACKED name for one file can differ by normalisation alone. Raw equality
    // then decides git does not track an ordinary accented or CJK filename, and the note is
    // left un-migrated under a reason ("not-snapshotted") that sends the user hunting for a
    // gitignore rule that does not exist. Writes still use `p.rel`, the name that resolves on
    // disk; only the comparison is normalised.
    const tracked = new Set(
        [...(await trackedPaths(root))].map(p => p.normalize('NFC')),
    )
    const writable = pending.filter(p => {
        if (tracked.has(p.rel.normalize('NFC'))) return true
        warn(`${p.rel} is not tracked by git — leaving it un-migrated`)
        skipped.push({ file: p.rel, reason: 'not-snapshotted' })
        return false
    })

    // ── 5. Write ─────────────────────────────────────────────────────────────────────
    const files: Array<{ file: string; changed: number }> = []
    const flagged: FlaggedLine[] = []
    let changed = 0
    for (const p of writable) {
        try {
            // Re-read: the snapshot above is a subprocess chain, and on a vault's first ever
            // commit that is seconds. The editor is safe (it re-reads and merges, and PUT
            // /file has an optimistic-concurrency check) but the daemon, the CLI and any
            // external sync client are not.
            if ((await readNote(root, p.rel)) !== p.original) {
                warn(`${p.rel} changed during the migration — leaving it alone`)
                skipped.push({
                    file: p.rel,
                    reason: 'modified-during-migration',
                })
                continue
            }
            await writeNote(root, p.rel, p.content)
        } catch (err) {
            warn(`could not write ${p.rel}`, err)
            skipped.push({
                file: p.rel,
                reason: 'write-failed',
                error: message(err),
            })
            continue
        }
        files.push({ file: p.rel, changed: p.changed })
        changed += p.changed
        if (p.flagged.length === 0) continue
        const lines = p.content.split(/\r\n|\r|\n/)
        for (const line of p.flagged)
            flagged.push({ file: p.rel, line, text: lines[line] ?? '' })
    }

    return {
        ran: changed > 0,
        blocked: false,
        changed,
        files,
        flagged,
        skipped,
        snapshot,
    }
}

const message = (err: unknown): string =>
    err instanceof Error ? err.message : String(err)

function warn(text: string, err?: unknown): void {
    const detail = err === undefined ? '' : `: ${message(err)}`
    console.warn(`[task migration] ${text}${detail}`)
}
