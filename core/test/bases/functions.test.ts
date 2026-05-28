import { test, expect } from "bun:test";
import { parseExpr } from "../../src/bases/parser";
import { evaluate } from "../../src/bases/evaluate";
import type { EvalContext } from "../../src/bases/types";

const ctx: EvalContext = {
  file: { name: "housing", basename: "housing", path: "reading/housing.md", folder: "reading", ext: "md", size: 10, ctime: 1000, mtime: 2000, tags: ["logistics", "todo"], links: ["internship"] },
  note: { price: 10.456, title: "Hello World", items: ["b", "a", "a"] },
  formula: {},
};
const run = (s: string) => evaluate(parseExpr(s), ctx);

test("file.hasTag / inFolder / hasLink / hasProperty", () => {
  expect(run('file.hasTag("logistics")')).toBe(true);
  expect(run('file.hasTag("nope")')).toBe(false);
  expect(run('file.inFolder("reading")')).toBe(true);
  expect(run('file.hasLink("internship")')).toBe(true);
  expect(run('file.hasProperty("price")')).toBe(true);
  expect(run('file.hasProperty("nope")')).toBe(false);
});

test("if() returns branch values", () => {
  expect(run('if(price > 5, "big", "small")')).toBe("big");
  expect(run('if(price > 50, "big")')).toBeUndefined();
});

test("number methods", () => {
  expect(run("price.toFixed(2)")).toBe("10.46");
  expect(run("price.round(1)")).toBe(10.5);
  expect(run("price.floor()")).toBe(10);
  expect(run("price.ceil()")).toBe(11);
  expect(run("(-price).abs()")).toBe(10.456);
});

test("string methods", () => {
  expect(run("title.lower()")).toBe("hello world");
  expect(run("title.upper()")).toBe("HELLO WORLD");
  expect(run('title.contains("World")')).toBe(true);
  expect(run('title.startsWith("Hello")')).toBe(true);
  expect(run("title.length")).toBe(11);
});

test("list methods", () => {
  expect(run('items.contains("a")')).toBe(true);
  expect(run("items.length")).toBe(3);
  expect(run('items.join("-")')).toBe("b-a-a");
  expect(run("items.unique().length")).toBe(2);
  expect(run("file.tags.length")).toBe(2);
});

test("global helpers", () => {
  expect(run("max(1, 5, 3)")).toBe(5);
  expect(run("min(1, 5, 3)")).toBe(1);
  expect(run("number(\"42\")")).toBe(42);
  expect(run('list("x").length')).toBe(1);
});

test("length is also callable as a method", () => {
  expect(run("title.length")).toBe(11); // field access form
});

test("string .matches() supports regex pattern + optional flags", () => {
  expect(run('title.matches("^Hello")')).toBe(true);
  expect(run('title.matches("^hello")')).toBe(false);
  expect(run('title.matches("^hello", "i")')).toBe(true);
  // Malformed pattern must not throw — fail closed to false.
  expect(run('title.matches("(")')).toBe(false);
});

test("list .map / .filter / .reduce via property-path strings", () => {
  // Object-list shape: `.map("title")` and `.map("_.title")` are equivalent.
  const c = {
    file: ctx.file,
    note: { items: [{ title: "a", price: 1 }, { title: "b", price: 2 }, { title: "c", price: 3 }] },
    formula: {},
  };
  const m = (s: string) => evaluate(parseExpr(s), c);
  expect(m('items.map("title")')).toEqual(["a", "b", "c"]);
  expect(m('items.map("_.title")')).toEqual(["a", "b", "c"]);
  expect(m('items.filter("_.price").length')).toBe(3);
  expect(m('items.reduce("price", 0)')).toBe(6);
});

test("date .plus / .minus shift by duration", () => {
  const base = new Date("2026-05-27T00:00:00Z");
  const c = { ...ctx, note: { d: base } };
  const plus = evaluate(parseExpr('d.plus("1w")'), c) as Date;
  expect(plus.getTime()).toBe(base.getTime() + 7 * 86_400_000);
  const minus = evaluate(parseExpr('d.minus("30m")'), c) as Date;
  expect(minus.getTime()).toBe(base.getTime() - 30 * 60_000);
});

test("duration() helper parses to milliseconds", () => {
  expect(run('duration("1d")')).toBe(86_400_000);
  expect(run('duration("nonsense")')).toBeNaN();
});

test("real lambdas in list methods (closures, params, nesting)", () => {
  const c = {
    file: ctx.file,
    note: { items: [{ title: "a", price: 1 }, { title: "b", price: 2 }, { title: "c", price: 3 }] },
    formula: {},
  };
  const m = (s: string) => evaluate(parseExpr(s), c);
  expect(m("items.map(x => x.title)")).toEqual(["a", "b", "c"]);
  expect(m("items.filter(x => x.price > 1).length")).toBe(2);
  expect(m("items.reduce((acc, x) => acc + x.price, 0)")).toBe(6);
  // Lambda body can reference outer frontmatter via the bare name.
  const c2 = { file: ctx.file, note: { items: [1, 2, 3], cap: 2 }, formula: {} };
  expect(evaluate(parseExpr("items.filter(x => x <= cap)"), c2)).toEqual([1, 2]);
});

test("regex literal: /…/flags and .matches accepts RegExp directly", () => {
  expect(run("title.matches(/^hello/i)")).toBe(true);
  expect(run("title.matches(/^hello/)")).toBe(false);
  // Division still parses as division when context says so.
  expect(evaluate(parseExpr("10 / 2"), ctx)).toBe(5);
});
