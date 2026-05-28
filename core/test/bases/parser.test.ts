import { test, expect } from "bun:test";
import { parseExpr } from "../../src/bases/parser";

test("parses a method call on a member", () => {
  const ast = parseExpr('file.hasTag("book")');
  expect(ast).toEqual({
    type: "call",
    callee: { type: "member", object: { type: "ident", name: "file" }, name: "hasTag" },
    args: [{ type: "str", value: "book" }],
  });
});

test("respects arithmetic precedence", () => {
  const ast = parseExpr("1 + 2 * 3");
  expect(ast).toMatchObject({
    type: "binary", op: "+",
    left: { type: "num", value: 1 },
    right: { type: "binary", op: "*" },
  });
});

test("respects boolean over comparison precedence", () => {
  const ast = parseExpr("a > 1 && b < 2");
  expect(ast).toMatchObject({ type: "binary", op: "&&" });
});

test("parses parenthesized grouping", () => {
  const ast = parseExpr("(1 + 2) * 3");
  expect(ast).toMatchObject({ type: "binary", op: "*", left: { type: "binary", op: "+" } });
});

test("parses unary not and negative", () => {
  expect(parseExpr("!done")).toMatchObject({ type: "unary", op: "!" });
  expect(parseExpr("-x")).toMatchObject({ type: "unary", op: "-" });
});

test("parses index access", () => {
  expect(parseExpr("tags[0]")).toMatchObject({ type: "index", index: { type: "num", value: 0 } });
});

test("parses chained member + call", () => {
  const ast = parseExpr("price.toFixed(2)");
  expect(ast).toMatchObject({
    type: "call",
    callee: { type: "member", name: "toFixed" },
    args: [{ type: "num", value: 2 }],
  });
});
