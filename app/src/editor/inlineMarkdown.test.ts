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

// --- #tags inside a cell (#41) --------------------------------------------------------
// A `#tag` typed in a cell must render + read like a tag in normal note text (the `.cm-tag`
// mark), NOT as literal `#tag` text. Detection mirrors the vault's tag rules (start-of-cell or
// after whitespace, and the tag must start with a LETTER), so `#123`, `# heading`, `C#`, a URL
// fragment `x#y` never false-match.

test("tokenizeInline splits a #tag into its own segment", () => {
  expect(tokenizeInline("meeting #work notes")).toEqual([
    { type: "md", raw: "meeting " },
    { type: "tag", name: "work" },
    { type: "md", raw: " notes" },
  ]);
});

test("tokenizeInline supports nested + hyphenated tags", () => {
  expect(tokenizeInline("#area/health-log")).toEqual([{ type: "tag", name: "area/health-log" }]);
});

test("renderInlineMarkdown renders a #tag as the themed .cm-tag chip", () => {
  expect(renderInlineMarkdown("a #work b")).toBe('a <span class="cm-tag" data-tag="work">#work</span> b');
});

test("renderInlineMarkdown does NOT treat non-tags as tags (false-positive guard)", () => {
  // Pure-number, mid-word `#`, heading, and a URL fragment must all stay literal.
  expect(renderInlineMarkdown("#123")).toBe("#123"); // starts with a digit → not a tag
  expect(renderInlineMarkdown("C# rocks")).toBe("C# rocks"); // mid-word # (no whitespace before)
  expect(renderInlineMarkdown("# heading")).toBe("# heading"); // space after # → heading, not a tag
  expect(renderInlineMarkdown("see a#b")).toBe("see a#b"); // # not at a word boundary
});

test("renderInlineMarkdown renders a tag at the very start of a cell", () => {
  expect(renderInlineMarkdown("#todo item")).toBe('<span class="cm-tag" data-tag="todo">#todo</span> item');
});

test("renderInlineMarkdown keeps a #tag out of a wikilink / code span", () => {
  // A `#` inside a wikilink is a heading anchor (consumed by the wikilink), not a tag.
  expect(renderInlineMarkdown("[[Note#section]]")).toBe(
    '<span class="cm-wikilink" data-wikilink="Note#section">Note#section</span>',
  );
  // A `#word` inside a code span stays literal code (no tag chip).
  expect(renderInlineMarkdown("`#work`")).toBe("<code>#work</code>");
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

// --- #58: emphasis SPANNING math/wikilinks styles correctly (the cell twin of the
// note-body fix in inlineEmphasis.ts). tokenizeInline splits md runs at math/wikilink
// boundaries, so `**Case 1: $hk \in H$.**` used to reach marked as two non-closing runs
// and render literal `**`. Reference semantics: only the DELIMITER runs must avoid math
// spans; emphasis chars INSIDE $...$ stay literal LaTeX. Same four shapes as the #58 tests.

test("#58 bold containing inline math renders <strong> with the math span inside, no literal **", () => {
  const html = renderInlineMarkdown("**Case 1: $hk \\in H$.**");
  expect(html).toContain("<strong>");
  expect(html).toContain("</strong>");
  expect(html).toContain('class="cm-inline-math"');
  expect(html).toContain('data-math="hk \\in H"');
  expect(html).not.toContain("**"); // markers consumed, not shown
  // The prose inside the bold survives around the math span.
  expect(html).toContain("Case 1: ");
});

test("#58 italic containing inline math renders <em> with the math span inside", () => {
  const html = renderInlineMarkdown("*note $x+y$ here*");
  expect(html).toContain("<em>");
  expect(html).toContain("</em>");
  expect(html).toContain('data-math="x+y"');
  expect(html).not.toMatch(/\*(?!\*)/); // no stray single asterisks in the output
});

test("#58 bold-italic containing inline math renders <em><strong> like plain ***bi***", () => {
  const html = renderInlineMarkdown("***bi $x$ bi***");
  expect(html).toContain("<em><strong>");
  expect(html).toContain("</strong></em>");
  expect(html).toContain('data-math="x"');
  expect(html).not.toContain("*"); // all six markers consumed
});

test("#58 math CONTAINING asterisks stays one literal math span (no <em> injected)", () => {
  const html = renderInlineMarkdown("$a * b * c$");
  expect(html).toContain('data-math="a * b * c"'); // asterisks preserved inside the LaTeX
  expect(html).not.toContain("<em>");
  expect(html).not.toContain("<strong>");
});

test("#58 a token whose CLOSING delimiter sits inside math is left alone (LaTeX protected)", () => {
  // The candidate bold's closer lands inside `$b** c$` -> skipped; the math span wins whole.
  const html = renderInlineMarkdown("x **a $b** c$");
  expect(html).not.toContain("<strong>");
  expect(html).toContain('data-math="b** c"');
});

test("#58 strike + underscore-bold spanning math also style", () => {
  const strike = renderInlineMarkdown("~~old $x$ result~~");
  expect(strike).toContain("<del>");
  expect(strike).toContain('data-math="x"');
  const bold = renderInlineMarkdown("__b $x$ b__");
  expect(bold).toContain("<strong>");
  expect(bold).toContain('data-math="x"');
});

test("#58 bold spanning a WIKILINK styles too (same splitting class as math)", () => {
  const html = renderInlineMarkdown("**see [[Note]] now**");
  expect(html).toContain("<strong>");
  expect(html).toContain('class="cm-wikilink"');
  expect(html).toContain('data-wikilink="Note"');
  expect(html).not.toContain("**");
});

test("#58 control: plain emphasis (no spanned segment) still renders via marked, unchanged", () => {
  expect(renderInlineMarkdown("**bold**")).toContain("<strong>bold</strong>");
  expect(renderInlineMarkdown("*it*")).toContain("<em>it</em>");
  expect(renderInlineMarkdown("***bi***")).toContain("<em><strong>bi</strong></em>");
  // And emphasis in prose AROUND (not spanning) math keeps working via the plain path.
  const html = renderInlineMarkdown("**bold** then $x$");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain('data-math="x"');
});
