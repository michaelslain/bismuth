// app/src/palette/switcherAi.ts
//
// Pure escalation decision + request-lifecycle reducer for the Cmd+O switcher's "ask Bismuth AI"
// affordance (BUG #8, 6th bounce). See SwitcherBar.tsx for the full story: every earlier fix
// targeted the Search TAB (SearchView.tsx / searchEnter.ts), but the user only ever searches from
// the switcher, which never had an AI escalation path. Extracted to its own module (no Solid, no
// DOM, no api client) so both pieces are unit-testable in isolation — same idiom as searchEnter.ts.
import { isNaturalLanguageQuery } from "../searchEnter";
import type { SearchResult } from "../searchOpts";

/**
 * Whether the switcher should offer "ask Bismuth AI" for the current query — as the empty-state
 * affordance (replacing "No matching files") AND as what Enter does when the fuzzy file list is
 * empty. `matchCount` is the number of fuzzy FILENAME matches currently shown (rankItems.ts).
 *
 * Fuzzy filename matching is lenient (typo-tolerant, substring/subsequence), so zero matches is
 * already a fairly strong "this isn't a filename" signal on its own — but a short one/two-word
 * miss is still very plausibly a garbled attempt at a filename (a real note whose name doesn't
 * quite match), not a natural-language question. `isNaturalLanguageQuery` (searchEnter.ts) gates
 * on word count so the AI affordance only appears for genuinely question-shaped queries.
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
