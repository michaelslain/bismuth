import { test, expect } from "bun:test";
import { parseViewBlock } from "../../src/bases/viewBlock";

test("of: [[X]] => base source", () => {
  const vb = parseViewBlock("of: [[Calendar]]\nas: list\nwhere: date == today");
  expect(vb.source).toEqual({ kind: "base", ref: "[[Calendar]]" });
  expect(vb.as).toBe("list");
  expect(vb.where).toBe("date == today");
});

test("from: notes where ... => notes source", () => {
  const vb = parseViewBlock("from: notes where #book\nas: cards");
  expect(vb.source).toEqual({ kind: "notes", where: "#book" });
  expect(vb.as).toBe("cards");
});

test("from: tasks where ... => tasks source, default view table", () => {
  const vb = parseViewBlock("from: tasks where not done");
  expect(vb.source).toEqual({ kind: "tasks", where: "not done" });
  expect(vb.as).toBe("table");
});

test("from: notes with no where => notes source, no filter", () => {
  const vb = parseViewBlock("from: notes\nas: kanban\ngroup: status");
  expect(vb.source).toEqual({ kind: "notes", where: undefined });
  expect(vb.as).toBe("kanban");
  expect(vb.group).toBe("status");
});

test("unknown as: falls back to table", () => {
  const vb = parseViewBlock("from: tasks\nas: bogus");
  expect(vb.as).toBe("table");
});
