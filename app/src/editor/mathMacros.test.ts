import { describe, expect, test } from "bun:test";
import { parseMathMacros } from "./mathMacros";

describe("parseMathMacros", () => {
  test("empty / whitespace → no macros", () => {
    expect(parseMathMacros("")).toEqual({});
    expect(parseMathMacros("   \n  ")).toEqual({});
  });

  test("\\newcommand with braced name, no args", () => {
    expect(parseMathMacros("\\newcommand{\\R}{\\mathbb{R}}")).toEqual({ "\\R": "\\mathbb{R}" });
  });

  test("\\newcommand with bare name (no braces)", () => {
    expect(parseMathMacros("\\newcommand\\Z{\\mathbb{Z}}")).toEqual({ "\\Z": "\\mathbb{Z}" });
  });

  test("\\newcommand with [argc] — count dropped, body kept (KaTeX infers from #n)", () => {
    expect(parseMathMacros("\\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}")).toEqual({
      "\\norm": "\\left\\lVert #1 \\right\\rVert",
    });
  });

  test("multiple definitions across whitespace + newlines", () => {
    const src = "\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\norm}[1]{\\lVert #1 \\rVert}";
    expect(parseMathMacros(src)).toEqual({
      "\\R": "\\mathbb{R}",
      "\\norm": "\\lVert #1 \\rVert",
    });
  });

  test("nested + escaped braces in body are balanced correctly", () => {
    expect(parseMathMacros("\\newcommand{\\set}[1]{\\{ #1 \\}}")).toEqual({ "\\set": "\\{ #1 \\}" });
    expect(parseMathMacros("\\newcommand{\\f}{\\frac{a}{\\frac{b}{c}}}")).toEqual({
      "\\f": "\\frac{a}{\\frac{b}{c}}",
    });
  });

  test("\\renewcommand and \\providecommand are treated as definitions", () => {
    expect(parseMathMacros("\\renewcommand{\\vec}[1]{\\mathbf{#1}}")).toEqual({ "\\vec": "\\mathbf{#1}" });
    expect(parseMathMacros("\\providecommand{\\e}{\\mathrm{e}}")).toEqual({ "\\e": "\\mathrm{e}" });
  });

  test("\\def with and without param text", () => {
    expect(parseMathMacros("\\def\\R{\\mathbb{R}}")).toEqual({ "\\R": "\\mathbb{R}" });
    expect(parseMathMacros("\\def\\ip#1#2{\\langle #1, #2 \\rangle}")).toEqual({
      "\\ip": "\\langle #1, #2 \\rangle",
    });
  });

  test("a def missing its body is skipped, later valid ones still parse", () => {
    // `\bad` has no body group → skipped; `\good` still lands.
    const src = "\\newcommand{\\bad} \\newcommand{\\good}{\\alpha}";
    expect(parseMathMacros(src)).toEqual({ "\\good": "\\alpha" });
  });

  test("an unbalanced brace consumes the rest (doesn't crash)", () => {
    // A genuinely unclosed `{` is ambiguous — it greedily eats to end and yields nothing,
    // but must not throw or loop forever.
    expect(parseMathMacros("\\newcommand{\\x}{\\frac{a}{b}")).toEqual({});
  });

  test("non-definition text between defs is ignored", () => {
    const src = "some prose \\newcommand{\\R}{\\mathbb{R}} more $x$ words \\def\\Z{\\mathbb{Z}}";
    expect(parseMathMacros(src)).toEqual({ "\\R": "\\mathbb{R}", "\\Z": "\\mathbb{Z}" });
  });

  test("two-arg \\newcommand", () => {
    expect(parseMathMacros("\\newcommand{\\ip}[2]{\\langle #1, #2 \\rangle}")).toEqual({
      "\\ip": "\\langle #1, #2 \\rangle",
    });
  });

  test("rejects invalid braced macro names (digits / multi-char symbols), keeps valid", () => {
    expect(parseMathMacros("\\newcommand{\\1st}{x}")).toEqual({}); // control word must be letters
    expect(parseMathMacros("\\newcommand{\\123}{y}")).toEqual({});
    expect(parseMathMacros("\\newcommand{\\(}{x}")).toEqual({ "\\(": "x" }); // single symbol is valid
    expect(parseMathMacros("\\newcommand{\\R}{\\mathbb{R}}")).toEqual({ "\\R": "\\mathbb{R}" });
  });
});

  test("\\def with space before body brace and content before actual body", () => {
    // Edge case: `\def\x #1 { stuff {nested} } {body}`
    // The first `{` is at position where `{ stuff {nested} }` is, but this is valid TeX
    // The body should be `{ stuff {nested} }` since that's the balance-group after param-text
    const result = parseMathMacros("\\def\\x #1 { stuff {nested} } {body}");
    // Actually, this is ambiguous TeX - the {body} is extra.
    // What the parser does is correct: it reads the first balance group after param-text
    expect(result["\\x"]).toBe(" stuff {nested} ");
  });
