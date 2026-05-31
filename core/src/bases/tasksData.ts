import type { Row } from "./types";
import { collectVaultTasks } from "../tasks";
import { taskToRow } from "./taskRow";

// Re-export the browser-safe helpers so existing importers keep working.
export { taskToRow, filterTaskRows } from "./taskRow";

/** Scan the vault for checkbox tasks and return one Row per task (server-only). */
export async function buildTaskRows(root: string): Promise<Row[]> {
  const tasks = await collectVaultTasks(root);
  return tasks.map(taskToRow);
}
