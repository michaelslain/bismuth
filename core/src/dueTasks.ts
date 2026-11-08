// Open tasks due before a date, through the query engine `bismuth task list --query` uses. The
// daemon reaches it through daemon/src/lib/coreTasks.js (its stricter tsc must not type-check core).
import { collectVaultTasks } from './tasks'
import { translateTaskDsl } from './bases/taskDsl'
import { passesFilter } from './bases/filters'
import { toContext } from './bases/query'
import { taskToRow } from './bases/taskRow'
import { filterByPath, type DenyEntry } from './visibilityFilter'

export { isDeniedPath } from './visibilityFilter'

export type DueTask = { text: string; due: string; path: string }

/** Tasks matching `not done and due before <before>`, denied paths removed, earliest due first
 *  (ties by path, then line). `before` is YYYY-MM-DD. */
export async function dueTasks(
    vault: string,
    opts: { before: string; deny: DenyEntry[] },
): Promise<DueTask[]> {
    const tasks = filterByPath(await collectVaultTasks(vault), opts.deny, t => t.path)
    const expr = translateTaskDsl(`not done and due before ${opts.before}`, opts.before).where
    return tasks
        .filter(t => t.due !== undefined && (!expr || passesFilter(expr, toContext(taskToRow(t)))))
        .sort((a, b) => {
            const d = a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0
            return d || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line)
        })
        .map(t => ({ text: t.description, due: t.due!, path: t.path }))
}
