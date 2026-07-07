// Tests for the pure `nextMatchFrom` helper behind the in-note find bar (findPanel.ts). The
// CodeMirror panel + view can't mount under bun (no live EditorView / DOM), so we unit-test the
// factored-out match-target logic that drives the find bar's SELECTION on every keystroke —
// i.e. the "Cmd+F selects the match" behavior (bug #21). SearchQuery.getCursor works on a plain
// EditorState, so this needs no view.

import { test, expect, describe } from "bun:test";
import { EditorState, Text } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { nextMatchFrom, tableBlockAtRange, tableBlockStartForRange } from "./findPanel";

const q = (search: string, caseSensitive = false) =>
  new SearchQuery({ search, caseSensitive, literal: true });

describe("nextMatchFrom", () => {
  // indices:            0   4   8   12  16
  const state = EditorState.create({ doc: "foo bar foo baz FOO" });

  test("selects the first match from the doc start", () => {
    expect(nextMatchFrom(state, q("foo"), 0)).toEqual({ from: 0, to: 3 });
  });

  test("advances to the next match when searching past the current one's start", () => {
    // From pos 1 the first "foo" (starts at 0) is behind us → the second "foo" at 8.
    expect(nextMatchFrom(state, q("foo"), 1)).toEqual({ from: 8, to: 11 });
  });

  test("searching from a match START stays on that match (query refinement)", () => {
    // Refining the query re-runs from the current match's start — it must not skip it.
    expect(nextMatchFrom(state, q("foo"), 8)).toEqual({ from: 8, to: 11 });
  });

  test("wraps to the top when nothing matches at/after pos", () => {
    // "bar" only occurs at 4; searching from 10 finds nothing forward → wraps to it.
    expect(nextMatchFrom(state, q("bar"), 10)).toEqual({ from: 4, to: 7 });
  });

  test("is case-insensitive by default (matches FOO)", () => {
    expect(nextMatchFrom(state, q("foo"), 12)).toEqual({ from: 16, to: 19 });
  });

  test("case-sensitive skips FOO and wraps to a lowercase foo", () => {
    // From 12 the only forward occurrence is "FOO"@16, excluded when case-sensitive →
    // wraps to the first lowercase "foo" at 0.
    expect(nextMatchFrom(state, q("foo", true), 12)).toEqual({ from: 0, to: 3 });
  });

  test("returns null when the query has no match anywhere", () => {
    expect(nextMatchFrom(state, q("qux"), 0)).toBeNull();
  });

  test("returns null for an empty / invalid query", () => {
    expect(nextMatchFrom(state, q(""), 0)).toBeNull();
  });
});

// #21 (table half): a GFM table renders as an atomic block-replace widget that hides its
// source, so a search match on a table line is invisible until the block is revealed. These
// cover the pure "does this match intersect a table block?" logic that decides the reveal.
describe("tableBlockAtRange (match ↔ table-block overlap)", () => {
  // Two table blocks, by char span: block A = [10, 40) starting on line 3; block B = [60, 90) on line 8.
  const blocks = [
    { from: 10, to: 40, startLine: 3 },
    { from: 60, to: 90, startLine: 8 },
  ];

  test("a match fully inside a block returns that block's start line", () => {
    expect(tableBlockAtRange(blocks, 15, 20)).toBe(3);
    expect(tableBlockAtRange(blocks, 70, 75)).toBe(8);
  });

  test("a match outside every block returns null", () => {
    expect(tableBlockAtRange(blocks, 0, 5)).toBeNull(); // before A
    expect(tableBlockAtRange(blocks, 45, 55)).toBeNull(); // between A and B
    expect(tableBlockAtRange(blocks, 95, 99)).toBeNull(); // after B
  });

  test("a match abutting a boundary is NOT inside the block (half-open)", () => {
    expect(tableBlockAtRange(blocks, 5, 10)).toBeNull(); // ends exactly at A.from
    expect(tableBlockAtRange(blocks, 40, 45)).toBeNull(); // starts exactly at A.to
  });

  test("a match touching the first / last char of a block IS inside it", () => {
    expect(tableBlockAtRange(blocks, 10, 11)).toBe(3); // first char of A
    expect(tableBlockAtRange(blocks, 39, 40)).toBe(3); // last char of A
  });

  test("returns the FIRST overlapping block for a range spanning into one", () => {
    expect(tableBlockAtRange(blocks, 38, 62)).toBe(3);
  });
});

describe("tableBlockStartForRange (over a real doc via groupTableBlocks)", () => {
  // A paragraph, then a 3-line table (header/sep/row), then a trailing paragraph.
  const doc = Text.of([
    "intro paragraph",       // line 1
    "| A | B |",             // line 2  (table header)
    "| - | - |",             // line 3  (separator)
    "| x | y |",             // line 4  (body row)
    "after the table",       // line 5
  ]);
  const lineFrom = (n: number) => doc.line(n).from;
  const lineTo = (n: number) => doc.line(n).to;

  test("a range on a table body line resolves to the table's header line (2)", () => {
    const from = lineFrom(4) + 2; // inside "| x | y |"
    expect(tableBlockStartForRange(doc, from, from + 1)).toBe(2);
  });

  test("a range on the table header line resolves to line 2", () => {
    const from = lineFrom(2) + 2;
    expect(tableBlockStartForRange(doc, from, from + 1)).toBe(2);
  });

  test("a range in the intro paragraph is outside any table (null)", () => {
    expect(tableBlockStartForRange(doc, 0, 5)).toBeNull();
  });

  test("a range in the trailing paragraph is outside any table (null)", () => {
    const from = lineFrom(5) + 1;
    expect(tableBlockStartForRange(doc, from, lineTo(5))).toBeNull();
  });
});
