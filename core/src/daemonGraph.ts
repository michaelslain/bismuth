// core/src/daemonGraph.ts
// Reads the daemon's on-disk cron/process state into a snapshot (`daemonSnapshot()` — served as
// GET /daemon/snapshot to the app's daemon page), and turns that snapshot into GraphData
// (`daemonGraph()`/`buildDaemonGraph()` — used only by the CLI's `bismuth daemon graph`; the app's
// graph view no longer has a daemon mode).
//
// PER-VAULT: crons/processes live under the active vault's `.daemon` dir (vaultDaemonDir(vault)),
// passed in as `home`. The daemon LIVENESS (the pid), by contrast, is MACHINE-level — read from
// daemonMachineDir()/daemon.pid, NOT from `<home>` — because one machine process multiplexes
// every vault's brain. Bismuth only READS here (no writes, no subprocess spawn). Every read
// tolerates missing/malformed files and NEVER throws: a daemon that has never run, or a
// half-written JSON file, degrades to an empty/partial snapshot.
//
// Layout on disk (the integration contract we read, authored by the daemon):
//   <machine-dir>/daemon.pid           — running daemon's pid (presence + liveness ⇒ running)
//   <home>/crons/<name>.md             — cron def; frontmatter { name, schedule, enabled? } OR,
//                                        for a file-change cron, { name, on: file-change, watch, enabled? }
//   <home>/crons/.last-fired.json      — { "<name>": { timestamp, result } }
//   <home>/crons/.running.json         — { "<name>": { startedAt } }
//   <home>/processes/<name>.md         — process def; frontmatter { name, enabled? }
//
// Only crons/processes that EXIST as *.md files are included — stale `.last-fired` entries with
// no backing file (e.g. a renamed/removed cron) are dropped.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { daemonMachineDir } from './daemon'
import {
    isDaemonAlive,
    readJsonObj,
    readFrontmatter,
    isEnabled,
} from './daemonState'
import { parseFrontmatter } from './frontmatter'
import type { GraphData, GraphNode, GraphEdge } from './graph'

export const DAEMON_NODE_ID = '::daemon'

export interface DaemonCron {
    /** The cron's key: frontmatter `name`, else the file basename. Toggle/run APIs take this. */
    name: string
    /** The definition file's basename without `.md` (`<home>/crons/<file>.md`). Differs from
     *  `name` when the frontmatter names the cron something other than its file — so anything
     *  opening the definition must use this, never `name`. */
    file: string
    schedule: string
    /** Trigger kind. Defaults to "schedule" for any cron lacking (or not matching) an `on:
     *  file-change` frontmatter — i.e. every pre-existing cron on disk. */
    on: 'schedule' | 'file-change'
    /** Vault-relative path/glob this cron watches, or null (schedule-triggered / absent). */
    watch: string | null
    enabled: boolean
    lastFired: { timestamp: string; result: string; detail?: string } | null
    running: boolean
    startedAt: string | null
}

export interface DaemonProcess {
    /** The process's key: frontmatter `name`, else the file basename. Toggle APIs take this. */
    name: string
    /** The definition file's basename without `.md` (`<home>/processes/<file>.md`). */
    file: string
    enabled: boolean
    /** Always false today: the daemon exposes no per-process liveness file core can trust. */
    running: boolean
}

export interface DaemonSnapshot {
    daemon: { label: string; running: boolean; home: string }
    crons: DaemonCron[]
    processes: DaemonProcess[]
    /** The daemon's identity for the daemon page's face: `name` mirrors `daemon.label`
     *  (both trace back to `daemonIdentityName`); `blurb` is the first non-empty line of
     *  `<home>/identity.md`'s BODY (after frontmatter), trimmed — `''` when absent. */
    identity: { name: string; blurb: string }
}

/** First non-empty line of `<home>/identity.md`'s BODY (after frontmatter), trimmed; `''`
 *  when the file is absent, has no body, or fails to read. Never throws. */
function identityBlurb(home: string): string {
    try {
        const { body } = parseFrontmatter(
            readFileSync(join(home, 'identity.md'), 'utf8'),
        )
        const line = body
            .split('\n')
            .map(l => l.trim())
            .find(l => l.length > 0)
        return line ?? ''
    } catch {
        return ''
    }
}

/** List `*.md` basenames (without extension) directly under `dir`; [] if the dir is absent. */
function listMarkdownNames(dir: string): string[] {
    try {
        return readdirSync(dir)
            .filter(f => f.endsWith('.md') && !f.startsWith('.'))
            .map(f => f.slice(0, -3))
            .sort() // deterministic order (readdir order is fs-dependent)
    } catch {
        return []
    }
}

/**
 * Read a vault's daemon cron/process state into a snapshot. `home` is the vault's `.daemon`
 * dir (vaultDaemonDir(vault)) — crons/processes are read from `<home>/crons` + `<home>/processes`;
 * the daemon's `running` flag is read MACHINE-level (daemonMachineDir()/daemon.pid). NEVER throws —
 * any failure degrades to `{ daemon, crons: [], processes: [] }`. `home` is injectable so tests
 * point it at a fixture dir.
 */
export function daemonSnapshot(
    home: string = daemonMachineDir(),
    name: string = 'daemon',
): DaemonSnapshot {
    const daemon = {
        label: name,
        running: isDaemonAlive(daemonMachineDir()),
        home,
    }
    const identity = { name, blurb: identityBlurb(home) }
    try {
        const cronsDir = join(home, 'crons')
        const lastFired = readJsonObj(join(cronsDir, '.last-fired.json'))
        const runningMap = readJsonObj(join(cronsDir, '.running.json'))

        const crons: DaemonCron[] = listMarkdownNames(cronsDir).map(name => {
            const data = readFrontmatter(join(cronsDir, `${name}.md`))
            const fm = (typeof data.name === 'string' && data.name) || name
            const lf = lastFired[fm]
            const run = runningMap[fm]
            const lfAny = lf as any
            const lastFiredEntry =
                lf && typeof lf === 'object'
                    ? {
                          timestamp:
                              typeof lfAny.timestamp === 'string'
                                  ? lfAny.timestamp
                                  : '',
                          result:
                              typeof lfAny.result === 'string'
                                  ? lfAny.result
                                  : 'unknown',
                          // Present only for a "skipped" incremental-cron run (see daemon/src/daemon/cron.ts) —
                          // the human-readable reason, e.g. "skipped: no changes since <ISO>".
                          ...(typeof lfAny.detail === 'string'
                              ? { detail: lfAny.detail }
                              : {}),
                      }
                    : null
            const startedAt =
                run &&
                typeof run === 'object' &&
                typeof (run as any).startedAt === 'string'
                    ? (run as any).startedAt
                    : null
            const on = data.on === 'file-change' ? 'file-change' : 'schedule'
            const watch =
                typeof data.watch === 'string' && data.watch ? data.watch : null
            return {
                name: fm,
                file: name,
                schedule:
                    typeof data.schedule === 'string' ? data.schedule : '',
                on,
                watch,
                enabled: isEnabled(data),
                lastFired: lastFiredEntry,
                running: startedAt != null,
                startedAt,
            }
        })

        const procDir = join(home, 'processes')
        const processes: DaemonProcess[] = listMarkdownNames(procDir).map(
            name => {
                const data = readFrontmatter(join(procDir, `${name}.md`))
                const fm = (typeof data.name === 'string' && data.name) || name
                // `running` is best-effort: the daemon doesn't expose a per-process liveness file we can
                // trust, so default false (unknown) rather than guess.
                return {
                    name: fm,
                    file: name,
                    enabled: isEnabled(data),
                    running: false,
                }
            },
        )

        return { daemon, crons, processes, identity }
    } catch {
        return { daemon, crons: [], processes: [], identity }
    }
}

/** Epoch-ms for an ISO timestamp, or null when absent/unparseable. */
function toMs(ts: string | undefined | null): number | null {
    if (!ts) return null
    const ms = Date.parse(ts)
    return Number.isFinite(ms) ? ms : null
}

/**
 * Build the DAEMON-mode GraphData from a snapshot: one `daemon` hub, one node per cron + per
 * process, and a `supervises` edge from the hub to each. There is NO "you" node — the daemon hub
 * is the center (mirrors agents mode, which also injects no frontend self node). Each cron/process
 * node carries `daemon` viz-state metadata (`nodeVisualState` turns it into opacity + tint).
 */
export function buildDaemonGraph(snap: DaemonSnapshot): GraphData {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []

    nodes.push({ id: DAEMON_NODE_ID, label: snap.daemon.label, kind: 'daemon' })

    for (const c of snap.crons) {
        const id = `cron:${c.name}`
        nodes.push({
            id,
            label: c.name,
            kind: 'cron',
            daemon: {
                enabled: c.enabled,
                running: c.running,
                // A "skipped" incremental run carries its reason in `detail` (e.g. "skipped: no changes
                // since 2026-07-20T10:00:00Z") — surface that verbatim as lastResult so it's visible in
                // `bismuth daemon graph` / the sidebar instead of the bare enum value.
                lastResult:
                    (c.lastFired?.result === 'skipped' && c.lastFired.detail) ||
                    c.lastFired?.result ||
                    null,
                lastFiredMs: toMs(c.lastFired?.timestamp),
                schedule: c.schedule || undefined,
                on: c.on,
                watch: c.watch ?? undefined,
            },
        })
        edges.push({ from: DAEMON_NODE_ID, to: id, kind: 'supervises' })
    }

    for (const p of snap.processes) {
        const id = `process:${p.name}`
        nodes.push({
            id,
            label: p.name,
            kind: 'process',
            daemon: {
                enabled: p.enabled,
                running: p.running,
                lastResult: null,
                lastFiredMs: null,
            },
        })
        edges.push({ from: DAEMON_NODE_ID, to: id, kind: 'supervises' })
    }

    return { nodes, edges }
}

/** Convenience: snapshot the real (or injected) home and build its graph. Never throws. */
export function daemonGraph(
    home: string = daemonMachineDir(),
    name: string = 'daemon',
): GraphData {
    return buildDaemonGraph(daemonSnapshot(home, name))
}
