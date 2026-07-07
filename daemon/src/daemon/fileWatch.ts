// One filesystem watcher PER VAULT BRAIN — never one per cron. `loadCronJobs(ctx)` can define
// any number of `on: file-change` crons; a single recursive fs.watch(ctx.root) here debounces raw
// fs events into a batch, then fans that ONE batch out across every enabled file-change cron in
// the vault, matching each one's `watch` glob against the batch's changed paths (cron.ts's
// fireFileChangeCron runs the actual matches through the same session/model/timeout plumbing a
// scheduled fire uses). Mirrors the existing per-vault process-trigger loop in process.ts (one
// interval per vault, keyed by ctx.root) — this is the file-change analog, keyed the same way.
//
// Loop-guard: a cron that itself writes into the vault can re-trigger itself (documented on
// FileChangeCronJob in cron.ts). The one loop-hazard this module DOES close unconditionally is
// the daemon's own bookkeeping — `.daemon/**` (last-fired/running/trigger files, process logs,
// memory, session state) is never watchable, so the daemon's own writes can never self-trigger a
// file-change cron. Debouncing (default 2s) also means an editing session firing many rapid
// autosaves collapses to ONE fire, not one per keystroke.
import { watch as fsWatch, type FSWatcher } from "node:fs"
import { loadCronJobs, fireFileChangeCron } from "./cron.ts"
import type { VaultContext } from "../lib/config.ts"

/** Coalesce a burst of raw fs events into one batch after this many ms of quiet. */
export const FILE_WATCH_DEBOUNCE_MS = 2000

/** Normalize to forward slashes regardless of the CURRENT platform's separator — a daemon built
 *  on macOS/Linux can still see a `watch` pattern authored (or a path reported) with backslashes,
 *  so this can't key off `path.sep` (which is always "/" on those platforms). */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/")
}

/**
 * Loop-guard: true for any path under the vault's `.daemon/` dir — the daemon's own runtime
 * bookkeeping (cron state, logs, memory, session files). This churn must NEVER be treated as a
 * watchable vault change, or a running cron could retrigger itself via its own `.last-fired.json`/
 * `.running.json` writes (or a memory-writing cron via `.daemon/memory/**`). Accepts either
 * forward- or backslash-separated input so callers don't have to normalize first.
 */
export function isDaemonInternalPath(relPath: string): boolean {
  const norm = toPosix(relPath)
  return norm === ".daemon" || norm.startsWith(".daemon/")
}

/**
 * Match a vault-relative changed path against a cron's `watch` field. `watch` is a Bun.Glob
 * pattern — `notes/inbox.md` matches only itself (no special chars), `journal/**` matches
 * anything under journal/, `*.md` matches root-level notes, etc. Both sides are normalized to
 * forward slashes first so platform path separators never cause a spurious mismatch. A malformed
 * pattern fails closed (never matches) rather than throwing.
 */
export function matchesWatch(pattern: string, relPath: string): boolean {
  const norm = toPosix(relPath)
  try {
    return new Bun.Glob(toPosix(pattern)).match(norm)
  } catch {
    return false
  }
}

export interface FileWatcher {
  close(): void
}

/**
 * Pure watch mechanism: debounce raw fs events for one directory tree into batches and hand each
 * batch to `onBatch`. Deliberately has NO cron knowledge — that separation is what makes it
 * independently testable (a fake `onBatch` stands in for the real cron fan-out in tests) and keeps
 * this the single place a heavy recursive watcher gets created, regardless of how many file-change
 * crons a vault ends up with.
 */
export function createFileWatcher(
  root: string,
  opts: { debounceMs?: number; onBatch: (paths: string[]) => void },
): FileWatcher | null {
  const debounceMs = opts.debounceMs ?? FILE_WATCH_DEBOUNCE_MS
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  let watcher: FSWatcher
  try {
    watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return // extent-unknown event (rare) — nothing specific to batch
      const rel = toPosix(filename)
      if (isDaemonInternalPath(rel)) return // never react to the daemon's own churn (loop guard)
      pending.add(rel)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const paths = [...pending]
        pending.clear()
        if (paths.length > 0) opts.onBatch(paths)
      }, debounceMs)
    })
  } catch {
    return null // vault dir missing (e.g. not yet created) — nothing to watch
  }

  return {
    close(): void {
      if (timer !== null) clearTimeout(timer)
      watcher.close()
    },
  }
}

// ── Per-vault wiring: fan a debounced batch out across that vault's file-change crons ──────────

const watchers = new Map<string, FileWatcher>() // keyed by ctx.root, mirrors process.ts's procKey scoping

async function flush(ctx: VaultContext, paths: string[]): Promise<void> {
  const jobs = await loadCronJobs(ctx)
  for (const job of jobs) {
    if (job.on !== "file-change" || !job.enabled) continue
    const matches = paths.filter((p) => matchesWatch(job.watch, p))
    if (matches.length === 0) continue
    await fireFileChangeCron(ctx, job, matches)
  }
}

/** Start (or no-op if already running) the ONE file watcher for this vault's brain. */
export function startFileWatch(ctx: VaultContext, debounceMs: number = FILE_WATCH_DEBOUNCE_MS): void {
  if (watchers.has(ctx.root)) return
  const fw = createFileWatcher(ctx.root, { debounceMs, onBatch: (paths) => { void flush(ctx, paths) } })
  if (fw) watchers.set(ctx.root, fw)
}

/** Stop one vault's watcher (e.g. that vault's daemon was disabled at runtime). */
export function stopFileWatch(ctx: VaultContext): void {
  const fw = watchers.get(ctx.root)
  if (!fw) return
  fw.close()
  watchers.delete(ctx.root)
}

/** Stop every vault's watcher — full daemon shutdown. Mirror of process.ts's stopProcessTriggers. */
export function stopAllFileWatches(): void {
  for (const fw of watchers.values()) fw.close()
  watchers.clear()
}
