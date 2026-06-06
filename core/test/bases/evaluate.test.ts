import { test, expect } from "bun:test";
import { parseExpr } from "../../src/bases/parser";
import { evaluate } from "../../src/bases/evaluate";
import type { EvalContext } from "../../src/bases/types";

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  file: { name: "housing", basename: "housing", path: "housing.md", folder: "", ext: "md", size: 10, ctime: 0, mtime: 0, tags: ["logistics"], links: ["internship"] },
  note: { price: 10, age: 2, status: "in-progress", done: false },
  formula: {},
  ...over,
});

const run = (src: string, c = ctx()) => evaluate(parseExpr(src), c);

test("evaluates arithmetic with precedence", () => {
  expect(run("1 + 2 * 3")).toBe(7);
  expect(run("(1 + 2) * 3")).toBe(9);
});

test("evaluates comparisons and booleans", () => {
  expect(run("price > 5")).toBe(true);
  expect(run("price > 5 && age < 1")).toBe(false);
  expect(run('status != "done"')).toBe(true);
  expect(run("price == 10 || age == 99")).toBe(true);
});

test("resolves bare, note., and file. identifiers", () => {
  expect(run("price")).toBe(10);
  expect(run("note.status")).toBe("in-progress");
  expect(run("file.name")).toBe("housing");
});

test("file.asLink(text) returns a Link with custom display text", () => {
  expect(run('file.asLink("a quote (p1)")')).toEqual({ __link: true, path: "housing.md", display: "a quote (p1)" });
  // No arg -> falls back to the file name as the display.
  expect(run("file.asLink()")).toEqual({ __link: true, path: "housing.md", display: "housing" });
});

test("file.hasLink accepts a FileMeta (this.file), matching by name", () => {
  // The host note's identity arrives as this.file; a note links to it by basename.
  const hostFile = { name: "internship", basename: "internship", path: "internship.md", folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] };
  const c = ctx({ this: { file: hostFile } });
  expect(run("file.hasLink(this.file)", c)).toBe(true);   // ctx file.links = ["internship"]
  const c2 = ctx({ this: { file: { ...hostFile, name: "nope" } } });
  expect(run("file.hasLink(this.file)", c2)).toBe(false);
  // Plain-string arg still works (back-compat).
  expect(run('file.hasLink("internship")')).toBe(true);
});

test("unary operators", () => {
  expect(run("!done")).toBe(true);
  expect(run("-age")).toBe(-2);
});

test("member access returns undefined for missing", () => {
  expect(run("note.missing")).toBeUndefined();
});

test("index access into a list", () => {
  expect(run("file.tags[0]", ctx())).toBe("logistics");
});

test("missing numeric operand yields NaN-safe falsey comparison", () => {
  expect(run("missing > 5")).toBe(false);
});

test("&& / || return operand values, not booleans (JS semantics)", () => {
  // Falsey left -> short-circuit returns the left value; truthy left -> right value.
  expect(run('missing || "default"')).toBe("default");
  expect(run('status || "default"')).toBe("in-progress"); // truthy string passes through
  expect(run('price && "yes"')).toBe("yes");              // truthy number -> right
  expect(run('done && "yes"')).toBe(false);               // falsey -> left
  // truthy() still coerces at the filter boundary, so this stays usable in filters.
  expect(run('!!(missing || "default")')).toBe(true);
});

test("date arithmetic: Date + duration string -> shifted Date", () => {
  const base = new Date("2026-05-27T00:00:00Z").getTime();
  const c = ctx({
    note: { d: new Date("2026-05-27T00:00:00Z") },
    file: { name: "x", basename: "x", path: "x.md", folder: "", ext: "md", size: 0, ctime: 0, mtime: base, tags: [], links: [] },
  });
  const plus1d = evaluate(parseExpr('d + "1d"'), c) as Date;
  expect(plus1d.getTime()).toBe(base + 86_400_000);
  const minus2h = evaluate(parseExpr('d - "2h"'), c) as Date;
  expect(minus2h.getTime()).toBe(base - 7_200_000);
  // mtime is a number (epoch ms) — arithmetic stays numeric.
  const mtimePlus = evaluate(parseExpr('file.mtime + "1d"'), c) as number;
  expect(mtimePlus).toBe(base + 86_400_000);
});

test("date + '0d' honors the zero-length duration (regression: || dropped 0)", () => {
  const base = new Date("2026-05-27T00:00:00Z").getTime();
  const c = ctx({
    note: { d: new Date("2026-05-27T00:00:00Z") },
    file: { name: "x", basename: "x", path: "x.md", folder: "", ext: "md", size: 0, ctime: 0, mtime: base, tags: [], links: [] },
  });
  // 0d parses to 0 ms; + must add it (yielding the same instant), not skip the
  // duration branch and fall through to string concat. - already did this.
  const plus0 = evaluate(parseExpr('d + "0d"'), c) as Date;
  expect(plus0 instanceof Date).toBe(true);
  expect(plus0.getTime()).toBe(base);
  const minus0 = evaluate(parseExpr('d - "0d"'), c) as Date;
  expect(minus0.getTime()).toBe(base);
  // Numeric + zero duration stays numeric (not a stringified concat).
  const numPlus0 = evaluate(parseExpr('file.mtime + "0d"'), c) as number;
  expect(numPlus0).toBe(base);
  // The duration("0d") path composes the same way.
  const durPlus0 = evaluate(parseExpr('d + duration("0d")'), c) as Date;
  expect(durPlus0.getTime()).toBe(base);
});
