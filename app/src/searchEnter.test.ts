// app/src/searchEnter.test.ts
import { describe, expect, it } from "bun:test";
import { planEnter, isNaturalLanguageQuery, type EnterState } from "./searchEnter";

const state = (s: Partial<EnterState> = {}): EnterState => ({
  promptMode: false,
  regex: false,
  hasQuery: true,
  resultCount: 0,
  ...s,
});

describe("planEnter", () => {
  it("escalates a non-empty literal query with zero keyword hits to the AI prompt search", () => {
    // The core bug: this case must reach the AI, not silently re-run keyword search.
    expect(planEnter(state({ hasQuery: true, resultCount: 0 })).action).toBe("escalate-ai");
  });

  it("re-runs keyword search when there ARE hits (Enter refreshes, doesn't escalate)", () => {
    expect(planEnter(state({ resultCount: 3 })).action).toBe("keyword");
  });

  it("does not escalate an empty query", () => {
    expect(planEnter(state({ hasQuery: false, resultCount: 0 })).action).toBe("keyword");
  });

  it("runs the prompt search when already in AI mode (even with hits shown)", () => {
    expect(planEnter(state({ promptMode: true, resultCount: 5 })).action).toBe("prompt");
    expect(planEnter(state({ promptMode: true, resultCount: 0 })).action).toBe("prompt");
  });

  it("runs keyword/regex (never escalates) in regex mode, even with zero hits", () => {
    expect(planEnter(state({ regex: true, resultCount: 0 })).action).toBe("regex");
  });

  it("prompt mode wins over regex mode", () => {
    expect(planEnter(state({ promptMode: true, regex: true })).action).toBe("prompt");
  });

  // BUG #8: the always-reachable AI path. A natural-language query ("where did I write about
  // metals") usually DOES have some literal keyword hit, so plain Enter re-ran keyword search and
  // the AI was never reachable via the keyboard. Cmd/Ctrl+Enter (forceAi) escalates regardless.
  describe("forceAi (Cmd/Ctrl+Enter) — reachable AI even WITH keyword hits", () => {
    it("escalates to the AI when there ARE keyword hits (the previously-unreachable case)", () => {
      // Plain Enter with hits stays "keyword"; forceAi turns the SAME state into an AI escalation.
      expect(planEnter(state({ resultCount: 7, forceAi: false })).action).toBe("keyword");
      expect(planEnter(state({ resultCount: 7, forceAi: true })).action).toBe("escalate-ai");
    });

    it("escalates to the AI even in regex mode (forceAi overrides the regex Enter-gate)", () => {
      expect(planEnter(state({ regex: true, resultCount: 4, forceAi: true })).action).toBe("escalate-ai");
    });

    it("re-runs the prompt search (not a fresh escalation) when already in AI mode", () => {
      expect(planEnter(state({ promptMode: true, resultCount: 3, forceAi: true })).action).toBe("prompt");
    });

    it("still does nothing useful for an empty query (no AI on an empty box)", () => {
      expect(planEnter(state({ hasQuery: false, forceAi: true })).action).toBe("keyword");
    });

    it("also escalates a zero-hit query (same as plain Enter there)", () => {
      expect(planEnter(state({ resultCount: 0, forceAi: true })).action).toBe("escalate-ai");
    });
  });

  // BUG #8 (REOPENED): "no files found, press Enter, it does not do prompt." Literal keyword search
  // is debounced ~150ms; pressing Enter within that window (or while refining a prior search) leaves
  // `resultCount` reflecting the PREVIOUS query — usually non-empty — so plain Enter chose "keyword"
  // and never escalated. `resultsStale` says "don't trust the count": run the keyword search for the
  // CURRENT query first, then escalate to AI iff it comes back empty ("keyword-escalate").
  describe("resultsStale — Enter pressed before the live keyword search caught up", () => {
    it("defers the escalate decision to a fresh keyword search when a NON-EMPTY stale count would have blocked it", () => {
      // The exact reopened bug: stale results show 5 hits (a prior query), current query has none.
      // Without the guard this was "keyword" (no AI). With it, we run keyword-then-maybe-escalate.
      expect(planEnter(state({ resultCount: 5, resultsStale: true })).action).toBe("keyword-escalate");
    });

    it("also defers when the stale count is zero (still can't trust a stale count)", () => {
      expect(planEnter(state({ resultCount: 0, resultsStale: true })).action).toBe("keyword-escalate");
    });

    it("escalates IMMEDIATELY (no redundant keyword search) when the zero count is FRESH", () => {
      expect(planEnter(state({ resultCount: 0, resultsStale: false })).action).toBe("escalate-ai");
    });

    it("re-runs keyword (not keyword-escalate) when a NON-EMPTY count is FRESH", () => {
      expect(planEnter(state({ resultCount: 4, resultsStale: false })).action).toBe("keyword");
    });

    it("stale results never override AI mode, regex mode, forceAi, or an empty query", () => {
      // Freshness only gates the literal-live branch; the higher-priority branches win regardless.
      expect(planEnter(state({ promptMode: true, resultsStale: true })).action).toBe("prompt");
      expect(planEnter(state({ regex: true, resultsStale: true })).action).toBe("regex");
      expect(planEnter(state({ resultCount: 9, resultsStale: true, forceAi: true })).action).toBe("escalate-ai");
      expect(planEnter(state({ hasQuery: false, resultsStale: true })).action).toBe("keyword");
    });

    it("keyword-escalate still cancels the pending live-search debounce", () => {
      expect(planEnter(state({ resultCount: 5, resultsStale: true })).cancelPendingLiveSearch).toBe(true);
    });
  });

  it("ALWAYS asks the caller to cancel any pending live-search debounce (the fix invariant)", () => {
    // Enter is a deliberate submit — whichever branch it takes, the pending debounced keyword search
    // must be cancelled so it can't bump the request generation and supersede the run Enter starts.
    for (const s of [
      state({ resultCount: 0 }),
      state({ resultCount: 4 }),
      state({ promptMode: true }),
      state({ regex: true }),
      state({ hasQuery: false }),
      state({ resultCount: 4, forceAi: true }),
      state({ regex: true, forceAi: true }),
    ]) {
      expect(planEnter(s).cancelPendingLiveSearch).toBe(true);
    }
  });
});

// Deterministic model of SearchView's request-generation + pending-debounce interplay, proving the
// regression and its fix without a DOM. `gen` is the monotonic generation, bumped when a run STARTS
// (mirroring `searchGen++` at the top of runSearch/runPromptSearch — a debounce bumps it only when it
// *fires*, not when armed). A response applies only if its captured gen still equals `gen` (mirrors
// SearchView's `if (gen !== searchGen) return`).
describe("generation-guard: pending debounce vs. Enter-escalation", () => {
  function makeModel() {
    const m = {
      gen: 0,
      results: [] as string[],
      /** The armed live keyword-search debounce; calling it is the timer firing. */
      pending: null as null | (() => void),
      /** Arm the debounce (a keystroke) — does NOT bump gen; only firing does. */
      armKeyword() {
        m.pending = () => {
          m.gen++;
          const g = m.gen;
          // The keyword run finds nothing (the zero-hit case that escalated to AI).
          return () => { if (g === m.gen) m.results = []; };
        };
      },
      /** Start the AI prompt run; returns its response resolver. */
      startPrompt() {
        m.gen++;
        const g = m.gen;
        return () => { if (g === m.gen) m.results = ["ai-hit.md"]; };
      },
    };
    return m;
  }

  it("WITHOUT cancelling the timer, the trailing keyword run clobbers the AI result (the bug)", () => {
    const m = makeModel();
    m.armKeyword();                 // user typed → live keyword search armed
    const aiResolve = m.startPrompt(); // Enter escalates to AI, but leaves the debounce armed
    const kwResolve = m.pending!();    // ~150ms later the debounce fires, bumping gen past the AI run
    m.pending = null;
    aiResolve();                    // AI response now stale (gen bumped) → dropped
    kwResolve();                    // empty keyword response wins
    expect(m.results).toEqual([]);  // AI hit lost — Enter "did nothing"
  });

  it("cancelling the pending timer (the fix) lets the AI result win", () => {
    const m = makeModel();
    m.armKeyword();
    m.pending = null;               // the fix: Enter cancels the pending debounce before escalating
    const aiResolve = m.startPrompt();
    aiResolve();
    expect(m.results).toEqual(["ai-hit.md"]); // AI result rendered
  });
});

// BUG #8 (6th bounce): `isNaturalLanguageQuery` is the shared "is this a real question, not a
// filename fragment" gate the Cmd+O switcher's escalation decision (palette/switcherAi.ts) reuses
// instead of re-inventing — see the comment above the function for why the switcher needs this at
// all (fuzzy filename matching is lenient, so a one/two-word miss is still plausibly a garbled
// filename attempt).
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
