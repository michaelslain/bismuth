import { watch, writeFileSync, statSync, unlinkSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A recursive fs.watch that does not lose the changes made while it is starting up.
 *
 * On macOS, Bun's recursive fs.watch returns before its FSEvents stream is live, and the stream
 * only reports what happens after it exists — a write that lands in between is never reported at
 * all. Under load that gap is long enough for a server's own boot writes, or an agent editing the
 * vault as the app launches, to be missed for good: every cache built from the pre-write state
 * then stays stale until the same file happens to change again.
 *
 * So the watch proves itself live with a probe file, then catches up. The probe is created BEFORE
 * the watch starts and its mtime is the boundary: anything on disk modified after it that the
 * watcher never reported is reported once, as if the watcher had seen it, and so is a folder
 * created after it, with everything in it. A directory whose mtime moved with no changed file or
 * new folder in it to account for it lost a child to a delete or rename, which a stat walk cannot
 * name — that is reported as a null filename, the watcher's own "extent unknown".
 * Rewriting (never re-creating) the probe keeps the probe itself from moving the root's mtime.
 *
 * Opening or closing ANY recursive watch in the process also drops events on the watches that are
 * already live (Bun 1.4 on macOS: about 20-25 writes lost around one open/close, from just before
 * the open call to the close). So every live watcher keeps a process-wide registry entry, and a
 * sibling opening or closing makes each of them run the same catch-up again, from just before the
 * sibling's call, once the sibling has settled.
 */

export type LiveWatcher = { close(): void }

export type LiveWatchOptions = {
    /** Directories (root-relative) not to walk during catch-up, e.g. `.git`. */
    skipDir?: (rel: string) => boolean
    /** How often to rewrite the probe until the watcher reports it. */
    probeIntervalMs?: number
    /** Test seam — defaults to node:fs watch. */
    watchFn?: typeof watch
}

const PROBE_PREFIX = '.bismuth-watch-probe-'

const isProbe = (rel: string) =>
    rel.slice(rel.lastIndexOf('/') + 1).startsWith(PROBE_PREFIX)

// Creating or deleting a probe moves its directory's mtime. Watchers nest (the daemon's memory dir
// lives inside the vault) and share roots (two servers on one vault), so each one still catching
// up hears about every OTHER watcher's probe dirs and does not read those moves as lost children.
const probeDirListeners = new Set<(owner: object, dir: string) => void>()
// Live watchers, so one opening or closing can tell the rest to re-check what they may have dropped.
type Sibling = { rescanFrom(ms: number): void }
const liveWatchers = new Set<Sibling>()
// Events go missing from slightly before the sibling's open call (the call blocks the loop while the
// stream is set up) until its close returns; the walk starts that far back and waits for it to settle.
const SIBLING_LOOKBACK_MS = 250
const SIBLING_SETTLE_MS = 300
// Creating a folder stamps its parent's mtime within about a microsecond of the folder's birthtime
// (APFS, measured); a parent changed later than this after the folder was born changed for another reason.
const NEW_DIR_PARENT_SLACK_MS = 5
const announceSibling = (owner: Sibling | null, from: number) => {
    for (const w of liveWatchers) if (w !== owner) w.rescanFrom(from)
}

const announceProbeDir = (owner: object, dir: string) => {
    for (const l of probeDirListeners) l(owner, dir)
}

export function watchLive(
    root: string,
    onChange: (filename: string | null) => void,
    opts: LiveWatchOptions = {},
): LiveWatcher {
    const self = {}
    const watchFn = opts.watchFn ?? watch
    const interval = opts.probeIntervalMs ?? 100
    const probeName = `${PROBE_PREFIX}${process.pid}-${Math.random().toString(36).slice(2)}`
    const probePath = join(root, probeName)
    // path -> when the watcher reported it; a catch-up only trusts a report newer than the file.
    const seen = new Map<string, number>()
    const reportedAt = () => Date.now() + 1
    // dir -> when another watcher last created or removed a probe there. Kept for the watcher's whole
    // life: a sibling opened later inside the root moves a dir's mtime with a probe this one never made.
    const foreignProbeDirs = new Map<string, number>()
    const onProbeDir = (owner: object, dir: string) => {
        if (owner !== self) foreignProbeDirs.set(join(dir), Date.now())
    }
    probeDirListeners.add(onProbeDir)
    let closed = false
    let live = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let rescanTimer: ReturnType<typeof setTimeout> | undefined
    let rescanFromMs = Infinity
    // A rescan never looks back past this watcher's own going live (the root's mtime once its own
    // probe is gone), or it re-reports what the initial catch-up already excluded.
    let liveFloor = Infinity
    const sibling: Sibling = {
        rescanFrom(ms) {
            if (closed) return
            rescanFromMs = Math.min(rescanFromMs, ms - SIBLING_LOOKBACK_MS)
            if (live) scheduleRescan()
        },
    }
    function scheduleRescan() {
        clearTimeout(rescanTimer)
        rescanTimer = setTimeout(() => {
            if (closed) return
            const from = rescanFromMs
            rescanFromMs = Infinity
            void catchUp(Math.max(from, liveFloor), true).catch(() => {})
        }, SIBLING_SETTLE_MS)
        rescanTimer.unref?.()
    }
    // This watcher's own open blocks the loop and drops the live siblings' events.
    announceSibling(sibling, Date.now())

    let boundary: number
    let probing = true
    try {
        writeFileSync(probePath, '')
        announceProbeDir(self, root)
        // The root's own mtime can land a hair after the new entry's; take the later of the two, or
        // every boot would read the probe's creation as an unexplained change to the root.
        boundary = Math.max(statSync(probePath).mtimeMs, statSync(root).mtimeMs)
    } catch {
        // Read-only or missing root: no probe. Fall back to a timed catch-up from roughly now.
        probing = false
        boundary = Date.now()
    }

    function removeProbe() {
        if (!probing) return
        probing = false
        try {
            unlinkSync(probePath)
            announceProbeDir(self, root)
        } catch {}
    }

    let watcher: ReturnType<typeof watch>
    try {
        watcher = watchFn(root, { recursive: true }, (_event, filename) => {
            const name = filename == null ? null : String(filename)
            if (name === probeName) {
                goLive()
                return
            }
            if (name !== null && isProbe(name)) return
            if (name !== null) seen.set(name, reportedAt())
            onChange(name)
        })
    } catch (err) {
        probeDirListeners.delete(onProbeDir)
        removeProbe()
        throw err
    }
    announceSibling(sibling, Date.now())

    function goLive() {
        if (live || closed) return
        live = true
        clearTimeout(timer)
        let rootMtime = boundary
        try {
            rootMtime = statSync(root).mtimeMs
        } catch {}
        removeProbe()
        try {
            liveFloor = statSync(root).mtimeMs
        } catch {
            liveFloor = boundary
        }
        liveWatchers.add(sibling)
        void catchUp(boundary, false, rootMtime)
            .catch(() => {})
            .finally(() => {
                // A sibling opened or closed while this one was still catching up.
                if (rescanFromMs < Infinity) scheduleRescan()
            })
    }

    /** Reports what changed on disk after `from` that the watcher did not report. A sibling rescan
     *  also looks at the root, and trusts only reports made after `from`. */
    async function catchUp(from: number, rescan: boolean, rootMtime?: number) {
        const changed = new Map<string, number>()
        // Folders created after `from`, reported like a changed file. Nobody knew what was in one, so
        // it lost nothing; it explains its parent only when its creation is the parent's latest
        // change, so a delete beside it still reads as lost.
        const newDirs = new Map<string, number>()
        const explainedByNewDir = new Set<string>()
        if (rescan) {
            try {
                rootMtime = statSync(root).mtimeMs
            } catch {}
        }
        const movedDirs: string[] = (rootMtime ?? 0) > from ? [''] : []
        // `fresh`: rel is a new folder, so everything in it is new, even a file renamed in with an
        // old mtime.
        const walk = async (
            rel: string,
            relMtime: number,
            fresh: boolean,
        ): Promise<void> => {
            let entries
            try {
                entries = await readdir(join(root, rel), {
                    withFileTypes: true,
                })
            } catch {
                return // removed mid-walk
            }
            for (const e of entries) {
                const childRel = rel ? `${rel}/${e.name}` : e.name
                if (isProbe(childRel)) continue
                if (e.isDirectory() && opts.skipDir?.(childRel)) continue
                let mtime: number
                let born: number
                try {
                    const st = await stat(join(root, childRel))
                    mtime = st.mtimeMs
                    born = st.birthtimeMs
                } catch {
                    continue // removed mid-walk
                }
                if (e.isDirectory()) {
                    if (mtime > from) movedDirs.push(childRel)
                    // Without this a fresh folder chain (`mkdir -p a/b && write a/b/x.md`) reads as
                    // a lost child in a/ and in the root, and the extent-unknown report that follows
                    // drops every path in the batch it lands in.
                    const isNew = fresh || born > from
                    if (isNew) {
                        newDirs.set(childRel, born)
                        explainedByNewDir.add(childRel)
                        if (relMtime - born < NEW_DIR_PARENT_SLACK_MS)
                            explainedByNewDir.add(rel)
                    }
                    await walk(childRel, mtime, isNew)
                } else if (
                    (fresh || mtime > from) &&
                    (seen.get(childRel) ?? 0) < mtime
                ) {
                    changed.set(childRel, mtime)
                }
            }
        }
        await walk('', rootMtime ?? 0, false)
        if (closed) return
        const explained = new Set(explainedByNewDir)
        for (const [p, at] of seen) if (at > from) explained.add(parentOf(p))
        for (const p of changed.keys()) explained.add(parentOf(p))
        // Anything the watcher reported while the walk ran has already gone through onChange.
        for (const [p, at] of [...changed, ...newDirs]) {
            if ((seen.get(p) ?? 0) >= at) continue
            seen.set(p, reportedAt())
            onChange(p)
        }
        const lostChild = movedDirs.some(
            d =>
                !explained.has(d) &&
                !(rescan
                    ? (foreignProbeDirs.get(join(root, d)) ?? 0) > from
                    : foreignProbeDirs.has(join(root, d))),
        )
        if (lostChild) onChange(null)
    }

    if (probing) {
        const tick = () => {
            if (live || closed) return
            try {
                writeFileSync(probePath, String(Date.now()))
            } catch {}
            timer = setTimeout(tick, interval)
            timer.unref?.()
        }
        tick()
    } else {
        timer = setTimeout(() => {
            if (closed) return
            live = true
            liveFloor = boundary
            liveWatchers.add(sibling)
            void catchUp(boundary, false, boundary)
                .catch(() => {})
                .finally(() => {
                    if (rescanFromMs < Infinity) scheduleRescan()
                })
        }, 1000)
        timer.unref?.()
    }

    return {
        close() {
            if (closed) return
            closed = true
            clearTimeout(timer)
            clearTimeout(rescanTimer)
            liveWatchers.delete(sibling)
            watcher.close()
            removeProbe()
            probeDirListeners.delete(onProbeDir)
            announceSibling(null, Date.now())
        },
    }
}

function parentOf(rel: string): string {
    const i = rel.lastIndexOf('/')
    return i === -1 ? '' : rel.slice(0, i)
}
