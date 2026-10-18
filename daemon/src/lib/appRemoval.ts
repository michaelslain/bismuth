// A daemon linked into Bismuth.app (core/src/daemonInstall.ts linksDaemon) goes away with the app:
// when the app is deleted, the daemon removes its own service and the ~/.bismuth/bin link, then
// exits. Nothing else under ~/.bismuth is touched. macOS sends no event for an app moved to the
// Trash, but a running process keeps its executable's inode, so the daemon can watch its own
// path disappear. Self-update swaps the bundle in place and leaves the path missing for seconds,
// so removal needs the path missing on REMOVAL_MISSES consecutive checks a tick apart.
import { existsSync, lstatSync, readlinkSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { bismuthHome } from './bismuthPaths'
import { daemonConfigPath } from './platform'
import { LAUNCHD_LABEL } from './config'

export const REMOVAL_MISSES = 2

/** The bundle-internal executable this daemon runs from, or null when it does not live in an
 *  app bundle (a copied daemon, Linux, a source run) and so cannot outlive one. */
export function bundledExecPath(
    execPath: string,
    platform: NodeJS.Platform,
): string | null {
    return platform === 'darwin' && execPath.includes('.app/Contents/')
        ? execPath
        : null
}

/** One check: the running count of consecutive misses, and whether removal is due. */
export function nextRemovalCheck(
    misses: number,
    present: boolean,
): { misses: number; remove: boolean } {
    const next = present ? 0 : misses + 1
    return { misses: next, remove: next >= REMOVAL_MISSES }
}

/** Remove the link at `bin` only if it still points at `execPath` (a newer install may have
 *  replaced it), then the launchd plist, then the loaded job. `launchctl remove` sends this
 *  process SIGTERM, so the normal shutdown handler finishes the exit. Never throws. */
export function removeOwnService(
    execPath: string,
    bin: string = bismuthHome('bin', 'bismuth-daemon'),
    plist: string = daemonConfigPath(),
    unloadJob: () => void = () => {
        spawnSync('launchctl', ['remove', LAUNCHD_LABEL])
    },
): void {
    try {
        if (
            lstatSync(bin).isSymbolicLink() &&
            readlinkSync(bin) === execPath
        )
            rmSync(bin, { force: true })
    } catch {
        /* no link */
    }
    try {
        if (existsSync(plist)) rmSync(plist, { force: true })
    } catch {
        /* best-effort */
    }
    unloadJob()
}

/** Build the per-tick watcher. Returns null when this daemon is not inside an app bundle. */
export function appRemovalWatcher(
    execPath: string = process.execPath,
    platform: NodeJS.Platform = process.platform,
    exists: (p: string) => boolean = existsSync,
    remove: (execPath: string) => void = removeOwnService,
): (() => boolean) | null {
    const path = bundledExecPath(execPath, platform)
    if (!path) return null
    let misses = 0
    let removed = false
    return () => {
        if (removed) return true // removal ran; SIGTERM from launchd is on its way
        const r = nextRemovalCheck(misses, exists(path))
        misses = r.misses
        if (r.remove) {
            removed = true
            remove(path)
        }
        return r.remove
    }
}
