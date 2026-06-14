import { test, expect, describe } from "bun:test";
import { rowKey, rowsEqual, reconcileRows, reconcileViewResult } from "./reconcileRows";
import type { Row, ViewResult, ResultGroup } from "../../../core/src/bases/types";

function fm(path: string, extra: Record<string, unknown> = {}) {
  const slash = path.lastIndexOf("/");
  const name = (slash >= 0 ? path.slice(slash + 1) : path).replace(/\.md$/, "");
  return { name, basename: name, path, folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [], ...extra };
}

// A task row: note carries line + status + raw (what isTaskRow / taskToRow produce).
function taskRow(path: string, line: number, status: string, statusChar = " "): Row {
  return { file: fm(path), note: { line, status, statusChar, raw: `- [${statusChar}] x`, description: "x" }, formula: {} };
}
// A note row: keyed by path.
function noteRow(path: string, note: Record<string, unknown> = {}): Row {
  return { file: fm(path), note, formula: {} };
}

function group(key: string, rows: Row[]): ResultGroup {
  return { key, rows };
}
function result(groups: ResultGroup[]): ViewResult {
  return { view: { type: "list", name: "List" } as ViewResult["view"], columns: ["file.name"], groups, summaries: {} };
}

describe("rowKey", () => {
  test("task rows key by path:line, note rows by path", () => {
    expect(rowKey(taskRow("a.md", 3, "todo"))).toBe("a.md:3");
    expect(rowKey(noteRow("a.md"))).toBe("a.md");
  });
});

describe("rowsEqual", () => {
  test("identical rows are equal; a flipped status char is not", () => {
    expect(rowsEqual(taskRow("a.md", 1, "todo", " "), taskRow("a.md", 1, "todo", " "))).toBe(true);
    expect(rowsEqual(taskRow("a.md", 1, "todo", " "), taskRow("a.md", 1, "done", "x"))).toBe(false);
  });
  test("an mtime-only change does NOT break equality (volatile stat; body freshness is separate)", () => {
    // A body edit bumps mtime but the card keeps identity + updates in place via BodyCard's
    // SSE self-refresh — so a task toggle inside a card doesn't remount/flicker the card.
    expect(rowsEqual(noteRow("a.md"), { file: fm("a.md", { mtime: 5, size: 9 }), note: {}, formula: {} })).toBe(true);
  });
  test("a tag/link/frontmatter/formula change DOES break equality", () => {
    expect(rowsEqual(noteRow("a.md"), { file: fm("a.md", { tags: ["x"] }), note: {}, formula: {} })).toBe(false);
    expect(rowsEqual(noteRow("a.md", { status: "todo" }), noteRow("a.md", { status: "done" }))).toBe(false);
    expect(rowsEqual(
      { file: fm("a.md"), note: {}, formula: { score: 1 } },
      { file: fm("a.md"), note: {}, formula: { score: 2 } },
    )).toBe(false);
  });
});

describe("reconcileRows", () => {
  test("unchanged list returns the SAME array reference", () => {
    const prev = [taskRow("a.md", 1, "todo"), taskRow("b.md", 2, "todo")];
    const next = [taskRow("a.md", 1, "todo"), taskRow("b.md", 2, "todo")];
    expect(reconcileRows(prev, next)).toBe(prev);
  });

  test("a single changed row reuses every OTHER row's identity", () => {
    const a = taskRow("a.md", 1, "todo", " ");
    const b = taskRow("b.md", 2, "todo", " ");
    const prev = [a, b];
    const next = [taskRow("a.md", 1, "todo", " "), taskRow("b.md", 2, "done", "x")];
    const out = reconcileRows(prev, next);
    expect(out).not.toBe(prev); // changed → new array
    expect(out[0]).toBe(a); // unchanged row keeps its reference (no remount)
    expect(out[1]).toBe(next[1]); // changed row takes the fresh reference
  });

  test("a removed row drops out, survivors keep identity", () => {
    const a = taskRow("a.md", 1, "todo");
    const b = taskRow("b.md", 2, "todo");
    const out = reconcileRows([a, b], [taskRow("a.md", 1, "todo")]);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(a);
  });

  test("no previous rows → returns next verbatim", () => {
    const next = [taskRow("a.md", 1, "todo")];
    expect(reconcileRows(undefined, next)).toBe(next);
    expect(reconcileRows([], next)).toBe(next);
  });
});

describe("reconcileViewResult", () => {
  test("a status change in one group preserves the other group's object + rows", () => {
    const g1rows = [taskRow("a.md", 1, "todo")];
    const g2a = taskRow("b.md", 2, "todo", " ");
    const prev = result([group("🔥", g1rows), group("🌊", [g2a])]);

    const next = result([
      group("🔥", [taskRow("a.md", 1, "todo")]), // unchanged
      group("🌊", [taskRow("b.md", 2, "done", "x")]), // changed
    ]);
    const out = reconcileViewResult(prev, next);

    expect(out.groups[0]).toBe(prev.groups[0]); // untouched group reused wholesale
    expect(out.groups[1]).not.toBe(prev.groups[1]); // changed group is fresh
  });

  test("no previous result → returns next verbatim", () => {
    const next = result([group("", [taskRow("a.md", 1, "todo")])]);
    expect(reconcileViewResult(undefined, next)).toBe(next);
  });
});
