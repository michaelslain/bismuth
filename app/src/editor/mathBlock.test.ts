// Tests for the pure multi-line inline-math scanner in mathBlock.ts. The CodeMirror
// StateField itself can't mount under bun (no live EditorView / DOM), so we unit-test the
// factored-out `scanMultilineInlineMath` helper that drives its decorations.

import { test, expect, describe } from "bun:test";
import { EditorState } from "@codemirror/state";
import { scanMultilineInlineMath, isInMathBlock } from "./mathBlock";

const inMath = (doc: string, pos: number) => isInMathBlock(EditorState.create({ doc }), pos);

// The Enter keymap declines list-markup continuation inside a `$$` block (otherwise the vanilla
// command deletes the closing `$$` of a math block written directly under a list item).
describe("isInMathBlock", () => {
  const block = ["- item", "$$", "E = mc^2", "$$"].join("\n");
  test("caret on the closing `$$` line is inside the block", () => {
    expect(inMath(block, block.length)).toBe(true);
  });
  test("caret on the opening `$$` line is inside the block", () => {
    expect(inMath(block, block.indexOf("$$") + 1)).toBe(true);
  });
  test("caret on the inner content line is inside the block", () => {
    expect(inMath(block, block.indexOf("E = mc^2") + 2)).toBe(true);
  });
  test("caret on the list line before the block is OUTSIDE", () => {
    expect(inMath(block, 2)).toBe(false);
  });
  test("a `$$` that opens AFTER the caret doesn't count", () => {
    expect(inMath("hello\n$$", 2)).toBe(false);
  });
  test("a `$$` inside a ``` code fence is not a math block", () => {
    const doc = ["```", "$$", "```"].join("\n");
    expect(inMath(doc, doc.indexOf("$$") + 1)).toBe(false);
  });
  test("caret between two separate blocks is outside", () => {
    const doc = ["$$", "a", "$$", "mid", "$$", "b", "$$"].join("\n");
    expect(inMath(doc, doc.indexOf("mid") + 1)).toBe(false);
  });
  // Only a CLOSED `$$…$$` pair is a block — an unclosed `$$` must NOT report the lines below it as
  // in-math (which would wrongly disable list continuation for the rest of the note).
  test("an unclosed `$$` does not put the lines below it in a block", () => {
    const doc = "$$\n- one";
    expect(inMath(doc, doc.length)).toBe(false);
  });
});

describe("scanMultilineInlineMath", () => {
  test("claims a `$…$` whose closing `$` is on a later line (one span, delimiters included)", () => {
    // "$a +\n   b$" — open at 0, close `$` at 9 → span [0, 10).
    expect(scanMultilineInlineMath("$a +\n   b$")).toEqual([{ from: 0, to: 10 }]);
  });

  test("ignores a single-line `$…$` (livePreview owns those)", () => {
    expect(scanMultilineInlineMath("$a + b$")).toEqual([]);
  });

  test("does NOT overlap a `$$` display block", () => {
    expect(scanMultilineInlineMath("$$\na+b\n$$")).toEqual([]);
  });

  test("does NOT reach into a `$$` block's inner content", () => {
    // The wrappable ` $x +\n y$ ` sits inside the display block → must not be claimed.
    expect(scanMultilineInlineMath("$$\n a $x +\n y$ \n$$")).toEqual([]);
  });

  test("a lone `$5` price stays literal (no close → no span)", () => {
    expect(scanMultilineInlineMath("I have $5 here")).toEqual([]);
  });

  test("two stray `$` don't merge when the second is preceded by a space", () => {
    // Closing `$` preceded by whitespace is an invalid delimiter → literal.
    expect(scanMultilineInlineMath("$5 dollars\nand 3 $ more")).toEqual([]);
  });

  test("a blank line ends the paragraph → no runaway span", () => {
    expect(scanMultilineInlineMath("$a\n\nb$")).toEqual([]);
  });

  test("`$` inside a fenced code block is literal", () => {
    expect(scanMultilineInlineMath("```\n$a\nb$\n```")).toEqual([]);
  });

  test("honors `\\$` escapes inside the span (still one span)", () => {
    // "$a \$ b\nc$" — the escaped `\$` is not a delimiter; close is the final `$` at 9.
    expect(scanMultilineInlineMath("$a \\$ b\nc$")).toEqual([{ from: 0, to: 10 }]);
  });

  test("stops at the first close, leaving a trailing single-line `$…$` to livePreview", () => {
    // "$a +\nb$ and $c$" — multi-line span [0, 7); the later `$c$` is single-line (omitted).
    expect(scanMultilineInlineMath("$a +\nb$ and $c$")).toEqual([{ from: 0, to: 7 }]);
  });

  test("finds a span that starts mid-line after prose", () => {
    // "text $a +\nb$ end" — open at index 5, close `$` at 11 → span [5, 12).
    expect(scanMultilineInlineMath("text $a +\nb$ end")).toEqual([{ from: 5, to: 12 }]);
  });
});
