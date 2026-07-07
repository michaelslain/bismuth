// app/src/searchEnter.test.ts
import { describe, expect, it } from "bun:test";
import { planEnter, type EnterState } from "./searchEnter";

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

  it("ALWAYS asks the caller to cancel any pending live-search debounce (the fix invariant)", () => {
    // Enter is a deliberate submit — whichever branch it takes, the pending debounced keyword search
    // must be cancelled so it can't bump the request generation and supersede the run Enter starts.
    for (const s of [
      state({ resultCount: 0 }),
      state({ resultCount: 4 }),
      state({ promptMode: true }),
      state({ regex: true }),
      state({ hasQuery: false }),
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
