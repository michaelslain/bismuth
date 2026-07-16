// app/src/editor/blockRegions.test.ts
//
// Bug #10 (3rd bounce): a frontmatter panel / fenced code block must render as a rounded-corner
// bordered CARD — top line (top border + top radii), middle lines (side borders + background),
// bottom line (bottom border + bottom radii) — built in livePreview.ts from per-line classes keyed
// on `computeBlockRegions()`'s output: `frontmatterOpen`/`frontmatterClose` (+ `frontmatterLines`
// for the body rows in between) for the properties panel, and each `CodeBlock`'s `open`/`close` (+
// `codeLines` for its body) for a fenced block. These tests pin down exactly which line numbers
// land in each role, for the scenarios the bounce history flagged: frontmatter at doc start, a
// fenced block mid-document, cursor-independence (so the card never flickers), and two adjacent
// blocks staying distinct (not fused into one).
//
// This exercises the block-region SCAN directly rather than mounting a CodeMirror `EditorView`:
// livePreview.ts statically imports two Solid/JSX widgets (TaskCheckbox.tsx, CodeHeader.tsx) that
// `bun test` cannot resolve (Solid has no runtime `jsx-runtime` module for automatic-JSX
// resolution — it's a compile-time-only babel transform that only Vite's vite-plugin-solid
// applies), so importing livePreview.ts at all fails to even load under `bun test`. computeBlockRegions
// was extracted to this dependency-free module for exactly this reason (see the file-header
// comment in blockRegions.ts) — it is the single source of truth livePreview.ts's buildDecorations
// reads from (`line.number === codeBlock.open` / `=== frontmatterOpen`, etc.), so pinning down its
// output here IS pinning down which lines get the card's top/mid/bottom classes.
import { test, expect, describe } from "bun:test";
import { Text } from "@codemirror/state";
import { computeBlockRegions } from "./blockRegions";

const doc = (s: string) => Text.of(s.split("\n"));

describe("frontmatter at document start", () => {
  // The user's reference screenshot's exact frontmatter shape.
  const t = doc(["---", "icon: ✎", "tags:", "  - journal", "  - daily", "journal: Daily Journal", "date: 2025-09-15", "---", "", "# Body"].join("\n"));
  const regions = computeBlockRegions(t);

  test("the opening `---` (line 1) is the TOP line", () => {
    expect(regions.frontmatterOpen).toBe(1);
  });

  test("the closing `---` (line 8) is the BOTTOM line", () => {
    expect(regions.frontmatterClose).toBe(8);
  });

  test("every property row between the fences is a MIDDLE line, and only those", () => {
    const mid = [...regions.frontmatterLines].filter((n) => n !== regions.frontmatterOpen && n !== regions.frontmatterClose);
    expect(mid.sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  test("the body heading after the frontmatter is NOT part of the block", () => {
    expect(regions.frontmatterLines.has(9)).toBe(false); // blank line
    expect(regions.frontmatterLines.has(10)).toBe(false); // "# Body"
  });
});

describe("a fenced code block mid-document", () => {
  const t = doc(["# Title", "", "Some prose before the block.", "", "```ts", "const x = 1;", "const y = 2;", "```", "", "Prose after."].join("\n"));
  const regions = computeBlockRegions(t);
  const block = regions.codeBlockByLine.get(6)!; // any body line resolves to the block

  test("the opening fence (line 5) is the TOP line", () => {
    expect(block.open).toBe(5);
    expect(regions.codeBlockByLine.get(5)).toBe(block);
  });

  test("the closing fence (line 8) is the BOTTOM line", () => {
    expect(block.close).toBe(8);
    expect(regions.codeBlockByLine.get(8)).toBe(block);
  });

  test("the body lines (6-7) are MIDDLE lines, in `codeLines`, mapped to the same block", () => {
    expect(regions.codeLines.has(6)).toBe(true);
    expect(regions.codeLines.has(7)).toBe(true);
    expect(regions.codeBlockByLine.get(7)).toBe(block);
    // Neither fence line counts as a "middle" body line.
    expect(regions.codeLines.has(5)).toBe(false);
    expect(regions.codeLines.has(8)).toBe(false);
  });

  test("prose outside the fences is not part of the block", () => {
    expect(regions.codeBlockByLine.has(3)).toBe(false);
    expect(regions.codeBlockByLine.has(10)).toBe(false);
  });

  test("the language info string is captured for the header widget", () => {
    expect(block.lang).toBe("ts");
  });
});

describe("a block with no body lines (fences immediately adjacent)", () => {
  test("frontmatter with zero properties still has distinct top/bottom lines", () => {
    const t = doc(["---", "---", "body"].join("\n"));
    const regions = computeBlockRegions(t);
    expect(regions.frontmatterOpen).toBe(1);
    expect(regions.frontmatterClose).toBe(2);
    expect(regions.frontmatterOpen).not.toBe(regions.frontmatterClose);
  });

  test("an empty fenced code block still has distinct top/bottom lines", () => {
    const t = doc(["text before", "```", "```", "text after"].join("\n"));
    const regions = computeBlockRegions(t);
    const open = regions.codeBlockByLine.get(2)!;
    const close = regions.codeBlockByLine.get(3)!;
    expect(open.open).toBe(2);
    expect(open.close).toBe(3);
    expect(open).toBe(close); // same block, referenced from both its fence lines
  });
});

describe("cursor/selection independence (the card must never flicker)", () => {
  // computeBlockRegions has no cursor/selection parameter at all — it is a pure function of the
  // document's TEXT only. livePreview.ts's ViewPlugin.update() only recomputes it when
  // `u.docChanged`, never on `u.selectionSet` alone (buildDecorations still re-runs every update
  // for the *reveal* marks, but reuses the cached BlockRegions) — so the card's top/mid/bottom
  // classes are structurally incapable of depending on where the caret is.
  test("identical content yields byte-identical block boundaries on repeated calls", () => {
    const t = doc(["---", "a: 1", "---", "", "```js", "code();", "```"].join("\n"));
    const r1 = computeBlockRegions(t);
    const r2 = computeBlockRegions(t); // simulates a second pass, e.g. after a cursor-only move
    expect(r2.frontmatterOpen).toBe(r1.frontmatterOpen);
    expect(r2.frontmatterClose).toBe(r1.frontmatterClose);
    expect([...r2.frontmatterLines].sort()).toEqual([...r1.frontmatterLines].sort());
    const b1 = r1.codeBlockByLine.get(5)!;
    const b2 = r2.codeBlockByLine.get(5)!;
    expect(b2.open).toBe(b1.open);
    expect(b2.close).toBe(b1.close);
  });
});

describe("two adjacent blocks don't fuse", () => {
  test("two fenced code blocks with zero blank lines between them stay two distinct blocks", () => {
    const t = doc(["```js", "a();", "```", "```py", "b()", "```"].join("\n"));
    const regions = computeBlockRegions(t);
    const first = regions.codeBlockByLine.get(1)!;
    const second = regions.codeBlockByLine.get(4)!;
    expect(first).not.toBe(second);
    // Block A's own boundary.
    expect(first.open).toBe(1);
    expect(first.close).toBe(3);
    expect(first.lang).toBe("js");
    // Block B's own boundary — starts the very next line after A's close, not merged into it.
    expect(second.open).toBe(4);
    expect(second.close).toBe(6);
    expect(second.lang).toBe("py");
    // Every line resolves to exactly the block it belongs to — no line is claimed by both.
    expect(regions.codeBlockByLine.get(3)).toBe(first);
    expect(regions.codeBlockByLine.get(4)).toBe(second);
  });

  test("frontmatter immediately followed by a code block (no blank line) stays two distinct cards", () => {
    const t = doc(["---", "a: 1", "---", "```ts", "x", "```"].join("\n"));
    const regions = computeBlockRegions(t);
    expect(regions.frontmatterOpen).toBe(1);
    expect(regions.frontmatterClose).toBe(3);
    const code = regions.codeBlockByLine.get(4)!;
    expect(code.open).toBe(4);
    expect(code.close).toBe(6);
    // The frontmatter's closing line is never mistaken for the code block's, and vice versa.
    expect(regions.codeBlockByLine.has(3)).toBe(false);
    expect(regions.frontmatterLines.has(4)).toBe(false);
  });

  test("a blank line between two code blocks still keeps them distinct (baseline sanity)", () => {
    const t = doc(["```js", "a();", "```", "", "```py", "b()", "```"].join("\n"));
    const regions = computeBlockRegions(t);
    const first = regions.codeBlockByLine.get(1)!;
    const second = regions.codeBlockByLine.get(5)!;
    expect(first.close).toBe(3);
    expect(second.open).toBe(5);
    expect(second.close).toBe(7);
  });
});

describe("```query fences are excluded (owned by queryBlock.ts, not the code-block card)", () => {
  test("a query fence never appears in codeBlockByLine", () => {
    const t = doc(["```query", "of: [[Base]]", "```", "", "```ts", "real();", "```"].join("\n"));
    const regions = computeBlockRegions(t);
    expect(regions.codeBlockByLine.has(1)).toBe(false);
    expect(regions.codeBlockByLine.has(3)).toBe(false);
    const real = regions.codeBlockByLine.get(5)!;
    expect(real.open).toBe(5);
    expect(real.close).toBe(7);
  });
});

describe("```graph fences are excluded (owned by graphBlock.ts, not the code-block card)", () => {
  test("a graph fence never appears in codeBlockByLine", () => {
    const t = doc(["```graph", "a -> b", "```", "", "```ts", "real();", "```"].join("\n"));
    const regions = computeBlockRegions(t);
    expect(regions.codeBlockByLine.has(1)).toBe(false);
    expect(regions.codeBlockByLine.has(3)).toBe(false);
    const real = regions.codeBlockByLine.get(5)!;
    expect(real.open).toBe(5);
    expect(real.close).toBe(7);
  });
});
