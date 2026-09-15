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
 * watcher never reported is reported once, as if the watcher had seen it. A directory whose mtime
 * moved with no reported child to account for it lost a child to a delete or rename, which a stat
 * walk cannot name — that is reported as a null filename, the watcher's own "extent unknown".
 * Rewriting (never re-creating) the probe keeps the probe itself from moving the root's mtime.
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
    const seen = new Set<string>()
    const foreignProbeDirs = new Set<string>()
    const onProbeDir = (owner: object, dir: string) => {
        if (owner !== self) foreignProbeDirs.add(join(dir))
    }
    probeDirListeners.add(onProbeDir)
    let closed = false
    let live = false
    let timer: ReturnType<typeof setTimeout> | undefined

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

    const finish = () => probeDirListeners.delete(onProbeDir)

    let watcher: ReturnType<typeof watch>
    try {
        watcher = watchFn(root, { recursive: true }, (_event, filename) => {
            const name = filename == null ? null : String(filename)
            if (name === probeName) {
                goLive()
                return
            }
            if (name !== null && isProbe(name)) return
            if (name !== null) seen.add(name)
            onChange(name)
        })
    } catch (err) {
        finish()
        removeProbe()
        throw err
    }

    function goLive() {
        if (live || closed) return
        live = true
        clearTimeout(timer)
        let rootMtime = boundary
        try {
            rootMtime = statSync(root).mtimeMs
        } catch {}
        removeProbe()
        void catchUp(rootMtime)
            .catch(() => {})
            .finally(finish)
    }

    async function catchUp(rootMtime: number) {
        const changed: string[] = []
        const movedDirs: string[] = rootMtime > boundary ? [''] : []
        const walk = async (rel: string): Promise<void> => {
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
                try {
                    mtime = (await stat(join(root, childRel))).mtimeMs
                } catch {
                    continue // removed mid-walk
                }
                if (e.isDirectory()) {
                    if (mtime > boundary) movedDirs.push(childRel)
                    await walk(childRel)
                } else if (mtime > boundary && !seen.has(childRel)) {
                    changed.push(childRel)
                }
            }
        }
        await walk('')
        if (closed) return
        const explained = new Set<string>()
        for (const p of [...seen, ...changed]) explained.add(parentOf(p))
        // Anything the watcher reported while the walk ran has already gone through onChange.
        for (const p of changed) if (!seen.has(p)) onChange(p)
        const lostChild = movedDirs.some(
            d => !explained.has(d) && !foreignProbeDirs.has(join(root, d)),
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
            void catchUp(boundary)
                .catch(() => {})
                .finally(finish)
        }, 1000)
        timer.unref?.()
    }

    return {
        close() {
            if (closed) return
            closed = true
            clearTimeout(timer)
            watcher.close()
            removeProbe()
            finish()
        },
    }
}

function parentOf(rel: string): string {
    const i = rel.lastIndexOf('/')
    return i === -1 ? '' : rel.slice(0, i)
}
