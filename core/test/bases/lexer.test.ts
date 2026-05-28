import { test, expect } from "bun:test";
import { lex } from "../../src/bases/lexer";

const kinds = (s: string) => lex(s).map((t) => t.kind);

test("tokenizes a method call with args", () => {
  expect(kinds('file.hasTag("book")')).toEqual([
    "ident", "dot", "ident", "lparen", "string", "rparen",
  ]);
});

test("tokenizes arithmetic and comparison", () => {
  expect(kinds("price > 2.1 && age != 0")).toEqual([
    "ident", "op", "number", "op", "ident", "op", "number",
  ]);
});

test("reads string and number values", () => {
  const toks = lex('"hi" 42 3.5');
  expect(toks[0]).toMatchObject({ kind: "string", value: "hi" });
  expect(toks[1]).toMatchObject({ kind: "number", value: 42 });
  expect(toks[2]).toMatchObject({ kind: "number", value: 3.5 });
});

test("handles single-quoted strings and escaped quotes", () => {
  expect(lex("'a\\'b'")[0]).toMatchObject({ kind: "string", value: "a'b" });
});

test("recognizes keywords", () => {
  expect(lex("true false null").map((t) => t.kind)).toEqual(["true", "false", "null"]);
});
