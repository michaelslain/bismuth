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
