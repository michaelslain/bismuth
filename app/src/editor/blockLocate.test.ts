// app/src/editor/blockLocate.test.ts
//
// The shared embedded-block locate rule (blockLocate.ts), tested against the exact geometry
// that broke it. The ranges below are not invented — they are what graphRanges() actually
// returns for "```graph\na\n```\n```graph\nb\n```", and the positions are what a real
// EditorView's posAtDOM() actually returns for those two widgets: 0 and 15.

import { describe, expect, test } from "bun:test";
import { locateBlockIndex, type BlockRange } from "./blockLocate";

// Two fences separated by ONE newline: "```graph\na\n```\n```graph\nb\n```".
// Block 0 ends at 14 (exclusive) and block 1 starts at 15 — one apart, the tightest legal
// spacing. The old `pos <= to + 1` stretched block 0 to cover 15 and swallowed block 1.
const ADJACENT: BlockRange[] = [{ from: 0, to: 14 }, { from: 15, to: 29 }];

describe("locateBlockIndex", () => {
  test("a widget's own start locates that widget", () => {
    expect(locateBlockIndex(ADJACENT, 0)).toBe(0);
    expect(locateBlockIndex(ADJACENT, 15)).toBe(1);
  });

  // THE regression. 15 is block 1's `from` and also block 0's `to + 1`; the old rule tested
  // block 0 first, matched, and returned 0 — so block 1's widget edited block 0's fence.
  test("the position one past a block's end belongs to the NEXT block, never that block", () => {
    expect(locateBlockIndex(ADJACENT, 15)).not.toBe(0);
    expect(locateBlockIndex(ADJACENT, 15)).toBe(1);
  });

  test("no position is claimed by two adjacent blocks", () => {
    // Every position across both ranges resolves to at most one block, and never to an
    // earlier block than the one that actually contains it.
    for (let pos = 0; pos <= 29; pos++) {
      const i = locateBlockIndex(ADJACENT, pos);
      if (i === -1) continue;
      const r = ADJACENT[i];
      expect(pos >= r.from && pos <= r.to).toBe(true);
    }
  });

  test("a position inside a block still locates it (what the +1 tolerance was reaching for)", () => {
    expect(locateBlockIndex(ADJACENT, 9)).toBe(0);  // in block 0's body
    expect(locateBlockIndex(ADJACENT, 14)).toBe(0); // at block 0's exclusive end
    expect(locateBlockIndex(ADJACENT, 24)).toBe(1); // in block 1's body
  });

  test("a position in no block locates nothing rather than guessing a neighbour", () => {
    const spaced: BlockRange[] = [{ from: 7, to: 21 }]; // a fence after some prose
    expect(locateBlockIndex(spaced, 0)).toBe(-1);  // out in the prose above
    expect(locateBlockIndex(spaced, 22)).toBe(-1); // past the closing fence
    expect(locateBlockIndex([], 0)).toBe(-1);      // no blocks at all
  });

  test("blocks separated by a blank line still locate (the spacing the old suites used)", () => {
    const spaced: BlockRange[] = [{ from: 7, to: 23 }, { from: 33, to: 47 }];
    expect(locateBlockIndex(spaced, 7)).toBe(0);
    expect(locateBlockIndex(spaced, 33)).toBe(1);
  });
});
