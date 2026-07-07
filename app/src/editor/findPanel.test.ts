// Tests for the pure `nextMatchFrom` helper behind the in-note find bar (findPanel.ts). The
// CodeMirror panel + view can't mount under bun (no live EditorView / DOM), so we unit-test the
// factored-out match-target logic that drives the find bar's SELECTION on every keystroke —
// i.e. the "Cmd+F selects the match" behavior (bug #21). SearchQuery.getCursor works on a plain
// EditorState, so this needs no view.

import { test, expect, describe } from "bun:test";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { nextMatchFrom } from "./findPanel";

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
