// core/src/watchSkip.ts
//
// The pure path predicates behind server.ts's vault file watcher: which changed paths are noise
// (dot-hidden, the daemon's status heartbeat, dot-segments under the memory brain) and which
// directories the watcher's catch-up walk must not descend into. No I/O, no server state.

export const isHidden = (p: string): boolean =>
    p.startsWith('.') || p.includes('/.')

// The daemon rewrites its status file (DAEMON.md) into the vault root every ~2s. It is a status
// artifact, not knowledge, so its churn never bumps the version.
const DAEMON_STATUS_FILE = 'DAEMON.md'
const DAEMON_STATUS_PATH = '/' + DAEMON_STATUS_FILE

export const isWatchIgnored = (p: string): boolean =>
    isHidden(p) || p === DAEMON_STATUS_FILE || p.endsWith(DAEMON_STATUS_PATH)

/** `.daemon` is dot-prefixed but its contents ARE meaningful (sidebar + the 3rd brain). */
export const isSystemFolderPath = (p: string): boolean =>
    p.startsWith('.daemon/')

export const isDaemonMemoryPath = (p: string): boolean =>
    p === '.daemon/memory' || p.startsWith('.daemon/memory/')

/** A dot-prefixed segment BELOW `.daemon/memory/` (its own `.git`, a stray `.DS_Store`) is noise;
 *  the folder itself and its ordinary subfolders/notes are not. */
export const isDaemonMemoryNoise = (p: string): boolean => {
    if (!isDaemonMemoryPath(p)) return false
    const rest = p.slice('.daemon/memory'.length).replace(/^\//, '')
    return rest !== '' && isHidden(rest)
}

/**
 * Should the watcher's catch-up walk skip the directory `rel`? Hidden directories are skipped
 * (`.git`, `.trash`) EXCEPT the system folders the tree shows (`.daemon/**`) and `.themes`
 * itself, whose yaml files are meaningful: a theme written while the watch was still starting
 * must be caught up like any note.
 */
export const skipWatchWalk = (rel: string): boolean =>
    isDaemonMemoryNoise(rel) ||
    (isWatchIgnored(rel) &&
        !isSystemFolderPath(`${rel}/`) &&
        rel !== '.themes')
