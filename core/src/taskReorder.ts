// Pure task-block reordering/archiving primitives, split out of tasks.ts so the FRONTEND
// (app/src/editor/taskFold.ts) can value-import them without dragging tasks.ts's fileAccess
// → files.ts (node:path / node:fs) into the WebView bundle. This module imports nothing with
// runtime IO — only a type from tasks.ts (erased at build).
import type { TaskStatus } from "./tasks";

// `- `, `* `, or `+ ` bullet, then `[<one char>]`, then a space and the body. Mirrors
// tasks.ts's TASK_LINE — kept local here so this module stays IO-free (no tasks.ts runtime).
const TASK_LINE = /^(\s*)[-*+] \[(.)\] (.*)\r?$/;

/** The TaskStatus of a checkbox line, or null when the line isn't a checkbox task. */
function taskStatusOf(line: string): TaskStatus | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  switch (m[2]) {
    case " ":
      return "todo";
    case "x":
    case "X":
      return "done";
    case "/":
      return "in-progress";
    case "-":
      return "cancelled";
    default:
      return "other";
  }
}

/** A done ([x]/[X]) or cancelled ([-]) task is "resolved" — eligible to sink/archive. */
export function isResolvedStatus(status: TaskStatus): boolean {
  return status === "done" || status === "cancelled";
}

// A task "item" is a head task line plus any following lines indented deeper than it
// (sub-tasks / wrapped continuation). Grouping by item keeps a parent and its children
// together when we reorder or archive a block.
export interface TaskBlockItem {
  status: TaskStatus;
  lines: string[];
}

function leadingWidth(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].length : 0;
}

// Split a contiguous run of task lines (starting at `lines[start]`, whose heads share the
// same base indent) into items. Returns the items and the index just past the block. A
// line joins the current item if it's deeper-indented than the head; a task line at the
// base indent starts a new item; anything else ends the block.
export function collectBlock(lines: string[], start: number): { items: TaskBlockItem[]; end: number } {
  const baseIndent = leadingWidth(lines[start]);
  const items: TaskBlockItem[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const status = taskStatusOf(line);
    const indent = leadingWidth(line);
    if (status !== null && indent === baseIndent) {
      items.push({ status, lines: [line] });
      i++;
    } else if (items.length > 0 && indent > baseIndent && line.trim() !== "") {
      items[items.length - 1].lines.push(line);
      i++;
    } else {
      break;
    }
  }
  return { items, end: i };
}

/**
 * Sink resolved (done/cancelled) task items to the bottom of each contiguous task block,
 * preserving the relative order within the open and resolved groups (stable). Non-task
 * regions pass through untouched. Pure and idempotent once sorted — keeps completed and
 * cancelled todos pinned to the bottom of their list automatically.
 */
export function reorderTaskBlocks(content: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (taskStatusOf(lines[i]) === null) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const { items, end } = collectBlock(lines, i);
    const open = items.filter((it) => !isResolvedStatus(it.status));
    const done = items.filter((it) => isResolvedStatus(it.status));
    for (const it of [...open, ...done]) out.push(...it.lines);
    i = end;
  }
  return out.join(eol);
}
