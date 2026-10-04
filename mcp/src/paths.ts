// Path-traversal guard for docs.ts (readDoc). No external
// deps — node:path only.

import { resolve, sep } from 'node:path'

/** Resolve `target` under `root`, throwing if it would escape (path traversal). */
export function resolveWithin(root: string, relPath: string): string {
    const target = resolve(root, relPath)
    const rootWithSep = root.endsWith(sep) ? root : root + sep
    if (target !== root && !target.startsWith(rootWithSep)) {
        throw new Error(`Path traversal rejected: ${relPath}`)
    }
    return target
}
