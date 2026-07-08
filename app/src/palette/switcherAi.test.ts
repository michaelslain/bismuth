import { describe, expect, it } from "bun:test";
import {
  isNaturalLanguageQuery,
  shouldOfferAiEscalation,
  switcherAiReducer,
  initialSwitcherAiState,
  type SwitcherAiState,
} from "./switcherAi";
import type { SearchResult } from "../searchOpts";

const result = (path: string): SearchResult => ({ path, matchCount: 1, snippets: [] });

// The shared "is this a real question, not a filename/keyword fragment" gate. Lives here (not in
// a Search-tab module) since the unified Cmd+O switcher is the app's only search surface.
describe("isNaturalLanguageQuery", () => {
  it("is false for empty/whitespace-only queries", () => {
    expect(isNaturalLanguageQuery("")).toBe(false);
    expect(isNaturalLanguageQuery("   ")).toBe(false);
  });

  it("is false for a single word", () => {
    expect(isNaturalLanguageQuery("metals")).toBe(false);
  });

  it("is false for exactly two words", () => {
    expect(isNaturalLanguageQuery("meeting notes")).toBe(false);
  });

  it("is true once a query has three or more words", () => {
    expect(isNaturalLanguageQuery("where did I write about metals")).toBe(true);
    expect(isNaturalLanguageQuery("a b c")).toBe(true);
  });

  it("ignores leading/trailing/repeated whitespace when counting words", () => {
    expect(isNaturalLanguageQuery("  a   b   c  ")).toBe(true);
    expect(isNaturalLanguageQuery("  a   b  ")).toBe(false);
  });
});

describe("shouldOfferAiEscalation — empty-matches x Enter x query-shape matrix", () => {
  it("never offers AI when there ARE fuzzy file matches, regardless of query shape", () => {
    expect(shouldOfferAiEscalation("a", 1)).toBe(false);
    expect(shouldOfferAiEscalation("a b c d", 1)).toBe(false);
    expect(shouldOfferAiEscalation("a b c d", 5)).toBe(false);
  });

  it("does not offer AI for an empty query even with zero matches", () => {
    expect(shouldOfferAiEscalation("", 0)).toBe(false);
    expect(shouldOfferAiEscalation("   ", 0)).toBe(false);
  });

  it("does not offer AI for a single-word miss (plausibly a garbled filename)", () => {
    expect(shouldOfferAiEscalation("meetign", 0)).toBe(false);
  });

  it("does not offer AI for a two-word miss", () => {
    expect(shouldOfferAiEscalation("meeting notes", 0)).toBe(false);
  });

  it("offers AI once the zero-match query has three or more words", () => {
    expect(shouldOfferAiEscalation("where did I write about metals", 0)).toBe(true);
    expect(shouldOfferAiEscalation("a b c", 0)).toBe(true);
  });

  it("is insensitive to extra whitespace when counting words", () => {
    expect(shouldOfferAiEscalation("  where   did   I  ", 0)).toBe(true);
    expect(shouldOfferAiEscalation("  where   did  ", 0)).toBe(false);
  });
});

describe("switcherAiReducer", () => {
  it("starts idle", () => {
    expect(initialSwitcherAiState).toEqual({ phase: "idle", gen: 0, results: [], error: null });
  });

  it("ask moves to loading and bumps gen, clearing any prior results/error", () => {
    const prior: SwitcherAiState = { phase: "error", gen: 3, results: [], error: "boom" };
    const next = switcherAiReducer(prior, { type: "ask" });
    expect(next).toEqual({ phase: "loading", gen: 4, results: [], error: null });
  });

  it("resolved for the current gen shows results (possibly empty)", () => {
    const loading = switcherAiReducer(initialSwitcherAiState, { type: "ask" }); // gen 1
    const next = switcherAiReducer(loading, { type: "resolved", gen: 1, results: [result("a.md")] });
    expect(next.phase).toBe("results");
    expect(next.results).toEqual([result("a.md")]);
  });

  it("resolved with zero AI hits still transitions to results (caller renders the empty variant)", () => {
    const loading = switcherAiReducer(initialSwitcherAiState, { type: "ask" });
    const next = switcherAiReducer(loading, { type: "resolved", gen: 1, results: [] });
    expect(next.phase).toBe("results");
    expect(next.results).toEqual([]);
  });

  it("rejected for the current gen shows the error message verbatim", () => {
    const loading = switcherAiReducer(initialSwitcherAiState, { type: "ask" });
    const next = switcherAiReducer(loading, { type: "rejected", gen: 1, message: "AI search needs Claude Code installed" });
    expect(next.phase).toBe("error");
    expect(next.error).toBe("AI search needs Claude Code installed");
  });

  it("reset drops back to idle and bumps gen even mid-flight", () => {
    const loading = switcherAiReducer(initialSwitcherAiState, { type: "ask" }); // gen 1
    const reset = switcherAiReducer(loading, { type: "reset" });
    expect(reset).toEqual({ phase: "idle", gen: 2, results: [], error: null });
  });

  // The core requirement: "a new keystroke cancels/ignores the in-flight AI result." Modeled as
  // reset bumping `gen` so a LATE resolved/rejected event (captured at the OLD gen) is a no-op.
  describe("stale response after reset (keystroke cancels in-flight AI)", () => {
    it("ignores a resolved event carrying a superseded gen", () => {
      const loading = switcherAiReducer(initialSwitcherAiState, { type: "ask" }); // gen 1
      const afterKeystroke = switcherAiReducer(loading, { type: "reset" }); // gen 2, back to idle
      const lateResolve = switcherAiReducer(afterKeystroke, { type: "resolved", gen: 1, results: [result("late.md")] });
      expect(lateResolve).toEqual(afterKeystroke); // unchanged — stale response dropped
    });

    it("ignores a rejected event carrying a superseded gen", () => {
      const loading = switcherAiReducer(initialSwitcherAiState, { type: "ask" }); // gen 1
      const afterKeystroke = switcherAiReducer(loading, { type: "reset" }); // gen 2
      const lateReject = switcherAiReducer(afterKeystroke, { type: "rejected", gen: 1, message: "boom" });
      expect(lateReject).toEqual(afterKeystroke);
    });

    it("a second ask (re-ask while showing results/error) supersedes the first request's response", () => {
      const loading1 = switcherAiReducer(initialSwitcherAiState, { type: "ask" }); // gen 1
      const results1 = switcherAiReducer(loading1, { type: "resolved", gen: 1, results: [result("a.md")] });
      const loading2 = switcherAiReducer(results1, { type: "ask" }); // gen 2, re-ask
      // The FIRST request's (gen 1) response, arriving late, must not clobber the second's loading state.
      const lateFirstResolve = switcherAiReducer(loading2, { type: "resolved", gen: 1, results: [result("stale.md")] });
      expect(lateFirstResolve).toEqual(loading2);
      // The second request's own response DOES apply.
      const results2 = switcherAiReducer(loading2, { type: "resolved", gen: 2, results: [result("fresh.md")] });
      expect(results2.results).toEqual([result("fresh.md")]);
    });
  });
});
