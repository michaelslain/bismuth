// app/src/editor/inlineMarkdown.test.ts
import { test, expect } from "bun:test";
import { tokenizeInline, renderInlineMarkdown, iridescentBismuthCell } from "./inlineMarkdown";

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

// --- iridescent "bismuth" inside a table cell (#9) ------------------------------------
// A cell's inline markdown must pick up the same iridescent gradient span as prose /
// reading-mode surfaces, wrapping whole-word "bismuth" but never inside code / links /
// URLs / raw HTML / #tags (wikilinks + $math$ are separate segments, so never in an md run).

test("iridescentBismuthCell wraps a whole-word bismuth, preserving casing", () => {
  expect(iridescentBismuthCell("I love Bismuth crystals")).toBe(
    'I love <span class="bismuth-word">Bismuth</span> crystals',
  );
});

test("iridescentBismuthCell leaves text with no whole-word bismuth untouched", () => {
  expect(iridescentBismuthCell("bismuths and embismuth")).toBe("bismuths and embismuth");
  expect(iridescentBismuthCell("plain cell text")).toBe("plain cell text");
});

test("iridescentBismuthCell skips bismuth inside a code span", () => {
  expect(iridescentBismuthCell("run `bismuth serve` now")).toBe("run `bismuth serve` now");
});

test("iridescentBismuthCell skips bismuth inside a markdown link + bare URL", () => {
  expect(iridescentBismuthCell("[bismuth](https://bismuth.io)")).toBe("[bismuth](https://bismuth.io)");
  expect(iridescentBismuthCell("see https://x/bismuth here")).toBe("see https://x/bismuth here");
});

test("iridescentBismuthCell skips bismuth inside a #tag", () => {
  expect(iridescentBismuthCell("tagged #bismuth today")).toBe("tagged #bismuth today");
});

test("iridescentBismuthCell wraps prose bismuth while masking a protected copy", () => {
  // The bare word is wrapped; the copy inside the code span is left literal.
  expect(iridescentBismuthCell("bismuth vs `bismuth`")).toBe(
    '<span class="bismuth-word">bismuth</span> vs `bismuth`',
  );
});

test("iridescentBismuthCell does not corrupt numbers or stray punctuation around a mask", () => {
  // Restoration must not eat a bare number that happens to sit near a masked region.
  expect(iridescentBismuthCell("costs 5 for `bismuth`")).toBe("costs 5 for `bismuth`");
});

test("renderInlineMarkdown renders bismuth in a cell as the shared gradient span", () => {
  expect(renderInlineMarkdown("love bismuth")).toBe('love <span class="bismuth-word">bismuth</span>');
});

test("renderInlineMarkdown keeps bismuth in a cell code span plain", () => {
  expect(renderInlineMarkdown("`bismuth`")).toBe("<code>bismuth</code>");
});

// --- lists inside table cells (#15) ---------------------------------------------------
// A `<br>`-separated run of `- `/`1. ` markers renders as a real <ul>/<ol> (cellList.ts
// convention). Regression guard that the editor's cell-render path (renderDisplay →
// renderInlineMarkdown) actually produces the list markup.

test("renderInlineMarkdown renders a <br>-separated bullet cell as a <ul> with content markers", () => {
  const html = renderInlineMarkdown("- a<br>- b<br>- c");
  expect(html.startsWith('<ul class="bismuth-cell-list"')).toBe(true);
  expect((html.match(/•<\/span>/g) ?? []).length).toBe(3); // one bullet glyph per item
  expect(html).toContain('<span class="bismuth-cell-it">a</span>');
});

test("renderInlineMarkdown renders a <br>-separated numbered cell as an <ol> with content markers", () => {
  const html = renderInlineMarkdown("1. one<br>2. two");
  expect(html.startsWith('<ol class="bismuth-cell-list"')).toBe(true);
  expect(html).toContain(">1.</span>");
  expect(html).toContain(">2.</span>");
});

test("renderInlineMarkdown keeps a plain <br>-separated cell as inline lines (no list)", () => {
  expect(renderInlineMarkdown("a<br>b")).toBe("a<br>b");
});

test("renderInlineMarkdown renders inline markdown + bismuth inside a cell list item", () => {
  const html = renderInlineMarkdown("- **bold** bismuth<br>- b");
  expect(html).toContain(
    '<span class="bismuth-cell-it"><strong>bold</strong> <span class="bismuth-word">bismuth</span></span>',
  );
});

// --- image / pdf embeds inside table cells (#30) --------------------------------------
// An `![[img.png]]` / `![](url)` in a cell must render as REAL media (pulled from GET /asset via
// the injected assetUrl), not a `!` + wikilink chip (the bug) or a broken relative <img>.

const asset = (t: string): string => "/asset?path=" + encodeURIComponent(t);

test("tokenizeInline detects a wiki image embed (before the [[wikilink]] rule)", () => {
  expect(tokenizeInline("see ![[cat.png]] ok")).toEqual([
    { type: "md", raw: "see " },
    { type: "embed", wiki: true, target: "cat.png", alt: null },
    { type: "md", raw: " ok" },
  ]);
});

test("tokenizeInline detects a markdown image embed but leaves a plain link alone", () => {
  expect(tokenizeInline("![alt](cat.png)")).toEqual([{ type: "embed", wiki: false, target: "cat.png", alt: "alt" }]);
  // A bare `[text](url)` link is NOT an embed (no `!`) — stays an md run for `marked`.
  expect(tokenizeInline("[text](https://e.com)")).toEqual([{ type: "md", raw: "[text](https://e.com)" }]);
});

test("tokenizeInline keeps a bare [[wikilink]] separate from an embed", () => {
  expect(tokenizeInline("![[img.png]] vs [[Note]]")).toEqual([
    { type: "embed", wiki: true, target: "img.png", alt: null },
    { type: "md", raw: " vs " },
    { type: "wikilink", target: "Note", alias: null },
  ]);
});

test("renderInlineMarkdown renders a wiki image embed as an <img> off the asset URL", () => {
  const html = renderInlineMarkdown("![[cat.png]]", { assetUrl: asset });
  expect(html).toContain('<img');
  expect(html).toContain('src="/asset?path=cat.png"');
  expect(html).toContain("max-width:100%");
  expect(html).not.toContain("cm-wikilink"); // NOT a link chip (the #30 bug)
});

test("renderInlineMarkdown renders a markdown image via the asset URL (not a relative src)", () => {
  const html = renderInlineMarkdown("![a](pic.png)", { assetUrl: asset });
  expect(html).toContain('src="/asset?path=pic.png"');
});

test("renderInlineMarkdown renders a pdf embed as an iframe off the asset URL", () => {
  const html = renderInlineMarkdown("![[doc.pdf#page=2]]", { assetUrl: asset });
  expect(html).toContain("<iframe");
  expect(html).toContain("/asset?path=doc.pdf");
  expect(html).toContain("page=2");
});

test("renderInlineMarkdown falls back to a clickable chip for a plain note embed", () => {
  // `![[Some Note]]` has no media extension → a wikilink chip (openable via #33), not a broken box.
  const html = renderInlineMarkdown("![[Some Note]]", { assetUrl: asset });
  expect(html).toContain('class="cm-wikilink"');
  expect(html).toContain('data-wikilink="Some Note"');
});
