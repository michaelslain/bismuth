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
