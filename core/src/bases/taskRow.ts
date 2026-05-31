// Browser-safe task<->row helpers. Pure: no filesystem imports, so the frontend
// can import these without pulling node:fs into the bundle. The vault-scanning
// buildTaskRows lives in tasksData.ts (server-only).
import type { Row } from "./types";
import type { Task } from "../tasks";
import { runTaskQuery } from "../tasks-query";

/** One Row per checkbox line. Task fields live in note.*; line/path kept for write-back. */
export function taskToRow(task: Task): Row {
  const slash = task.path.lastIndexOf("/");
  const folder = slash >= 0 ? task.path.slice(0, slash) : "";
  const file = slash >= 0 ? task.path.slice(slash + 1) : task.path;
  const name = file.replace(/\.md$/, "");
  return {
    file: {
      name,
      basename: name,
      path: task.path,
      folder,
      ext: "md",
      size: 0,
      ctime: 0,
      mtime: 0,
      tags: task.tags ?? [],
      links: [],
    },
    note: {
      description: task.description,
      status: task.status,
      statusChar: task.statusChar,
      priority: task.priority,
      line: task.line,
      raw: task.raw,
      due: task.due,
      scheduled: task.scheduled,
      start: task.start,
      done: task.done,
      recurrence: task.recurrence,
      tags: task.tags,
    },
    formula: {},
  };
}

function rowToTask(r: Row): Task {
  const n = r.note;
  return {
    path: r.file.path,
    line: n.line as number,
    raw: n.raw as string,
    indent: "",
    status: n.status as Task["status"],
    statusChar: n.statusChar as string,
    description: n.description as string,
    priority: n.priority as Task["priority"],
    tags: (n.tags as string[]) ?? [],
    due: n.due as string | undefined,
    scheduled: n.scheduled as string | undefined,
    start: n.start as string | undefined,
    done: n.done as string | undefined,
    recurrence: n.recurrence as string | undefined,
  };
}

/** Run the Tasks query DSL over task rows, returning the matching rows in DSL order. */
export function filterTaskRows(rows: Row[], query: string, today: string): Row[] {
  if (!query?.trim()) return rows;
  const byKey = new Map(rows.map((r) => [`${r.file.path}:${r.note.line}`, r]));
  const { tasks } = runTaskQuery(rows.map(rowToTask), query, today);
  return tasks.map((t) => byKey.get(`${t.path}:${t.line}`)).filter((r): r is Row => !!r);
}
