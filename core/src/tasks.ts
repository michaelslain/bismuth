// Parse Obsidian-style checkbox tasks out of markdown, mirroring the Tasks plugin's
// emoji-signifier format. One Task per checkbox list item, tracking the source file
// and 0-indexed line so the line can be toggled back in place.

import { listMarkdown, readNote } from "./files";
import { todayISO } from "./dates";

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

const DATE_FIELDS: Array<[string, "due" | "scheduled" | "start" | "done" | "created" | "cancelled"]> = [
  ["📅", "due"],
  ["⏳", "scheduled"],
  ["🛫", "start"],
  ["✅", "done"],
  ["➕", "created"],
  ["❌", "cancelled"],
];

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
    }
  }

  const dates: Partial<Record<string, string>> = {};
  for (const [emoji, field] of DATE_FIELDS) {
    const re = new RegExp(emoji + "\\s*(\\d{4}-\\d{2}-\\d{2})");
    const dm = re.exec(rest);
    if (dm) {
      dates[field] = dm[1];
      rest = rest.replace(dm[0], " ");
    }
  }

  const tags = [...new Set([...rest.matchAll(/#([A-Za-z0-9_\/-]+)/g)].map((t) => t[1]))];

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


/**
 * Flip a task line between done and not-done.
 * - Completing: set the box to `x`; append `✅ <today>` unless a done-date is already present.
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
  return `${indent}- [x] ${withDate}${cr}`;
}

/** Read every markdown file in the vault and return all checkbox tasks across them. */
export async function collectVaultTasks(root: string): Promise<Task[]> {
  const rels = await listMarkdown(root);
  const out: Task[] = [];
  for (const rel of rels) {
    const content = await readNote(root, rel);
    out.push(...extractTasks(content, rel));
  }
  return out;
}
