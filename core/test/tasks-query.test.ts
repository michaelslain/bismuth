import { test, expect } from "bun:test";
import { runTaskQuery } from "../src/tasks-query";
import type { Task } from "../src/tasks";

const TODAY = "2026-05-27";

function task(p: Partial<Task>): Task {
  return {
    path: "f.md", line: 0, raw: "", indent: "", status: "todo", statusChar: " ",
    description: "x", priority: "none", tags: [], ...p,
  };
}

test("not done / done filter on status", () => {
  const tasks = [task({ status: "todo", description: "a" }), task({ status: "done", description: "b" })];
  expect(runTaskQuery(tasks, "not done", TODAY).tasks.map((t) => t.description)).toEqual(["a"]);
  expect(runTaskQuery(tasks, "done", TODAY).tasks.map((t) => t.description)).toEqual(["b"]);
});

test("not done excludes cancelled tasks (cancelled is closed, not actionable)", () => {
  const tasks = [
    task({ status: "todo", description: "todo" }),
    task({ status: "in-progress", description: "wip" }),
    task({ status: "cancelled", description: "cancelled" }),
    task({ status: "done", description: "done" }),
  ];
  expect(runTaskQuery(tasks, "not done", TODAY).tasks.map((t) => t.description).sort()).toEqual(["todo", "wip"]);
});

test("done matches both completed and cancelled tasks", () => {
  const tasks = [
    task({ status: "done", description: "done" }),
    task({ status: "cancelled", description: "cancelled" }),
    task({ status: "todo", description: "todo" }),
  ];
  expect(runTaskQuery(tasks, "done", TODAY).tasks.map((t) => t.description).sort()).toEqual(["cancelled", "done"]);
});

test("is cancelled / is not cancelled", () => {
  const tasks = [task({ status: "cancelled", description: "c" }), task({ status: "todo", description: "t" })];
  expect(runTaskQuery(tasks, "is cancelled", TODAY).tasks.map((t) => t.description)).toEqual(["c"]);
  expect(runTaskQuery(tasks, "is not cancelled", TODAY).tasks.map((t) => t.description)).toEqual(["t"]);
});

test("done today filters by done date", () => {
  const tasks = [
    task({ status: "done", done: "2026-05-27", description: "today" }),
    task({ status: "done", done: "2026-05-01", description: "old" }),
  ];
  expect(runTaskQuery(tasks, "done today", TODAY).tasks.map((t) => t.description)).toEqual(["today"]);
});

test("is recurring / is not recurring", () => {
  const tasks = [task({ recurrence: "every day", description: "r" }), task({ description: "n" })];
  expect(runTaskQuery(tasks, "is recurring", TODAY).tasks.map((t) => t.description)).toEqual(["r"]);
  expect(runTaskQuery(tasks, "is not recurring", TODAY).tasks.map((t) => t.description)).toEqual(["n"]);
});

test("priority is / is not", () => {
  const tasks = [task({ priority: "high", description: "h" }), task({ priority: "low", description: "l" })];
  expect(runTaskQuery(tasks, "priority is high", TODAY).tasks.map((t) => t.description)).toEqual(["h"]);
  expect(runTaskQuery(tasks, "priority is not high", TODAY).tasks.map((t) => t.description)).toEqual(["l"]);
});

test("date comparisons: before/after/on and undated excluded", () => {
  const tasks = [
    task({ due: "2026-05-20", description: "past" }),
    task({ due: "2026-05-27", description: "today" }),
    task({ due: "2026-06-10", description: "future" }),
    task({ description: "none" }),
  ];
  expect(runTaskQuery(tasks, "due before today", TODAY).tasks.map((t) => t.description)).toEqual(["past"]);
  expect(runTaskQuery(tasks, "due today", TODAY).tasks.map((t) => t.description)).toEqual(["today"]);
  expect(runTaskQuery(tasks, "due after today", TODAY).tasks.map((t) => t.description)).toEqual(["future"]);
});

test("relative date expr: due before in 7 days", () => {
  const tasks = [
    task({ due: "2026-05-30", description: "within" }),
    task({ due: "2026-06-15", description: "beyond" }),
  ];
  expect(runTaskQuery(tasks, "due before in 7 days", TODAY).tasks.map((t) => t.description)).toEqual(["within"]);
});

test("boolean OR / AND with parentheses", () => {
  const tasks = [
    task({ priority: "high", description: "h" }),
    task({ due: "2026-05-20", description: "due" }),
    task({ description: "neither" }),
  ];
  const q = "(priority is high) OR (due before today)";
  expect(runTaskQuery(tasks, q, TODAY).tasks.map((t) => t.description).sort()).toEqual(["due", "h"]);
  const q2 = "(priority is high) AND (due before today)";
  expect(runTaskQuery(tasks, q2, TODAY).tasks).toEqual([]);
});

test("multiple filter lines are ANDed", () => {
  const tasks = [
    task({ status: "todo", priority: "high", description: "keep" }),
    task({ status: "done", priority: "high", description: "drop-done" }),
    task({ status: "todo", priority: "low", description: "drop-low" }),
  ];
  const q = "not done\npriority is high";
  expect(runTaskQuery(tasks, q, TODAY).tasks.map((t) => t.description)).toEqual(["keep"]);
});

test("sort by priority then due", () => {
  const tasks = [
    task({ priority: "low", due: "2026-05-01", description: "low-early" }),
    task({ priority: "high", due: "2026-06-01", description: "high-late" }),
    task({ priority: "high", due: "2026-05-10", description: "high-early" }),
  ];
  const q = "sort by priority\nsort by due";
  expect(runTaskQuery(tasks, q, TODAY).tasks.map((t) => t.description)).toEqual([
    "high-early", "high-late", "low-early",
  ]);
});

test("sort by due puts undated last", () => {
  const tasks = [
    task({ description: "none" }),
    task({ due: "2026-05-10", description: "dated" }),
  ];
  expect(runTaskQuery(tasks, "sort by due", TODAY).tasks.map((t) => t.description)).toEqual(["dated", "none"]);
});

test("unrecognized filter is reported and does not exclude everything", () => {
  const tasks = [task({ description: "a" }), task({ description: "b" })];
  const out = runTaskQuery(tasks, "happiness is high", TODAY);
  expect(out.errors.length).toBeGreaterThan(0);
  expect(out.tasks.length).toBe(2);
});

test("recognized-but-unsupported instructions are silently ignored", () => {
  const tasks = [task({ status: "todo", description: "a" })];
  const out = runTaskQuery(tasks, "not done\ngroup by filename\nlimit 5", TODAY);
  expect(out.errors).toEqual([]);
  expect(out.tasks.map((t) => t.description)).toEqual(["a"]);
});

test("the user's real 🔥 query runs without error", () => {
  const tasks = [
    task({ status: "todo", priority: "high", due: "2026-05-26", description: "overdue-high" }),
    task({ status: "todo", priority: "medium", due: "2026-05-26", description: "overdue-medium" }),
    task({ status: "done", priority: "high", due: "2026-05-26", description: "done-high" }),
    task({ status: "todo", recurrence: "every day", priority: "high", due: "2026-05-26", description: "recurring-high" }),
  ];
  const q = [
    "not done",
    "is not recurring",
    "((due before today) OR (due today) OR ((due after today) AND (due before in 7 days)) OR (priority is high) OR (scheduled today) OR (scheduled before today))",
    "(priority is not medium) AND (priority is not low)",
    "sort by priority",
    "sort by due",
  ].join("\n");
  const out = runTaskQuery(tasks, q, TODAY);
  expect(out.errors).toEqual([]);
  expect(out.tasks.map((t) => t.description)).toEqual(["overdue-high"]);
});
