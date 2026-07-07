// Regression tests for renderNoteBody's wikilink/tag handling — specifically that `[[…]]` and
// `#tag` are resolved in prose but left LITERAL inside code spans/fences (they used to leak the
// injected anchor HTML as visible text inside <code>), and that masking code never corrupts plain
// text like a bare "5 apples".

import { test, expect, describe } from "bun:test";
import { renderNoteBody, renderMarkdown } from "./markdown";

// Inline `$…$` math renders via the shared KaTeX loader. When KaTeX hasn't lazy-loaded yet
// (as in a bun test with no live document) `renderMath` returns "", so `mathHtml` emits a
// `<span class="bismuth-math" data-math="…">` placeholder — either way the span carrying the
// math is present, which is what these assert (vs. the source left literal).
describe("renderMarkdown — inline math", () => {
  test("a single-line `$…$` renders as math (regression)", () => {
    expect(renderMarkdown("$a + b$")).toContain("bismuth-math");
  });

  test("a `$…$` that wraps across lines renders as ONE inline math span", () => {
    // Pre-fix this stayed literal (the single-line regex forbade the newline); now the
    // whole `$a +\n   b$` is one KaTeX span (KaTeX ignores the interior indentation).
    const html = renderMarkdown("$a +\n   b$");
    expect(html).toContain("bismuth-math");
    expect(html).not.toContain("$a");
  });

  test("a lone `$5` price stays literal (no math span)", () => {
    const html = renderMarkdown("I have $5 in my wallet");
    expect(html).not.toContain("bismuth-math");
    expect(html).toContain("$5");
  });

  test("two stray `$` don't merge when the second is preceded by a space", () => {
    const html = renderMarkdown("costs $5 today and $9 tomorrow");
    expect(html).not.toContain("bismuth-math");
  });

  // Regression (ReDoS): a long unclosed `$…` paragraph full of `\`-escapes used to backtrack
  // exponentially in the inline-math tokenizer. The disambiguated alternation is linear, so this
  // renders effectively instantly and leaves the `$` literal (no closing `$` → not math). If the
  // regex regressed, this test would hang rather than fail.
  test("a long unclosed `$` paragraph with escapes renders fast and stays literal", () => {
    const body = "$" + Array.from({ length: 60 }, () => "\\alpha ").join("");
    const start = performance.now();
    const html = renderMarkdown(body);
    expect(performance.now() - start).toBeLessThan(500); // linear, not exponential
    expect(html).not.toContain("bismuth-math");
  });
});

// A lone `<!-- pagebreak -->` becomes a zero-height `<div class="bismuth-page-break">` before
// sanitize (DOMPurify strips comments). The div MUST be isolated by blank lines, else it opens a
// CommonMark type-6 HTML block that swallows following lines as raw HTML (so markdown after the
// marker would stop rendering). It must also stay literal inside a code fence.
describe("renderMarkdown — page break marker", () => {
  test("inserts the page-break div", () => {
    expect(renderMarkdown("a\n<!-- pagebreak -->\nb")).toContain("bismuth-page-break");
  });

  test("does NOT swallow markdown right after the marker (heading + bold still render)", () => {
    const html = renderMarkdown("Page one.\n<!-- pagebreak -->\n# Page Two\nSome **bold** text.");
    expect(html).toMatch(/<h1[ >]/);
    expect(html).toContain("Page Two");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("a `<!-- pagebreak -->` inside a fenced code block stays literal (no div)", () => {
    const html = renderMarkdown("```\n<!-- pagebreak -->\n```");
    expect(html).not.toContain("bismuth-page-break");
    expect(html).toContain("pagebreak");
  });
});

// Every whole-word "bismuth" is wrapped in a `.bismuth-word` span (the iridescent gradient),
// but never inside code / URLs / wikilinks, and never mid-word. `class="bismuth-word"` is used
// as the discriminator so it doesn't collide with `bismuth-wikilink` / `bismuth-tag` classes.
describe("renderMarkdown — iridescent bismuth", () => {
  test("wraps a whole-word 'bismuth' in prose, preserving case", () => {
    expect(renderMarkdown("bismuth is a metal")).toContain('<span class="bismuth-word">bismuth</span>');
    expect(renderMarkdown("Bismuth")).toContain('<span class="bismuth-word">Bismuth</span>');
    expect(renderMarkdown("BISMUTH")).toContain('<span class="bismuth-word">BISMUTH</span>');
  });

  test("wraps every occurrence on a line", () => {
    const html = renderMarkdown("bismuth and more bismuth");
    expect(html.match(/class="bismuth-word"/g)?.length).toBe(2);
  });

  test("does not match a partial word", () => {
    expect(renderMarkdown("bismuths are plural")).not.toContain('class="bismuth-word"');
    expect(renderMarkdown("embismuth")).not.toContain('class="bismuth-word"');
  });

  test("stays literal inside an inline code span", () => {
    const html = renderMarkdown("use `bismuth` here");
    expect(html).not.toContain('class="bismuth-word"');
    expect(html).toContain("<code>bismuth</code>");
  });

  test("stays literal inside a fenced code block", () => {
    expect(renderMarkdown("```\nbismuth\n```")).not.toContain('class="bismuth-word"');
  });

  test("stays literal inside a bare URL", () => {
    const html = renderMarkdown("see https://bismuth.example.com now");
    expect(html).not.toContain('class="bismuth-word"');
    expect(html).toContain("bismuth.example.com");
  });

  test("stays literal inside a wikilink label (renderNoteBody)", () => {
    const html = renderNoteBody("[[bismuth crystals]]");
    expect(html).not.toContain('class="bismuth-word"');
    expect(html).toContain('class="bismuth-wikilink"');
  });
});

describe("renderNoteBody — wikilinks/tags vs code", () => {
  test("a wikilink in prose becomes an anchor", () => {
    const html = renderNoteBody("see [[Another Note]] here");
    expect(html).toContain('class="bismuth-wikilink"');
    expect(html).toContain('data-href="Another Note.md"');
  });

  test("a wikilink inside an INLINE code span stays literal (no anchor)", () => {
    const html = renderNoteBody("use `[[x]]` to link");
    expect(html).not.toContain("bismuth-wikilink");
    expect(html).toContain("<code>");
    // The literal text survives (escaped) inside the code element.
    expect(html).toContain("[[x]]");
  });

  test("a wikilink inside a FENCED code block stays literal", () => {
    const html = renderNoteBody("```\n[[x]]\n```");
    expect(html).not.toContain("bismuth-wikilink");
    expect(html).toContain("[[x]]");
  });

  test("a #tag in prose becomes a styled span, but stays literal in code", () => {
    expect(renderNoteBody("a #book here")).toContain('class="bismuth-tag"');
    expect(renderNoteBody("the `#book` macro")).not.toContain("bismuth-tag");
  });

  test("masking code never corrupts a bare space-delimited number", () => {
    expect(renderNoteBody("I have 5 apples and 12 oranges")).toContain("5 apples and 12 oranges");
  });

  test("mixed: prose wikilink resolves, code wikilink does not, in one string", () => {
    const html = renderNoteBody("[[Real]] vs `[[Fake]]`");
    expect(html).toContain('data-href="Real.md"');
    // Exactly one anchor — the code one is not linkified.
    expect(html.match(/bismuth-wikilink/g)?.length).toBe(1);
  });
});
