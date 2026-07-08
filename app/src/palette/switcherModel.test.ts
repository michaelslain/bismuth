import { describe, expect, it } from "bun:test";
import { visibleContent, planSwitcherEnter, type ContentHits, type SwitcherEnterState } from "./switcherModel";
import type { SearchResult } from "../searchOpts";

const result = (path: string): SearchResult => ({ path, matchCount: 1, snippets: [] });
const hits = (query: string, ...paths: string[]): ContentHits => ({ query, results: paths.map(result) });

describe("visibleContent — freshness + dedupe for the unified list", () => {
  it("returns nothing when no content search has run yet", () => {
    expect(visibleContent(null, "apples", [])).toEqual([]);
  });

  it("returns the stored results when they were computed for exactly the current query", () => {
    expect(visibleContent(hits("apples", "a.md", "b.md"), "apples", [])).toEqual([
      result("a.md"),
      result("b.md"),
    ]);
  });

  it("hides STALE results — stored rows belong to a prior query (the reopened-#8 bug family)", () => {
    // The user refined "apples" -> "apples pie"; the debounced search for the new text hasn't
    // resolved. The old rows must not render (or be Enter-openable) under the new query.
    expect(visibleContent(hits("apples", "a.md"), "apples pie", [])).toEqual([]);
  });

  it("dedupes: a note already shown as a file-name match is dropped from the content rows", () => {
    expect(visibleContent(hits("q", "a.md", "b.md", "c.md"), "q", ["b.md"])).toEqual([
      result("a.md"),
      result("c.md"),
    ]);
  });

  it("preserves the backend's ranked order of the surviving rows", () => {
    expect(visibleContent(hits("q", "z.md", "a.md", "m.md"), "q", []).map((r) => r.path)).toEqual([
      "z.md",
      "a.md",
      "m.md",
    ]);
  });

  it("query comparison is exact (whitespace differences count as a different query)", () => {
    expect(visibleContent(hits("q ", "a.md"), "q", [])).toEqual([]);
  });
});

describe("planSwitcherEnter — the unified Enter matrix", () => {
  const state = (s: Partial<SwitcherEnterState> = {}): SwitcherEnterState => ({
    hasQuery: true,
    shaped: false,
    rowCount: 0,
    aiPhase: "idle",
    ...s,
  });

  it("commits the highlighted row when any rows are showing (file, content, or AI results)", () => {
    expect(planSwitcherEnter(state({ rowCount: 3 }))).toBe("commit");
    expect(planSwitcherEnter(state({ rowCount: 1, shaped: true }))).toBe("commit");
    expect(planSwitcherEnter(state({ rowCount: 2, aiPhase: "results" }))).toBe("commit");
  });

  it("commits the frecent-list row even with an empty query (Cmd+O then Enter)", () => {
    expect(planSwitcherEnter(state({ hasQuery: false, rowCount: 5 }))).toBe("commit");
  });

  it("escalates a question-shaped query with zero rows to Bismuth AI", () => {
    expect(planSwitcherEnter(state({ shaped: true, rowCount: 0 }))).toBe("ask-ai");
  });

  it("does nothing for a short (non-question) query with zero rows", () => {
    expect(planSwitcherEnter(state({ shaped: false, rowCount: 0 }))).toBe("none");
  });

  it("does nothing for an empty query with zero rows", () => {
    expect(planSwitcherEnter(state({ hasQuery: false, rowCount: 0, shaped: false }))).toBe("none");
  });

  it("swallows Enter while an AI turn is in flight (no double-fire)", () => {
    expect(planSwitcherEnter(state({ aiPhase: "loading", shaped: true }))).toBe("none");
    expect(planSwitcherEnter(state({ aiPhase: "loading", rowCount: 4 }))).toBe("none");
    expect(planSwitcherEnter(state({ aiPhase: "loading", forceAi: true }))).toBe("none");
  });

  it("retries the AI on Enter from the error panel (question-shaped query)", () => {
    expect(planSwitcherEnter(state({ aiPhase: "error", shaped: true, rowCount: 0 }))).toBe("ask-ai");
  });

  it("does nothing on Enter from the AI empty-results panel (zero AI rows)", () => {
    expect(planSwitcherEnter(state({ aiPhase: "results", rowCount: 0, shaped: true }))).toBe("none");
  });

  describe("forceAi (Cmd/Ctrl+Enter) — the always-reachable AI path folded in from the Search tab", () => {
    it("reaches the AI even when rows are showing (the previously-unreachable case)", () => {
      expect(planSwitcherEnter(state({ rowCount: 7, forceAi: true }))).toBe("ask-ai");
    });

    it("reaches the AI even for a short query (forceAi overrides the word-count gate)", () => {
      expect(planSwitcherEnter(state({ shaped: false, rowCount: 0, forceAi: true }))).toBe("ask-ai");
    });

    it("re-asks from the results/error phases", () => {
      expect(planSwitcherEnter(state({ aiPhase: "results", rowCount: 2, forceAi: true }))).toBe("ask-ai");
      expect(planSwitcherEnter(state({ aiPhase: "error", forceAi: true }))).toBe("ask-ai");
    });

    it("still does nothing on an empty query", () => {
      expect(planSwitcherEnter(state({ hasQuery: false, rowCount: 0, forceAi: true }))).toBe("none");
    });
  });
});
