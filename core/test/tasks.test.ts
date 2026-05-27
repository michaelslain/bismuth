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

import { toggleTaskLine, todayISO } from "../src/tasks";

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

test("todayISO formats a Date as YYYY-MM-DD", () => {
  expect(todayISO(new Date("2026-05-27T15:00:00Z"))).toBe("2026-05-27");
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
