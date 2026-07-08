// app/src/palette/switcherAi.ts
//
// Pure escalation decision + request-lifecycle reducer for the Cmd+O switcher's "ask Bismuth AI"
// affordance (BUG #8). Since the search-surface unification (7th round: "the search tab and the
// cmd+o should be the same thing") the switcher IS the app's only search UX, so this module is
// the one home of the AI-escalation logic — the former Search tab (SearchView.tsx/searchEnter.ts)
// is gone. Extracted from the component (no Solid, no DOM, no api client) so every piece is
// unit-testable in isolation; the row merge + Enter plan live next door in switcherModel.ts.
import type { SearchResult } from "../searchOpts";

// A query only "counts" as a natural-language question once it has a few words. Both the fuzzy
// FILENAME match (rankItems.ts) and the keyword CONTENT match (/search) are lenient, so a short
// one/two-word miss is still very plausibly a garbled attempt at a filename or keyword — not a
// question for Bismuth AI.
const MIN_WORDS_FOR_AI_ESCALATION = 3;

/** True once `query` has more than a couple words — gates the "Press Enter to ask Bismuth AI"
 *  affordance so a short fuzzy-filename/keyword miss doesn't immediately escalate to AI. */
export function isNaturalLanguageQuery(query: string): boolean {
  return query.trim().split(/\s+/).filter(Boolean).length >= MIN_WORDS_FOR_AI_ESCALATION;
}

/**
 * Whether the switcher should offer "ask Bismuth AI" for the current query — as the empty-state
 * affordance (replacing "No matching files") AND as what Enter does when the unified result list
 * (fuzzy file matches + keyword content matches) is empty. `matchCount` is the number of rows
 * currently shown.
 */
export function shouldOfferAiEscalation(query: string, matchCount: number): boolean {
  return matchCount === 0 && isNaturalLanguageQuery(query);
}

export type SwitcherAiPhase = "idle" | "loading" | "results" | "error";

export interface SwitcherAiState {
  phase: SwitcherAiPhase;
  /** Monotonic request generation. Bumped by both "ask" and "reset" so a stale "resolved"/
   *  "rejected" event (superseded by a newer ask, a keystroke, or Escape/close) is dropped rather
   *  than clobbering fresher state — mirrors SearchView's `if (gen !== searchGen) return` idiom,
   *  as reducer state instead of a bare closure variable. This is the pure model backing the
   *  "a new keystroke cancels/ignores the in-flight AI result" requirement. */
  gen: number;
  results: SearchResult[];
  error: string | null;
}

export const initialSwitcherAiState: SwitcherAiState = { phase: "idle", gen: 0, results: [], error: null };

export type SwitcherAiEvent =
  // Enter on a non-trivial, zero-match query → start a new AI request.
  | { type: "ask" }
  // A new keystroke, Escape, or the switcher closing → drop back to idle and invalidate any
  // in-flight request (bumps gen so its eventual resolved/rejected event is ignored).
  | { type: "reset" }
  // The AI request for generation `gen` came back with `results` (possibly empty).
  | { type: "resolved"; gen: number; results: SearchResult[] }
  // The AI request for generation `gen` failed with `message` (the backend's own error text).
  | { type: "rejected"; gen: number; message: string };

/** Pure reducer for the switcher's one-shot AI turn. See field docs on SwitcherAiState/Event. */
export function switcherAiReducer(state: SwitcherAiState, event: SwitcherAiEvent): SwitcherAiState {
  switch (event.type) {
    case "ask":
      return { phase: "loading", gen: state.gen + 1, results: [], error: null };
    case "reset":
      return { phase: "idle", gen: state.gen + 1, results: [], error: null };
    case "resolved":
      if (event.gen !== state.gen) return state; // superseded — ignore
      return { ...state, phase: "results", results: event.results, error: null };
    case "rejected":
      if (event.gen !== state.gen) return state; // superseded — ignore
      return { ...state, phase: "error", error: event.message };
  }
}
