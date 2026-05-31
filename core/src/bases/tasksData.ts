import type { Row } from "./types";
import { collectVaultTasks, collectTasksFromPaths } from "../tasks";
import { taskToRow } from "./taskRow";

// Re-export the browser-safe helpers so existing importers keep working.
export { taskToRow, filterTaskRows } from "./taskRow";

/**
 * Scan for checkbox tasks and return one Row per task (server-only).
 * With `paths`, only those vault-relative notes are scanned (scoped tasks);
 * without, the whole vault (the degenerate global case).
 */
export async function buildTaskRows(root: string, paths?: string[]): Promise<Row[]> {
  const tasks = paths ? await collectTasksFromPaths(root, paths) : await collectVaultTasks(root);
  return tasks.map(taskToRow);
}
