import { test, expect } from "bun:test";
import { parseTaskLine, extractTasks } from "../src/tasks";

test("parses a plain todo", () => {
  const t = parseTaskLine("- [ ] buy milk", "shopping.md", 0)!;
  expect(t.status).toBe("todo");
  expect(t.description).toBe("buy milk");
  expect(t.path).toBe("shopping.md");
  expect(t.line).toBe(0);
});

test("parses a completed task", () => {
  const t = parseTaskLine("- [x] done thing", "f.md", 3)!;
  expect(t.status).toBe("done");
  expect(t.description).toBe("done thing");
});

test("recognizes in-progress and cancelled status chars", () => {
  expect(parseTaskLine("- [/] wip", "f.md", 0)!.status).toBe("in-progress");
  expect(parseTaskLine("- [-] nope", "f.md", 0)!.status).toBe("cancelled");
});

test("returns null for non-task lines", () => {
  expect(parseTaskLine("just text", "f.md", 0)).toBeNull();
  expect(parseTaskLine("# heading", "f.md", 0)).toBeNull();
  expect(parseTaskLine("- bullet, no checkbox", "f.md", 0)).toBeNull();
});

test("preserves indentation in raw + indent", () => {
  const t = parseTaskLine("    - [ ] nested", "f.md", 0)!;
  expect(t.indent).toBe("    ");
  expect(t.raw).toBe("    - [ ] nested");
  expect(t.description).toBe("nested");
});

test("extracts due/scheduled/start dates", () => {
  const t = parseTaskLine("- [ ] pay rent 📅 2026-06-01 ⏳ 2026-05-28 🛫 2026-05-20", "f.md", 0)!;
  expect(t.due).toBe("2026-06-01");
  expect(t.scheduled).toBe("2026-05-28");
  expect(t.start).toBe("2026-05-20");
  expect(t.description).toBe("pay rent");
});

test("extracts done/created/cancelled dates", () => {
  const t = parseTaskLine("- [x] thing ✅ 2026-05-27 ➕ 2026-05-01", "f.md", 0)!;
  expect(t.done).toBe("2026-05-27");
  expect(t.created).toBe("2026-05-01");
});

test("extracts priority", () => {
  expect(parseTaskLine("- [ ] a ⏫", "f.md", 0)!.priority).toBe("high");
  expect(parseTaskLine("- [ ] b 🔼", "f.md", 0)!.priority).toBe("medium");
  expect(parseTaskLine("- [ ] c 🔺", "f.md", 0)!.priority).toBe("highest");
  expect(parseTaskLine("- [ ] d ⏬", "f.md", 0)!.priority).toBe("lowest");
  expect(parseTaskLine("- [ ] e", "f.md", 0)!.priority).toBe("none");
});

test("extracts recurrence", () => {
  const t = parseTaskLine("- [ ] standup 🔁 every weekday 📅 2026-05-28", "f.md", 0)!;
  expect(t.recurrence).toBe("every weekday");
  expect(t.due).toBe("2026-05-28");
  expect(t.description).toBe("standup");
});

test("extracts tags but keeps them in the description", () => {
  const t = parseTaskLine("- [ ] email boss #work #urgent", "f.md", 0)!;
  expect(t.tags.sort()).toEqual(["urgent", "work"]);
  expect(t.description).toContain("#work");
});

test("extractTasks finds only task lines with correct line numbers", () => {
  const md = "# Title\n\n- [ ] one\nsome prose\n- [x] two\n  - [ ] three\n";
  const tasks = extractTasks(md, "n.md");
  expect(tasks.map((t) => t.line)).toEqual([2, 4, 5]);
  expect(tasks.map((t) => t.description)).toEqual(["one", "two", "three"]);
});

test("extractTasks handles CRLF line endings", () => {
  const md = "- [ ] one\r\nprose\r\n- [x] two\r\n";
  const tasks = extractTasks(md, "n.md");
  expect(tasks.map((t) => t.description)).toEqual(["one", "two"]);
  expect(tasks.map((t) => t.line)).toEqual([0, 2]);
});

test("captures tags on both sides of the recurrence signifier", () => {
  const t = parseTaskLine("- [ ] a #before 🔁 every week #after", "f.md", 0)!;
  expect(t.tags.sort()).toEqual(["after", "before"]);
  expect(t.recurrence).toContain("every week");
});

test("dedupes repeated tags", () => {
  const t = parseTaskLine("- [ ] x #work #work", "f.md", 0)!;
  expect(t.tags).toEqual(["work"]);
});

import { toggleTaskLine } from "../src/tasks";
import { todayISO } from "../src/dates";

test("toggleTaskLine completes a todo and appends today's done date", () => {
  const out = toggleTaskLine("- [ ] buy milk", "2026-05-27");
  expect(out).toBe("- [x] buy milk ✅ 2026-05-27");
});

test("toggleTaskLine un-completes a done task and strips the done date", () => {
  const out = toggleTaskLine("- [x] buy milk ✅ 2026-05-27", "2026-05-27");
  expect(out).toBe("- [ ] buy milk");
});

test("toggleTaskLine preserves indentation", () => {
  expect(toggleTaskLine("    - [ ] nested", "2026-05-27")).toBe("    - [x] nested ✅ 2026-05-27");
});

test("toggleTaskLine does not duplicate an existing done date when completing", () => {
  const out = toggleTaskLine("- [ ] thing ✅ 2026-01-01", "2026-05-27");
  expect(out).toBe("- [x] thing ✅ 2026-01-01");
});

test("toggleTaskLine throws on a non-task line", () => {
  expect(() => toggleTaskLine("not a task", "2026-05-27")).toThrow();
});

test("toggleTaskLine preserves a trailing CR", () => {
  expect(toggleTaskLine("- [ ] x\r", "2026-05-27")).toBe("- [x] x ✅ 2026-05-27\r");
});

test("todayISO formats a Date as YYYY-MM-DD", () => {
  expect(todayISO(new Date("2026-05-27T15:00:00Z"))).toBe("2026-05-27");
});

// --- Recurring-task completion (B16): completing spawns the next occurrence ---

test("completing a daily recurring task inserts a not-done copy with due advanced by 1 day", () => {
  const out = toggleTaskLine("- [ ] water plants 🔁 every day 📅 2026-05-31", "2026-05-31");
  // New occurrence above, completed line below.
  expect(out).toBe(
    "- [ ] water plants 🔁 every day 📅 2026-06-01\n" +
      "- [x] water plants 🔁 every day 📅 2026-05-31 ✅ 2026-05-31",
  );
});

test("the spawned recurrence copy is not-done and carries no done date", () => {
  const out = toggleTaskLine("- [ ] standup 🔁 every day 📅 2026-05-31", "2026-05-31");
  const lines = out.split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0].startsWith("- [ ] ")).toBe(true); // next occurrence, not done
  expect(lines[0]).not.toContain("✅");
  expect(lines[1].startsWith("- [x] ")).toBe(true); // completed
  expect(lines[1]).toContain("✅ 2026-05-31");
});

test("completing a non-recurring task is unchanged (single line, no copy)", () => {
  const out = toggleTaskLine("- [ ] buy milk 📅 2026-05-31", "2026-05-31");
  expect(out).toBe("- [x] buy milk 📅 2026-05-31 ✅ 2026-05-31");
  expect(out).not.toContain("\n");
});

test("recurrence with only a scheduled date advances scheduled (no due)", () => {
  const out = toggleTaskLine("- [ ] review 🔁 every day ⏳ 2026-05-31", "2026-05-31");
  expect(out).toBe(
    "- [ ] review 🔁 every day ⏳ 2026-06-01\n" +
      "- [x] review 🔁 every day ⏳ 2026-05-31 ✅ 2026-05-31",
  );
});

test("weekly recurrence advances the due date by 7 days", () => {
  const out = toggleTaskLine("- [ ] groceries 🔁 every week 📅 2026-05-31", "2026-05-31");
  expect(out.split("\n")[0]).toBe("- [ ] groceries 🔁 every week 📅 2026-06-07");
});

test("'every N days' recurrence advances by N days", () => {
  const out = toggleTaskLine("- [ ] meds 🔁 every 3 days 📅 2026-05-31", "2026-05-31");
  expect(out.split("\n")[0]).toBe("- [ ] meds 🔁 every 3 days 📅 2026-06-03");
});

test("monthly recurrence advances by a calendar month, clamping overflow", () => {
  const out = toggleTaskLine("- [ ] rent 🔁 every month 📅 2026-01-31", "2026-05-31");
  // Jan 31 + 1 month clamps to Feb 28 (2026 is not a leap year).
  expect(out.split("\n")[0]).toBe("- [ ] rent 🔁 every month 📅 2026-02-28");
});

test("'every weekday' recurrence skips the weekend", () => {
  // 2026-05-29 is a Friday; next weekday is Monday 2026-06-01.
  const out = toggleTaskLine("- [ ] standup 🔁 every weekday 📅 2026-05-29", "2026-05-29");
  expect(out.split("\n")[0]).toBe("- [ ] standup 🔁 every weekday 📅 2026-06-01");
});

test("recurrence advances multiple date signifiers together", () => {
  const out = toggleTaskLine(
    "- [ ] plan 🔁 every day 📅 2026-05-31 ⏳ 2026-05-30 🛫 2026-05-29",
    "2026-05-31",
  );
  expect(out.split("\n")[0]).toBe(
    "- [ ] plan 🔁 every day 📅 2026-06-01 ⏳ 2026-05-31 🛫 2026-05-30",
  );
});

test("recurring completion preserves a trailing CR on both emitted lines", () => {
  const out = toggleTaskLine("- [ ] x 🔁 every day 📅 2026-05-31\r", "2026-05-31");
  expect(out).toBe(
    "- [ ] x 🔁 every day 📅 2026-06-01\r\n" + "- [x] x 🔁 every day 📅 2026-05-31 ✅ 2026-05-31\r",
  );
});

test("recurring task with no reference date spawns no next occurrence", () => {
  const out = toggleTaskLine("- [ ] floss 🔁 every day", "2026-05-31");
  expect(out).toBe("- [x] floss 🔁 every day ✅ 2026-05-31");
  expect(out).not.toContain("\n");
});

test("unrecognized recurrence rule does not spawn a next occurrence", () => {
  const out = toggleTaskLine("- [ ] odd 🔁 every blue moon 📅 2026-05-31", "2026-05-31");
  expect(out).toBe("- [x] odd 🔁 every blue moon 📅 2026-05-31 ✅ 2026-05-31");
  expect(out).not.toContain("\n");
});

test("un-completing a recurring task stays a single line (no new occurrence)", () => {
  const out = toggleTaskLine("- [x] water plants 🔁 every day 📅 2026-05-31 ✅ 2026-05-31", "2026-05-31");
  expect(out).toBe("- [ ] water plants 🔁 every day 📅 2026-05-31");
  expect(out).not.toContain("\n");
});

import { collectVaultTasks } from "../src/tasks";
import { writeNote } from "../src/files";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("collectVaultTasks scans every markdown file in the vault", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-tasks-"));
  await writeNote(vault, "a.md", "# A\n- [ ] task a 📅 2026-06-01\n");
  await writeNote(vault, "sub/b.md", "- [x] task b ✅ 2026-05-01\nprose\n- [ ] task c\n");
  const tasks = await collectVaultTasks(vault);
  const byDesc = Object.fromEntries(tasks.map((t) => [t.description, t]));
  expect(Object.keys(byDesc).sort()).toEqual(["task a", "task b", "task c"]);
  expect(byDesc["task a"].path).toBe("a.md");
  expect(byDesc["task a"].due).toBe("2026-06-01");
  expect(byDesc["task b"].path).toBe("sub/b.md");
  expect(byDesc["task c"].line).toBe(2);
});

import { collectTasksFromPaths } from "../src/tasks";
import { writeNote } from "../src/files";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("collectTasksFromPaths only scans the given paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "oa-scoped-"));
  await writeNote(root, "keep/a.md", "- [ ] inside keep");
  await writeNote(root, "keep/b.md", "no tasks here");
  await writeNote(root, "other/c.md", "- [ ] outside keep");

  const tasks = await collectTasksFromPaths(root, ["keep/a.md", "keep/b.md"]);
  expect(tasks.map((t) => t.description)).toEqual(["inside keep"]);
});

test("collectTasksFromPaths skips unreadable paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "oa-scoped2-"));
  await writeNote(root, "keep/a.md", "- [ ] real task");
  const tasks = await collectTasksFromPaths(root, ["keep/a.md", "keep/missing.md"]);
  expect(tasks.map((t) => t.description)).toEqual(["real task"]);
});
