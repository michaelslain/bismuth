// Tests for the pure `nextMatchFrom` helper behind the in-note find bar (findPanel.ts). The
// CodeMirror panel + view can't mount under bun (no live EditorView / DOM), so we unit-test the
// factored-out match-target logic that drives the find bar's SELECTION on every keystroke —
// i.e. the "Cmd+F selects the match" behavior (bug #21). SearchQuery.getCursor works on a plain
// EditorState, so this needs no view.

import { test, expect, describe } from "bun:test";
import { EditorState, Text } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { nextMatchFrom, tableBlockAtRange, tableBlockStartForRange, tableRevealDecision, nextOwnedTable, reconcileTableReveal } from "./findPanel";

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

// #31: the find bar must flip a table to source ONLY when the current active match is genuinely
// inside THAT block, flip it back when the match moves out / the bar closes, and never touch a
// table on a prose match. These cover the pure decision + ownership logic that drives that.
describe("tableRevealDecision (which table a match reveals)", () => {
  const blocks = [
    { from: 10, to: 40, startLine: 3 },
    { from: 60, to: 90, startLine: 8 },
  ];

  test("a match inside a table that isn't active → reveal it", () => {
    expect(tableRevealDecision(blocks, 15, 20, null)).toEqual({ target: 3, reveal: 3 });
  });

  test("a match inside the ALREADY-active table → target set, reveal null (no re-dispatch)", () => {
    expect(tableRevealDecision(blocks, 15, 20, 3)).toEqual({ target: 3, reveal: 3 === 3 ? null : 3 });
    expect(tableRevealDecision(blocks, 15, 20, 3)).toEqual({ target: 3, reveal: null });
  });

  test("a prose match (no table) → target null, reveal null (Cmd+F never touches a table)", () => {
    expect(tableRevealDecision(blocks, 45, 55, null)).toEqual({ target: null, reveal: null });
    expect(tableRevealDecision(blocks, 45, 55, 3)).toEqual({ target: null, reveal: null });
  });

  test("a match moving from one table to another that isn't active → reveal the new one", () => {
    expect(tableRevealDecision(blocks, 70, 75, 3)).toEqual({ target: 8, reveal: 8 });
  });
});

describe("nextOwnedTable (what the find bar must revert on close)", () => {
  test("find dispatched a reveal → it OWNS that table (revert on close)", () => {
    expect(nextOwnedTable(null, { target: 3, reveal: 3 })).toBe(3);
  });

  test("the match left all tables → own nothing", () => {
    expect(nextOwnedTable(3, { target: null, reveal: null })).toBeNull();
  });

  test("a MANUALLY-opened table (already active, find never revealed it) is NOT claimed", () => {
    // prevOwned null (find owns nothing) + reveal null (no dispatch) → still owns nothing, so
    // closing the bar leaves the user's manually-revealed table open.
    expect(nextOwnedTable(null, { target: 3, reveal: null })).toBeNull();
  });

  test("mid-navigation among matching tables refreshes ownership (auto-switch still reverts)", () => {
    // Find owned block 3; the selection auto-switched into block 8 (already active), reveal null.
    // Ownership follows to 8 so closing the bar reverts the table actually showing source.
    expect(nextOwnedTable(3, { target: 8, reveal: null })).toBe(8);
  });

  test("find keeps owning a table while the match stays inside it", () => {
    expect(nextOwnedTable(3, { target: 3, reveal: null })).toBe(3);
  });
});

// #31 (the reopened bug): the PRIOR fix scoped the REVEAL but left the REVERT implicit — it relied
// on activeTableField auto-clearing once a *dispatched selection* left the block. On the no-match /
// empty-query path the find bar dispatched nothing, so a table revealed by an earlier matching
// keystroke stayed STUCK in raw source ("Cmd+F flipped my table to source"). `reconcileTableReveal`
// makes the revert explicit; these are the transitions the live headless view confirmed were broken.
describe("reconcileTableReveal (reveal + EXPLICIT revert lifecycle)", () => {
  const blocks = [
    { from: 10, to: 40, startLine: 3 },
    { from: 60, to: 90, startLine: 8 },
  ];
  const m = (from: number, to: number) => ({ from, to });

  test("match inside a not-active table → reveal it and own it", () => {
    expect(reconcileTableReveal(blocks, m(15, 20), null, null)).toEqual({ reveal: 3, revert: false, owned: 3 });
  });

  test("match inside the already-active table find owns → keep (no re-dispatch), still owned", () => {
    expect(reconcileTableReveal(blocks, m(15, 20), 3, 3)).toEqual({ reveal: null, revert: false, owned: 3 });
  });

  test("match auto-switching to another table (already active) → refresh ownership, no re-dispatch", () => {
    expect(reconcileTableReveal(blocks, m(70, 75), 8, 3)).toEqual({ reveal: null, revert: false, owned: 8 });
  });

  test("NO MATCH while find owns the active table → REVERT it (the stuck-in-source fix)", () => {
    // The decisive case: empty / non-matching query. Prior code dispatched nothing → table stuck.
    expect(reconcileTableReveal(blocks, null, 3, 3)).toEqual({ reveal: null, revert: true, owned: null });
  });

  test("prose match while find owns the active table → REVERT it", () => {
    expect(reconcileTableReveal(blocks, m(45, 55), 3, 3)).toEqual({ reveal: null, revert: true, owned: null });
  });

  test("NO MATCH but the active table is MANUALLY opened (find owns nothing) → never revert it", () => {
    // active=3 (user's Edit-source table), owned=null → find must not collapse the user's table.
    expect(reconcileTableReveal(blocks, null, 3, null)).toEqual({ reveal: null, revert: false, owned: null });
  });

  test("NO MATCH and nothing is active/owned → no-op", () => {
    expect(reconcileTableReveal(blocks, null, null, null)).toEqual({ reveal: null, revert: false, owned: null });
  });

  test("prose match but find's owned table already auto-cleared (owned≠active) → just drop the claim", () => {
    // active already null (a prior selection change auto-cleared it); stale owned=3 → no double revert.
    expect(reconcileTableReveal(blocks, m(45, 55), null, 3)).toEqual({ reveal: null, revert: false, owned: null });
  });
});
