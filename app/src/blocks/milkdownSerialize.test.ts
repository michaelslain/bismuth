// app/src/blocks/milkdownSerialize.test.ts
// THE round-trip serialization gate (the #1 risk). For each markdown construct the visual block
// surface handles, we assert: markdown -> Milkdown -> getMarkdown() is BYTE-STABLE and
// IDEMPOTENT. Drift here = save-on-open reformat churn, because the CodeMirror source editor and
// this Milkdown visual editor edit the SAME .md and both normalize on open.
//
// Milkdown mounts a real ProseMirror view, so this test needs a DOM (happy-dom).

import { GlobalWindow } from "happy-dom";
import { test, expect, beforeAll, afterAll } from "bun:test";
import { createBlockEditor, type BlockEditorHandle } from "./milkdownEditor";

// TEST ISOLATION (critical): Bun loads EVERY `bun test app/src` file's modules upfront in ONE
// process, then runs tests (possibly in random order). Several app modules (sanitizeHtml.ts →
// DOMPurify, marked) resolve a DOM-dependent singleton from `globalThis.window` LAZILY at runtime.
// A leaked global DOM flips DOMPurify on and mangles the (intentionally headless) export/markdown
// assertions in other files. So we install the DOM globals ONLY for the lifetime of THIS file's
// tests (in beforeAll, NOT at module top-level — that would pollute the whole collection phase)
// and DELETE exactly what we added (afterAll). Our imports (milkdownEditor → inlineNodes →
// htmlEscape) touch neither sanitizeHtml nor marked, and the factory only reaches for `document`
// at create()-time (inside beforeAll), so the teardown fully restores the headless environment.
const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "Event", "CustomEvent", "InputEvent", "KeyboardEvent", "MouseEvent",
  "DOMParser", "XMLSerializer", "getComputedStyle", "MutationObserver", "Range", "NodeFilter",
  "HTMLDivElement", "HTMLSpanElement", "DOMRect",
];
const installed: string[] = [];

// One shared surface for every case (cheap reuse — Editor.create() is the slow part).
let handle: BlockEditorHandle;

beforeAll(async () => {
  const win = new GlobalWindow();
  for (const key of DOM_GLOBALS) {
    if (!(key in globalThis) && key in win) {
      (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
      installed.push(key);
    }
  }
  if (!("window" in globalThis)) {
    (globalThis as Record<string, unknown>).window = win;
    installed.push("window");
  }
  const root = document.createElement("div");
  document.body.appendChild(root);
  handle = await createBlockEditor({
    root,
    value: "",
    onChange: () => {},
    onEnter: () => {},
    onBackspaceAtStart: () => {},
    onArrowOut: () => {},
  });
});

afterAll(() => {
  handle?.destroy();
  // Restore the headless environment so the rest of the (DOM-free) app suite isn't affected.
  for (const key of installed) delete (globalThis as Record<string, unknown>)[key];
});

/** Seed the surface with `md`, then read it back. */
function roundTrip(md: string): string {
  handle.setMarkdown(md);
  return handle.getMarkdown();
}

/** Assert byte-stable AND idempotent: md -> out === md, and out -> out2 === out. */
function expectStable(md: string): void {
  const out = roundTrip(md);
  expect(out).toBe(md);
  const out2 = roundTrip(out);
  expect(out2).toBe(out);
}

/** Assert a DOCUMENTED canonical normalization: `md` serializes to `canonical` (NOT byte-stable),
 *  but `canonical` is then a fixed point (idempotent). For the accepted lossy cases — the
 *  emphasis-marker normalization (`_`→`*`, `__`→`**`) and source-backslash / HTML-entity decode —
 *  where the doc model can't preserve the exact source bytes but the result is stable thereafter. */
function expectNormalizes(md: string, canonical: string): void {
  expect(roundTrip(md)).toBe(canonical);
  expect(roundTrip(canonical)).toBe(canonical); // the canonical form is a fixed point
}

// --- Inline content (what a text block's `text` field holds) ----------------------------
// The per-block surface serializes INLINE markdown only — block prefixes (#, -, >, - [ ]) are
// owned by the block model. So the constructs under test are the inline ones.

test("plain text", () => expectStable("just some words"));

test("bold (strong) uses ** asterisks", () => expectStable("this is **bold** text"));

test("italic (emphasis) uses * asterisk", () => expectStable("this is *italic* text"));

test("bold + italic combined", () => expectStable("**bold** and *italic* together"));

test("inline code span", () => expectStable("call `foo.bar()` now"));

test("markdown link", () => expectStable("see [the docs](https://example.com/path) here"));

test("link with title-less url only", () => expectStable("[home](https://x.io)"));

// --- Custom inline atoms (the Obsidian flavour — verbatim html-emit) --------------------

test("wikilink — bare", () => expectStable("see [[Another Note]] for details"));

test("wikilink — with alias", () => expectStable("see [[Another Note|the alias]] here"));

test("wikilink — with section", () => expectStable("jump to [[Note#Section]] please"));

test("wikilink — section + alias", () => expectStable("[[target#heading|alias]]"));

test("wikilink — folder path target", () => expectStable("ref [[reading/My Note|My Note]]"));

test("two wikilinks in one block", () => expectStable("[[A]] and then [[b/c|d]] end"));

test("hashtag — simple", () => expectStable("tagged #project here"));

test("hashtag — nested path", () => expectStable("deep #area/sub/leaf tag"));

test("hashtag — hyphen", () => expectStable("a #multi-word-tag here"));

test("inline math", () => expectStable("the formula $x^2 + y^2 = z^2$ holds"));

test("inline math — single symbol", () => expectStable("let $a$ be a constant"));

test("embed — wikilink transclusion", () => expectStable("![[Some Note]]"));

test("embed — image wikilink", () => expectStable("![[diagram.png]]"));

test("embed — markdown image url", () => expectStable("![alt text](https://cdn.example.com/i.png)"));

test("bare url", () => expectStable("visit https://example.com/a/b now"));

test("bare url — with query + fragment", () => expectStable("https://x.io/p?q=1&r=2#frag"));

// --- Mixed / adjacency ------------------------------------------------------------------

test("mix: bold + wikilink + tag", () => expectStable("**bold** see [[Note]] and #tag"));

test("mix: math + url + wikilink", () => expectStable("$a$ at https://y.io and [[Z]]"));

test("text around a wikilink does not over-escape brackets", () => {
  // The chip is verbatim; the surrounding plain text is plain.
  expectStable("before [[Note]] after");
});

// --- Adversarial: NO over-escaping (the #1 churn risk) ----------------------------------
// mdast-util-to-markdown defensively escapes inline punctuation (`snake_case` → `snake\_case`,
// `array[0]` → `array\[0]`, a literal `*` → `\*`, `R&D` → `R\&D`). That is valid markdown but
// DIVERGES byte-for-byte from what the verbatim block model + CodeMirror Editor store, so it
// would rewrite the .md on first visual edit and ping-pong the two surfaces. The verbatim `text`
// handler (milkdownEditor.ts) must leave plain prose untouched.

test("snake_case word — underscores inside a word are not escaped", () =>
  expectStable("the snake_case_word here"));

test("multiple underscored identifiers", () =>
  expectStable("call get_user_name and set_user_id now"));

test("array index brackets are not escaped", () => expectStable("read array[0] then array[1]"));

test("a lone literal asterisk is not escaped", () => expectStable("multiply a * b please"));

test("a lone literal underscore is not escaped", () => expectStable("a _ b spaced underscore"));

test("ampersand in prose is not escaped", () => expectStable("R&D and Q&A teams"));

test("angle-bracket comparisons are not escaped", () => expectStable("if x < y and y > z then"));

test("parentheses + percent + dots stay literal", () => expectStable("foo.bar() is 100% fine"));

test("loose brackets without a link target stay literal", () =>
  expectStable("a [bracketed] phrase here"));

test("autolink <url> round-trips as an autolink (not [url](url))", () =>
  expectStable("see <https://example.com/x> here"));

test("autolink does not break a real labelled link", () =>
  expectStable("[the docs](https://example.com/path)"));

test("mix: snake_case + bold + wikilink + tag + math + autolink (the full adversarial line)", () =>
  expectStable("set my_var **bold** [[Note]] #tag $x^2$ at <https://z.io> end"));

// --- Documented canonical normalizations (NOT byte-stable, but a fixed point thereafter) ----
// These are the ACCEPTED lossy cases: the doc model loses the exact source bytes, but the
// canonical output is stable on every subsequent round-trip (no churn after the first save).

test("emphasis marker normalizes _italic_ → *italic*", () =>
  expectNormalizes("this is _italic_ text", "this is *italic* text"));

test("strong marker normalizes __bold__ → **bold**", () =>
  expectNormalizes("this is __bold__ text", "this is **bold** text"));

test("a source backslash-escape inside prose decodes to the bare char", () =>
  // `\*` → `*` (the parser consumes the backslash; a lone `*` re-parses as itself).
  expectNormalizes("a literal \\* star", "a literal * star"));

test("an HTML entity decodes to its character", () =>
  // `&amp;` decodes to `&` at parse time and can't be recovered (doc-model limitation).
  expectNormalizes("a&amp;b", "a&b"));

// --- Idempotency under re-seed (the SSE-reload path) ------------------------------------

test("re-seeding the same content is a stable no-op", () => {
  const md = "**bold** [[Note]] #tag $x$ https://z.io";
  expect(roundTrip(md)).toBe(md);
  expect(roundTrip(md)).toBe(md); // second seed: still identical
  expect(roundTrip(md)).toBe(md); // third seed: still identical
});

// --- Empty / whitespace -----------------------------------------------------------------

test("empty content round-trips to empty", () => {
  expect(roundTrip("")).toBe("");
});

// --- Enter-split caret offset (issue #2) ------------------------------------------------
// onEnter must report the caret as a MARKDOWN-text offset (the index BlockEditor.splitBlock
// slices `block.text` at), NOT a raw ProseMirror position. A custom inline ATOM
// (`[[wikilink]]`/`#tag`/`$math$`) is ONE PM unit but MANY markdown chars, so a raw position
// would mis-split a block containing any atom. We place the caret at a known markdown offset
// (handle.focus(n) maps the offset back to the PM position — the inverse mapping) then fire
// Enter and assert the reported offset equals the markdown offset we placed it at.

/** Create a throwaway surface seeded with `value`, place the caret at markdown offset `caret`,
 *  dispatch a plain Enter, and return the offset reported to onEnter. */
async function enterSplitOffset(value: string, caret: number): Promise<number> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let reported = -1;
  const h = await createBlockEditor({
    root,
    value,
    onChange: () => {},
    onEnter: (c) => {
      reported = c;
    },
    onBackspaceAtStart: () => {},
    onArrowOut: () => {},
  });
  h.focus(caret);
  // ProseMirror's keymap is wired to the contenteditable's keydown; a synthetic Enter reaches it.
  const pm = (root.querySelector(".ProseMirror") ?? root.firstElementChild) as HTMLElement | null;
  pm?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  h.destroy();
  root.remove();
  return reported;
}

test("enter-split: plain text reports the char offset", async () => {
  expect(await enterSplitOffset("hello world", 5)).toBe(5);
});

test("enter-split: caret right after a [[wikilink]] atom reports the FULL atom length", async () => {
  // The atom is 1 PM unit but 8 markdown chars; a raw PM position would report 1, mis-splitting.
  expect(await enterSplitOffset("[[Note]]X", 8)).toBe(8);
});

test("enter-split: caret between text + a wikilink atom + more text", async () => {
  expect(await enterSplitOffset("ab[[Note]]cd", 10)).toBe(10); // after `ab[[Note]]`
  expect(await enterSplitOffset("ab[[Note]]cd", 2)).toBe(2); //  after `ab`, before the atom
});

test("enter-split: caret right after an aliased [[wikilink]] in surrounding prose", async () => {
  // The prompt's scenario: "before [[Some Note|alias]] after" with the caret right after the
  // wikilink. The atom is 1 PM unit but `[[Some Note|alias]]` = 19 markdown chars; "before " = 7,
  // so the markdown offset just past the atom is 26 — NOT a small PM position.
  expect(await enterSplitOffset("before [[Some Note|alias]] after", 26)).toBe(26);
});

test("enter-split: caret after a #tag atom", async () => {
  expect(await enterSplitOffset("x #tag y", 6)).toBe(6); // after `x #tag`
});

test("enter-split: caret after an inline $math$ atom", async () => {
  expect(await enterSplitOffset("$a$b", 3)).toBe(3); // after `$a$`
});

test("enter-split: caret at the very start reports 0", async () => {
  expect(await enterSplitOffset("[[Note]]X", 0)).toBe(0);
});
