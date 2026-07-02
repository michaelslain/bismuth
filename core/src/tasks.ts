// Parse Obsidian-style checkbox tasks out of markdown, mirroring the Tasks plugin's
// emoji-signifier format. One Task per checkbox list item, tracking the source file
// and 0-indexed line so the line can be toggled back in place.

import { getFileAccess } from "./fileAccess";
import { addDaysISO } from "./dates";
import { reorderTaskBlocks, isResolvedStatus, collectBlock } from "./taskReorder";
import { INLINE_TAG_REGEX } from "./tags";

export type TaskStatus = "todo" | "done" | "in-progress" | "cancelled" | "other";
export type Priority = "highest" | "high" | "medium" | "low" | "lowest" | "none";

export interface Task {
  path: string; // vault-relative file path
  line: number; // 0-indexed line number within the file
  raw: string; // the original full line (incl. indentation)
  indent: string; // leading whitespace
  status: TaskStatus;
  statusChar: string; // the raw character between the brackets
  description: string; // task text with signifiers stripped, trimmed (tags kept)
  priority: Priority;
  tags: string[]; // #tags found in the description (without leading #)
  due?: string; // 📅 YYYY-MM-DD
  scheduled?: string; // ⏳ YYYY-MM-DD
  start?: string; // 🛫 YYYY-MM-DD
  done?: string; // ✅ YYYY-MM-DD
  created?: string; // ➕ YYYY-MM-DD
  cancelled?: string; // ❌ YYYY-MM-DD
  recurrence?: string; // 🔁 text
}

// `- `, `* `, or `+ ` bullet, then `[<one char>]`, then a space and the body.
const TASK_LINE = /^(\s*)[-*+] \[(.)\] (.*)\r?$/;

const PRIORITY_EMOJI: Array<[string, Priority]> = [
  ["🔺", "highest"],
  ["⏫", "high"],
  ["🔼", "medium"],
  ["🔽", "low"],
  ["⏬", "lowest"],
];

// Canonical list of date-field names, single-sourced here so tasks-query.ts can import
// it instead of re-declaring the same strings. The emoji↔field mapping lives in DATE_FIELDS.
export const DATE_FIELD_NAMES = ["due", "scheduled", "start", "done", "created", "cancelled"] as const;
export type DateField = (typeof DATE_FIELD_NAMES)[number];

const DATE_FIELDS: Array<[string, DateField]> = [
  ["📅", "due"],
  ["⏳", "scheduled"],
  ["🛫", "start"],
  ["✅", "done"],
  ["➕", "created"],
  ["❌", "cancelled"],
];

// Precompiled `<emoji> YYYY-MM-DD` matchers, one per DATE_FIELDS signifier, built once
// at module load instead of `new RegExp(...)` per task line (parseTaskLine runs once per
// markdown line across the whole vault).
const DATE_FIELD_REGEX = new Map<string, RegExp>(
  DATE_FIELDS.map(([emoji]) => [emoji, new RegExp(emoji + "\\s*(\\d{4}-\\d{2}-\\d{2})")] as const),
);

function statusFromChar(c: string): TaskStatus {
  switch (c) {
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

export function parseTaskLine(line: string, path: string, lineNo: number): Task | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  const [, indent, statusChar, body] = m;
  let rest = body;

  let priority: Priority = "none";
  for (const [emoji, p] of PRIORITY_EMOJI) {
    if (rest.includes(emoji)) {
      priority = p;
      rest = rest.split(emoji).join(" ");
      break;
    }
  }

  const dates: Partial<Record<string, string>> = {};
  for (const [emoji, field] of DATE_FIELDS) {
    const re = DATE_FIELD_REGEX.get(emoji)!;
    const dm = re.exec(rest);
    if (dm) {
      dates[field] = dm[1];
      rest = rest.replace(dm[0], " ");
    }
  }

  const tags = [...new Set([...rest.matchAll(INLINE_TAG_REGEX)].map((t) => t[1]))];

  // Recurrence is the trailing 🔁 signifier; dates/priority are already stripped, so the
  // text after 🔁 is the rule (e.g. "every weekday"). Anything before stays as description.
  let recurrence: string | undefined;
  const recIdx = rest.indexOf("🔁");
  if (recIdx !== -1) {
    recurrence = rest.slice(recIdx + "🔁".length).trim() || undefined;
    rest = rest.slice(0, recIdx);
  }

  const description = rest.replace(/\s+/g, " ").trim();

  return {
    path,
    line: lineNo,
    raw: line,
    indent,
    status: statusFromChar(statusChar),
    statusChar,
    description,
    priority,
    tags,
    recurrence,
    ...dates,
  };
}

export function extractTasks(content: string, path: string): Task[] {
  const out: Task[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = parseTaskLine(lines[i], path, i);
    if (t) out.push(t);
  }
  return out;
}


// Advance a single ISO date by one period of the given Obsidian-Tasks recurrence rule.
// Supports the core natural-language forms: "every day", "every N days", "every week",
// "every N weeks", "every month(s)", "every year(s)", and "every weekday". Returns null
// when the rule isn't recognized (caller then leaves the date untouched).
function advanceDateByRecurrence(iso: string, rule: string): string | null {
  const r = rule.toLowerCase().trim();

  // "every weekday" — next Monday–Friday.
  if (/^every\s+weekday$/.test(r)) {
    let next = addDaysISO(iso, 1);
    // getUTCDay(): 0 = Sunday, 6 = Saturday.
    while ([0, 6].includes(new Date(next + "T00:00:00Z").getUTCDay())) {
      next = addDaysISO(next, 1);
    }
    return next;
  }

  const m = /^every\s+(?:(\d+)\s+)?(day|week|month|year)s?$/.exec(r);
  if (!m) return null;
  const n = m[1] ? parseInt(m[1], 10) : 1;
  const unit = m[2];
  if (unit === "day") return addDaysISO(iso, n);
  if (unit === "week") return addDaysISO(iso, n * 7);

  // Month/year advance by calendar field (UTC-safe), clamping overflow days
  // (e.g. Jan 31 + 1 month → Feb 28/29) the same way Obsidian/moment does.
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  if (unit === "month") d.setUTCMonth(d.getUTCMonth() + n);
  else d.setUTCFullYear(d.getUTCFullYear() + n);
  // If the day-of-month overflowed into the next month, clamp to that month's last day.
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

// Advance every schedulable date signifier present in a task body by one recurrence
// period. Returns the rewritten body plus a flag for whether any date was actually
// advanced — used to skip spawning a useless next occurrence when the recurring task
// has no reference date (Obsidian only rolls a recurrence that carries a date).
function advanceRecurringBody(body: string, rule: string): { body: string; advanced: boolean } {
  let out = body;
  let advanced = false;
  for (const [emoji] of DATE_FIELDS) {
    // Only advance the schedulable dates; done/created/cancelled don't recur forward.
    if (emoji === "✅" || emoji === "➕" || emoji === "❌") continue;
    const re = DATE_FIELD_REGEX.get(emoji)!;
    const dm = re.exec(out);
    if (dm) {
      const next = advanceDateByRecurrence(dm[1], rule);
      if (next) {
        out = out.replace(dm[0], `${emoji} ${next}`);
        advanced = true;
      }
    }
  }
  return { body: out, advanced };
}

/**
 * Flip a task line between done and not-done.
 * - Completing: set the box to `x`; append `✅ <today>` unless a done-date is already present.
 *   If the task carries a 🔁 recurrence, a fresh NOT-done copy of the line (recurrence kept,
 *   due/scheduled/start dates advanced one period, no ✅) is inserted ABOVE the completed
 *   one — matching the Obsidian Tasks plugin. The returned string then spans two lines.
 * - Un-completing: set the box to a space; strip any `✅ <date>` signifier.
 * The bullet is normalized to `-`. Throws if the line is not a task.
 */
export function toggleTaskLine(line: string, today: string): string {
  const cr = line.endsWith("\r") ? "\r" : "";
  const bare = cr ? line.slice(0, -1) : line;
  const m = TASK_LINE.exec(bare);
  if (!m) throw new Error("not a task line");
  const [, indent, statusChar, body] = m;
  const isDone = statusChar === "x" || statusChar === "X";
  if (isDone) {
    const cleaned = body.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trimEnd();
    return `${indent}- [ ] ${cleaned}${cr}`;
  }
  const hasDoneDate = /✅\s*\d{4}-\d{2}-\d{2}/.test(body);
  const withDate = hasDoneDate ? body.trimEnd() : `${body.trimEnd()} ✅ ${today}`;
  const completed = `${indent}- [x] ${withDate}`;

  // Recurring task: spawn the next occurrence above the completed line. Each emitted
  // line keeps the original's trailing CR so CRLF files stay consistent. Skip when the
  // rule is unrecognized or there's no date to advance (nothing meaningful to roll).
  const task = parseTaskLine(bare, "", 0);
  if (task?.recurrence) {
    const { body: nextBody, advanced } = advanceRecurringBody(body.trimEnd(), task.recurrence);
    if (advanced) {
      const nextOccurrence = `${indent}- [ ] ${nextBody}`;
      return `${nextOccurrence}${cr}\n${completed}${cr}`;
    }
  }
  return `${completed}${cr}`;
}

/**
 * Set a task line's checkbox to a SPECIFIC status char (`" "`, `"x"`, `"/"`, `"-"`, …),
 * rather than the binary flip `toggleTaskLine` does.
 * - Target `x`/`X` (done): same as completing in `toggleTaskLine` — append `✅ <today>`
 *   (unless present) and spawn the next occurrence of a 🔁 recurring task above it.
 * - Any other target (todo/in-progress/cancelled/…): set the box and strip any
 *   `✅ <date>` done-signifier (it's no longer done).
 * The bullet is normalized to `-`. Throws if the line is not a task.
 */
export function setTaskLineStatus(line: string, status: string, today: string): string {
  const cr = line.endsWith("\r") ? "\r" : "";
  const bare = cr ? line.slice(0, -1) : line;
  const m = TASK_LINE.exec(bare);
  if (!m) throw new Error("not a task line");
  const [, indent, , body] = m;
  const isDone = status === "x" || status === "X";
  if (!isDone) {
    const cleaned = body.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trimEnd();
    return `${indent}- [${status}] ${cleaned}${cr}`;
  }
  const hasDoneDate = /✅\s*\d{4}-\d{2}-\d{2}/.test(body);
  const withDate = hasDoneDate ? body.trimEnd() : `${body.trimEnd()} ✅ ${today}`;
  const completed = `${indent}- [${status}] ${withDate}`;

  const task = parseTaskLine(bare, "", 0);
  if (task?.recurrence) {
    const { body: nextBody, advanced } = advanceRecurringBody(body.trimEnd(), task.recurrence);
    if (advanced) {
      const nextOccurrence = `${indent}- [ ] ${nextBody}`;
      return `${nextOccurrence}${cr}\n${completed}${cr}`;
    }
  }
  return `${completed}${cr}`;
}

// The pure block-reorder primitives live in ./taskReorder (imported above) so the frontend
// (taskFold.ts) can import reorderTaskBlocks without pulling this module's fileAccess → files.ts
// (node) deps. Re-exported so existing `from "./tasks"` importers (server.ts) keep working.
export { reorderTaskBlocks, isResolvedStatus };

/**
 * Permanently remove every resolved (done/cancelled) task item — head line plus its
 * indented children — from the content. Returns the rewritten content and the number of
 * task items removed. Pure; git keeps the history. Backs the "Archive tasks" commands.
 */
export function archiveResolvedTasks(content: string): { content: string; removed: number } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let removed = 0;
  let i = 0;
  while (i < lines.length) {
    if (!parseTaskLine(lines[i], "", i)) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const { items, end } = collectBlock(lines, i);
    for (const it of items) {
      if (isResolvedStatus(it.status)) removed++;
      else out.push(...it.lines);
    }
    i = end;
  }
  return { content: out.join(eol), removed };
}

/** Read every markdown file in the vault and return all checkbox tasks across them. */
export async function collectVaultTasks(root: string): Promise<Task[]> {
  const { listMarkdown, readNote } = await getFileAccess();
  const rels = await listMarkdown(root);
  const contents = await Promise.all(
    rels.map(async (rel) => ({ rel, content: await readNote(root, rel) }))
  );
  const out: Task[] = [];
  for (const { rel, content } of contents) {
    out.push(...extractTasks(content, rel));
  }
  return out;
}

/**
 * Like collectVaultTasks, but restricted to an explicit set of vault-relative note
 * paths — the basis for scoped tasks (`source: tasks from [[Base]]`). Unreadable
 * paths are skipped. Reuses the pure per-file extractTasks so task fields, file path,
 * and line numbers stay identical (write-back relies on path+line).
 */
export async function collectTasksFromPaths(root: string, paths: string[]): Promise<Task[]> {
  const { readNote } = await getFileAccess();
  const contents = await Promise.all(paths.map((p) => readNote(root, p).catch(() => "")));
  return paths.flatMap((p, i) => extractTasks(contents[i], p));
}
