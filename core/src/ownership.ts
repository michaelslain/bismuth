// Ownership by SHAPE, never by the current home. A path is ours when it ends with
// `/.bismuth/<rest>` exactly, segment-aligned, under ANY home — so a link written by a build that ran
// under an older home directory (a renamed account) is still recognised as ours, while a lookalike
// (`.bismuth-notes`, `my.bismuth`, `skills/a-extra`) is foreign. Pure: no fs, no process state.
import { posix } from 'node:path'

const MARKER = '/.bismuth/'

function clean(p: string): string {
    const n = posix.normalize(p)
    return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n
}

/** True when `target` (a path or symlink target, resolved or not) ends with `/.bismuth/<rest>`,
 *  segment-aligned, under ANY home — the current one or an older one. `rest` uses '/' separators,
 *  e.g. 'skills/authoring-bismuth-bases', 'bin/bismuth', 'bin/bismuth-mcp'. */
export function isBismuthOwnedPath(target: string, rest: string): boolean {
    const t = clean(target)
    if (!t.startsWith('/')) return false
    const suffix = `${MARKER}${clean(rest)}`
    if (!t.endsWith(suffix)) return false
    return t.length > suffix.length
}

/** The home directory a bismuth-owned path lives under (the part before `/.bismuth/`), or null. */
export function bismuthHomeOf(target: string): string | null {
    const t = clean(target)
    if (!t.startsWith('/')) return null
    const i = t.lastIndexOf(MARKER)
    if (i <= 0) return null
    return t.slice(0, i)
}

/** isBismuthOwnedPath(target, rest) AND bismuthHomeOf(target) !== currentHome. */
export function isOldHomeBismuthPath(
    target: string,
    rest: string,
    currentHome: string,
): boolean {
    if (!isBismuthOwnedPath(target, rest)) return false
    return bismuthHomeOf(target) !== clean(currentHome)
}
