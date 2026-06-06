import { test, expect } from "bun:test";
import { parseQueryBlock } from "../../src/bases/queryBlock";

// New grammar: a view references a base (`of:`) or runs a task query (`tasks:`),
// optionally scoped (`from:`). `from: notes` was removed — iterating notes is a
// base's job, so a block with neither of:/tasks: has no source.

test("of: [[X]] => base source (follows the base's own source)", () => {
  const vb = parseQueryBlock("of: [[Calendar]]\nas: list\nwhere: date == today");
  expect(vb.source).toEqual({ kind: "base", ref: "[[Calendar]]" });
  expect(vb.as).toBe("list");
  expect(vb.where).toBe("date == today");
});

test("tasks: <dsl> => tasks source with where", () => {
  const vb = parseQueryBlock("tasks: not done\nas: list");
  expect(vb.source).toEqual({ kind: "tasks", where: "not done" });
  expect(vb.as).toBe("list");
});

test("tasks: + from: [[Base]] => scoped task query", () => {
  const vb = parseQueryBlock("tasks: not done\nfrom: [[Keep]]\nas: kanban\ngroup: status");
  expect(vb.source).toEqual({ kind: "tasks", where: "not done", from: "[[Keep]]" });
  expect(vb.as).toBe("kanban");
  expect(vb.group).toBe("status");
});

test("bare tasks: (no dsl) => all tasks, defaults to a checkbox list", () => {
  const vb = parseQueryBlock("tasks:");
  expect(vb.source).toEqual({ kind: "tasks" });
  expect(vb.as).toBe("list");
});

test("neither of: nor tasks: => no source (empty state)", () => {
  const vb = parseQueryBlock("as: cards");
  expect(vb.source).toBeUndefined();
});

test("from: alone (no tasks:) is not a source", () => {
  const vb = parseQueryBlock("from: [[Keep]]\nas: table");
  expect(vb.source).toBeUndefined();
});

test("dropped: from: notes no longer iterates the vault", () => {
  const vb = parseQueryBlock('from: notes where status == "done"\nas: table');
  expect(vb.source).toBeUndefined();
});

test("unknown view falls back: table for a base/notes query, list for tasks", () => {
  expect(parseQueryBlock("of: [[X]]\nview: bogus").as).toBe("table");
  expect(parseQueryBlock("tasks:\nview: bogus").as).toBe("list");
});
