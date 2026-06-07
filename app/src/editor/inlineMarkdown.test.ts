// app/src/editor/inlineMarkdown.test.ts
import { test, expect } from "bun:test";
import { tokenizeInline, renderInlineMarkdown } from "./inlineMarkdown";

// --- tokenizeInline: splitting wikilinks + math out of the markdown runs -------------

test("tokenizeInline keeps plain markdown as a single md segment", () => {
  expect(tokenizeInline("**bold** and `code`")).toEqual([{ type: "md", raw: "**bold** and `code`" }]);
});

test("tokenizeInline pulls out a bare wikilink", () => {
  expect(tokenizeInline("see [[Another Note]] now")).toEqual([
    { type: "md", raw: "see " },
    { type: "wikilink", target: "Another Note", alias: null },
    { type: "md", raw: " now" },
  ]);
});

test("tokenizeInline splits a wikilink alias on the pipe", () => {
  expect(tokenizeInline("[[target|shown]]")).toEqual([{ type: "wikilink", target: "target", alias: "shown" }]);
});

test("tokenizeInline pulls out inline math, leaving surrounding text", () => {
  expect(tokenizeInline("Compute $a^N \\bmod m$, then go")).toEqual([
    { type: "md", raw: "Compute " },
    { type: "math", expr: "a^N \\bmod m" },
    { type: "md", raw: ", then go" },
  ]);
});

test("tokenizeInline does NOT treat currency-ish $ as math", () => {
  // No closing $ with non-space before it → stays literal text.
  expect(tokenizeInline("costs $5 today")).toEqual([{ type: "md", raw: "costs $5 today" }]);
  // Space just inside the opener disqualifies it.
  expect(tokenizeInline("a $ x $ b")).toEqual([{ type: "md", raw: "a $ x $ b" }]);
});

test("tokenizeInline ignores $$ (display math is handled elsewhere)", () => {
  expect(tokenizeInline("$$x$$")).toEqual([{ type: "md", raw: "$$x$$" }]);
});

test("tokenizeInline leaves an unterminated [[ as plain text", () => {
  expect(tokenizeInline("a [[ b")).toEqual([{ type: "md", raw: "a [[ b" }]);
});

// --- renderInlineMarkdown: HTML output for the non-math marks -------------------------

test("renderInlineMarkdown renders bold / italic / bold-italic", () => {
  expect(renderInlineMarkdown("**b**")).toBe("<strong>b</strong>");
  expect(renderInlineMarkdown("*i*")).toBe("<em>i</em>");
  expect(renderInlineMarkdown("***bi***")).toBe("<em><strong>bi</strong></em>");
});

test("renderInlineMarkdown renders inline code and strikethrough", () => {
  expect(renderInlineMarkdown("`x`")).toBe("<code>x</code>");
  expect(renderInlineMarkdown("~~y~~")).toBe("<del>y</del>");
});

test("renderInlineMarkdown renders a markdown link", () => {
  expect(renderInlineMarkdown("[txt](https://e.com)")).toBe('<a href="https://e.com">txt</a>');
});

test("renderInlineMarkdown renders a wikilink as a themed span (alias shown)", () => {
  expect(renderInlineMarkdown("[[Note|Alias]]")).toBe(
    '<span class="cm-wikilink" data-wikilink="Note">Alias</span>',
  );
});

test("renderInlineMarkdown HTML-escapes wikilink display text + target", () => {
  expect(renderInlineMarkdown("[[a<b|x&y]]")).toBe(
    '<span class="cm-wikilink" data-wikilink="a&lt;b">x&amp;y</span>',
  );
});

test("renderInlineMarkdown mixes a code span with a wikilink", () => {
  expect(renderInlineMarkdown("`lnames` see [[Drugs]]")).toBe(
    '<code>lnames</code> see <span class="cm-wikilink" data-wikilink="Drugs">Drugs</span>',
  );
});
