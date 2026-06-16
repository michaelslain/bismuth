import { test, expect } from "bun:test";
import { tokenizeLatex } from "./latexHighlight";

const types = (src: string) => tokenizeLatex(src).map((t) => `${t.cls.replace("cm-tex-", "")}:${src.slice(t.from, t.to)}`);

test("multi-letter control sequence", () => {
  expect(types("\\frac{a}{b}")).toEqual([
    "command:\\frac", "bracket:{", "bracket:}", "bracket:{", "bracket:}",
  ]);
});

test("escaped single char is one command token", () => {
  expect(types("a \\% b \\\\")).toEqual(["command:\\%", "command:\\\\"]);
});

test("sub/superscript markers + numbers", () => {
  expect(types("x^2_i 10")).toEqual(["script:^", "number:2", "script:_", "number:10"]);
});

test("decimal number keeps interior dot, drops trailing dot", () => {
  expect(types("3.14 end.")).toEqual(["number:3.14"]);
});

test("% starts a comment to end of line", () => {
  expect(types("a % tail\nb")).toEqual(["comment:% tail"]);
});

test("optional-arg brackets are bracket tokens", () => {
  expect(types("\\sqrt[3]{x}")).toEqual([
    "command:\\sqrt", "bracket:[", "number:3", "bracket:]", "bracket:{", "bracket:}",
  ]);
});

test("plain letters/operators produce no tokens", () => {
  expect(tokenizeLatex("a + b = c")).toEqual([]);
});

test("offsets are correct relative to src", () => {
  const toks = tokenizeLatex("ab\\frac");
  expect(toks).toEqual([{ from: 2, to: 7, cls: "cm-tex-command" }]);
});
