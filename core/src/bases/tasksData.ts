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
 * `patchVaultRows` (`core/src/basesData.ts`) in shape and fallback rules. A changed note's
 * fresh rows take the place of its old ones, so a note keeps its position in the feed; only a
 * note with no rows before is appended. Re-appending every changed note instead moved it to
 * the end on each write, and the next patch (the watcher's echo, another note's write) moved
 * it again: every view that keeps feed order (a calendar day, a list) reshuffled twice per
 * added task.
 *
 * A no-op when nothing is cached and no `.md` path changed; `cache.invalidate()` when
 * nothing is cached but a `.md` path DID change (nothing to patch, next read builds
 * fresh). Otherwise every existing row for a changed path is spliced out and the
 * freshly re-extracted tasks for those paths (via `collectTasksFromPaths`, which
 * already reads unreadable/deleted paths as empty — yielding zero tasks, so a deleted
 * note's rows are simply not replaced) go where that note's first row was.
 */
export async function patchTaskRows(
    root: string,
    paths: string[],
    cache: AsyncCache<Row[]>,
): Promise<void> {
    const current = cache.peek()
    // listMarkdown scans with `dot: false`, so a full rebuild never yields rows for a
    // dot-path note (.daemon/memory/*.md, .daemon/pages/*.md, …). Adding them here would
    // make the patched feed permanently diverge from a rebuild.
    const mdPaths = paths.filter(
        p => p.endsWith('.md') && !p.split('/').some(seg => seg.startsWith('.')),
    )
    if (!current || mdPaths.length === 0) {
        if (!current && mdPaths.length) cache.invalidate()
        return
    }
    const changed = new Set(mdPaths)
    const tasks = await collectTasksFromPaths(root, mdPaths)
    const fresh = tasks.map(taskToRow)
    const freshByPath = new Map<string, Row[]>()
    for (const row of fresh) {
        const list = freshByPath.get(row.file.path)
        if (list) list.push(row)
        else freshByPath.set(row.file.path, [row])
    }
    const applied = cache.patch(rows => {
        const out: Row[] = []
        const placed = new Set<string>()
        for (const row of rows) {
            const path = row.file.path
            if (!changed.has(path)) {
                out.push(row)
                continue
            }
            if (placed.has(path)) continue
            placed.add(path)
            out.push(...(freshByPath.get(path) ?? []))
        }
        for (const [path, list] of freshByPath) if (!placed.has(path)) out.push(...list)
        rows.splice(0, rows.length, ...out)
    })
    if (!applied) cache.invalidate() // raced with an invalidation → rebuild next read
}
