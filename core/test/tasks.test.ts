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
