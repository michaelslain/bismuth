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
//
// The THIRD bug (BUG #8, REOPENED): "no files found, I press Enter, it does not do prompt."
// The escalate decision read `resultCount` — the number of results CURRENTLY shown. But
// literal keyword search is debounced ~150ms, so when the user types a zero-hit query and
// presses Enter (well within 150ms, or while refining a prior search), the shown results
// still belong to the PREVIOUS query — usually non-empty. `resultCount === 0` was therefore
// false, Enter chose "keyword", and the AI never fired (the debounced search then resolved
// to zero and merely showed the empty state). The guard is `resultsStale`: when the shown
// results don't reflect the CURRENT query, `resultCount` is untrustworthy, so Enter runs the
// keyword search for the current query and escalates to AI iff THAT fresh result is empty
// ("keyword-escalate"). Fresh zero-hit queries still escalate immediately ("escalate-ai").

export type EnterAction =
  // Already in AI mode → run the prompt search for the current query.
  | "prompt"
  // Regex mode is Enter-gated (never live) → run the keyword/regex search.
  | "regex"
  // Literal mode → escalate to the AI prompt search (fresh zero keyword hits, or Cmd/Ctrl+Enter).
  | "escalate-ai"
  // Literal mode, shown results are STALE (a live keyword search for the current query hasn't
  // resolved yet) → run the keyword search NOW and escalate to AI iff it comes back empty.
  | "keyword-escalate"
  // Literal mode with hits (or empty query) → re-run the keyword search.
  | "keyword";

export interface EnterState {
  /** AI ("Bismuth AI") prompt mode is active. */
  promptMode: boolean;
  /** Regex search mode is active. */
  regex: boolean;
  /** The query box is non-empty. */
  hasQuery: boolean;
  /** Number of results currently shown (0 = no keyword hits). Trust only when `!resultsStale`. */
  resultCount: number;
  /**
   * The shown results do NOT reflect the current query text — a live keyword search is still
   * pending/in-flight (the user pressed Enter within the ~150ms debounce, before the search for
   * the current query resolved). When true, `resultCount` belongs to a PRIOR query and must not
   * be trusted: Enter runs the keyword search for the current query and escalates to AI only if
   * THAT comes back empty ("keyword-escalate"). This is the reopened BUG #8 — pressing Enter right
   * after typing a zero-hit query read a stale non-empty `resultCount`, chose "keyword", and never
   * reached the AI. Optional (defaults false = the shown results are fresh for the current query).
   */
  resultsStale?: boolean;
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

// BUG #8 (6th bounce): every prior fix targeted the Search TAB (SearchView.tsx, above) — but the
// user searches from the Cmd+O quick-switcher takeover instead (app/src/palette/SwitcherBar.tsx),
// which never had an AI escalation path at all. The switcher's "no matches" signal is weaker than
// the Search tab's zero-keyword-hits: fuzzy FILENAME matching (rankItems.ts) is lenient, so a
// one/two-word miss is still very plausibly a garbled attempt at a filename, not a question for
// Bismuth AI. `isNaturalLanguageQuery` is the shared "is this shaped like a real question" gate —
// extracted here (not re-invented in palette/) so the switcher's escalation decision
// (palette/switcherAi.ts) reuses the exact same notion of "non-trivial query" this module already
// reasons about, rather than growing a second, subtly-different heuristic.
const MIN_WORDS_FOR_AI_ESCALATION = 3;

/** True once `query` has more than a couple words — used to gate the switcher's "Press Enter to
 *  ask Bismuth AI" affordance so a short fuzzy-filename miss doesn't immediately escalate to AI. */
export function isNaturalLanguageQuery(query: string): boolean {
  return query.trim().split(/\s+/).filter(Boolean).length >= MIN_WORDS_FOR_AI_ESCALATION;
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
  } else if (s.resultsStale) {
    // Literal mode, but the shown results are for a PRIOR query (the live search hasn't caught up).
    // Don't trust `resultCount`: run the keyword search for the CURRENT query, and let its fresh
    // empty/non-empty outcome decide whether to escalate to the AI. This is the reopened BUG #8 fix.
    action = "keyword-escalate";
  } else if (s.resultCount === 0) {
    // Literal mode, non-empty query, fresh zero keyword hits → escalate to the AI prompt search.
    action = "escalate-ai";
  } else {
    // Literal mode with hits → re-run the keyword search (the persistent "Ask Bismuth AI"
    // button / Sparkles chip / Cmd+Enter are the AI paths from here).
    action = "keyword";
  }
  return { action, cancelPendingLiveSearch: true };
}
