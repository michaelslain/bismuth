// Regression tests for renderNoteBody's wikilink/tag handling — specifically that `[[…]]` and
// `#tag` are resolved in prose but left LITERAL inside code spans/fences (they used to leak the
// injected anchor HTML as visible text inside <code>), and that masking code never corrupts plain
// text like a bare "5 apples".

import { test, expect, describe } from "bun:test";
import { renderNoteBody } from "./markdown";

describe("renderNoteBody — wikilinks/tags vs code", () => {
  test("a wikilink in prose becomes an anchor", () => {
    const html = renderNoteBody("see [[Another Note]] here");
    expect(html).toContain('class="oa-wikilink"');
    expect(html).toContain('data-href="Another Note.md"');
  });

  test("a wikilink inside an INLINE code span stays literal (no anchor)", () => {
    const html = renderNoteBody("use `[[x]]` to link");
    expect(html).not.toContain("oa-wikilink");
    expect(html).toContain("<code>");
    // The literal text survives (escaped) inside the code element.
    expect(html).toContain("[[x]]");
  });

  test("a wikilink inside a FENCED code block stays literal", () => {
    const html = renderNoteBody("```\n[[x]]\n```");
    expect(html).not.toContain("oa-wikilink");
    expect(html).toContain("[[x]]");
  });

  test("a #tag in prose becomes a styled span, but stays literal in code", () => {
    expect(renderNoteBody("a #book here")).toContain('class="oa-tag"');
    expect(renderNoteBody("the `#book` macro")).not.toContain("oa-tag");
  });

  test("masking code never corrupts a bare space-delimited number", () => {
    expect(renderNoteBody("I have 5 apples and 12 oranges")).toContain("5 apples and 12 oranges");
  });

  test("mixed: prose wikilink resolves, code wikilink does not, in one string", () => {
    const html = renderNoteBody("[[Real]] vs `[[Fake]]`");
    expect(html).toContain('data-href="Real.md"');
    // Exactly one anchor — the code one is not linkified.
    expect(html.match(/oa-wikilink/g)?.length).toBe(1);
  });
});
