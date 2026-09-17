import type { Row } from './types'
import { collectVaultTasks, collectTasksFromPaths } from '../tasks'
import { taskToRow } from './taskRow'
import type { AsyncCache } from '../asyncCache'

// Re-export the browser-safe helper so existing importers keep working.
export { taskToRow } from './taskRow'

/**
 * Scan for checkbox tasks and return one Row per task (server-only).
 * With `paths`, only those vault-relative notes are scanned (scoped tasks);
 * without, the whole vault (the degenerate global case).
 */
export async function buildTaskRows(
    root: string,
    paths?: string[],
): Promise<Row[]> {
    const tasks = paths
        ? await collectTasksFromPaths(root, paths)
        : await collectVaultTasks(root)
    return tasks.map(taskToRow)
}

/**
 * Incrementally patch the cached task-rows feed for the changed `paths`, mirroring
 * `patchVaultRows` (`core/src/basesData.ts`) in shape and fallback rules. Unlike vault
 * rows, task-row ORDER need not match a full rebuild: `reconcileRows`
 * (`app/src/bases/reconcileRows.ts`) keys a task row by `path + description`, not array
 * position, so freshly extracted rows can simply be appended rather than re-walked into
 * their original position.
 *
 * A no-op when nothing is cached and no `.md` path changed; `cache.invalidate()` when
 * nothing is cached but a `.md` path DID change (nothing to patch, next read builds
 * fresh). Otherwise every existing row for a changed path is spliced out and the
 * freshly re-extracted tasks for those paths (via `collectTasksFromPaths`, which
 * already reads unreadable/deleted paths as empty — yielding zero tasks, so a deleted
 * note's rows are simply not replaced) are pushed onto the end.
 */
export async function patchTaskRows(
    root: string,
    paths: string[],
    cache: AsyncCache<Row[]>,
): Promise<void> {
    const current = cache.peek()
    const mdPaths = paths.filter(p => p.endsWith('.md'))
    if (!current || mdPaths.length === 0) {
        if (!current && mdPaths.length) cache.invalidate()
        return
    }
    const changed = new Set(mdPaths)
    const tasks = await collectTasksFromPaths(root, mdPaths)
    const fresh = tasks.map(taskToRow)
    const applied = cache.patch(rows => {
        for (let i = rows.length - 1; i >= 0; i--) {
            if (changed.has(rows[i].file.path)) rows.splice(i, 1)
        }
        rows.push(...fresh)
    })
    if (!applied) cache.invalidate() // raced with an invalidation → rebuild next read
}
