// app/src/searchEnter.ts
//
// Pure decision for what pressing Enter in the Search tab should do, extracted so
// it can be unit-tested without loading SearchView (which pulls in lucide / the api
// client / an EventSource at module load) — same idiom as `fileTreeRefresh.ts`.
//
// The regression this guards (see searchEnter.test.ts): live keyword search is
// debounced on every keystroke, and each run bumps a monotonic request
// "generation" so a late response for a superseded query is dropped. When Enter
// escalates a zero-hit keyword query to the AI prompt search, the debounce armed by
// the *last* keystroke is still pending. If it isn't cancelled it fires ~150ms
// later, bumps the generation, and supersedes the in-flight AI request (its
// response is discarded) while overwriting the results with the empty keyword set —
// so Enter appears to do nothing. Hence `cancelPendingLiveSearch` is always true:
// Enter is a deliberate submit and must cancel any armed live search first.
//
// The SECOND bug this now guards (BUG #8): the AI path used to be reachable by Enter
// ONLY when a literal query produced ZERO keyword hits. But natural-language questions
// ("where did I write about metals") usually DO match some literal keyword, so results
// wasn't empty, plain Enter just re-ran keyword search, and the AI never triggered. The
// fix is `forceAi` (Cmd/Ctrl+Enter): a modified Enter ALWAYS runs the AI prompt search,
// regardless of mode or how many keyword hits are showing — one obvious, unconditional
// way to reach AI that never depends on the zero-results condition. (SearchView also
// exposes a persistent "Ask Bismuth AI" button + the Sparkles chip for the same thing.)

export type EnterAction =
  // Already in AI mode → run the prompt search for the current query.
  | "prompt"
  // Regex mode is Enter-gated (never live) → run the keyword/regex search.
  | "regex"
  // Literal mode → escalate to the AI prompt search (zero keyword hits, or Cmd/Ctrl+Enter).
  | "escalate-ai"
  // Literal mode with hits (or empty query) → re-run the keyword search.
  | "keyword";

export interface EnterState {
  /** AI ("Bismuth AI") prompt mode is active. */
  promptMode: boolean;
  /** Regex search mode is active. */
  regex: boolean;
  /** The query box is non-empty. */
  hasQuery: boolean;
  /** Number of results currently shown (0 = no keyword hits). */
  resultCount: number;
  /**
   * The Enter was pressed with Cmd/Ctrl held → force the AI prompt search regardless of
   * mode or keyword-hit count. This is the always-reachable AI path (BUG #8): it does NOT
   * depend on `resultCount === 0`, so a natural-language query that happens to have literal
   * keyword hits can still escalate to the AI with one keystroke. Optional (defaults false).
   */
  forceAi?: boolean;
}

export interface EnterPlan {
  action: EnterAction;
  /**
   * Always true: Enter is a deliberate submit, so any pending live-keyword-search
   * debounce must be cancelled before dispatching, or its trailing run bumps the
   * request generation and supersedes (silently drops) the response of the run Enter
   * starts. This is the fix for the "Enter doesn't trigger the AI search" bug.
   */
  cancelPendingLiveSearch: true;
}

export function planEnter(s: EnterState): EnterPlan {
  let action: EnterAction;
  if (!s.hasQuery) {
    // Nothing to search — re-run keyword search, which just clears/normalizes state.
    action = "keyword";
  } else if (s.forceAi) {
    // Cmd/Ctrl+Enter: ALWAYS run the AI prompt search, even with keyword hits or in
    // regex mode. If already in AI mode just re-run it; otherwise escalate (flips mode on).
    action = s.promptMode ? "prompt" : "escalate-ai";
  } else if (s.promptMode) {
    action = "prompt";
  } else if (s.regex) {
    action = "regex";
  } else if (s.resultCount === 0) {
    // Literal mode, non-empty query, zero keyword hits → escalate to the AI prompt search.
    action = "escalate-ai";
  } else {
    // Literal mode with hits → re-run the keyword search (the persistent "Ask Bismuth AI"
    // button / Sparkles chip / Cmd+Enter are the AI paths from here).
    action = "keyword";
  }
  return { action, cancelPendingLiveSearch: true };
}
