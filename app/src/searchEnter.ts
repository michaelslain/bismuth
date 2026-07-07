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

export type EnterAction =
  // Already in AI mode → run the prompt search for the current query.
  | "prompt"
  // Regex mode is Enter-gated (never live) → run the keyword/regex search.
  | "regex"
  // Literal mode, non-empty query, zero keyword hits → escalate to the AI prompt search.
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
  const action: EnterAction = s.promptMode
    ? "prompt"
    : s.regex
      ? "regex"
      : s.hasQuery && s.resultCount === 0
        ? "escalate-ai"
        : "keyword";
  return { action, cancelPendingLiveSearch: true };
}
