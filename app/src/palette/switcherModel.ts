// app/src/palette/switcherModel.ts
//
// Pure model for the UNIFIED Cmd+O search surface (#8, 7th round: "the search tab and the cmd+o
// should be the same thing. all of it should be how cmd+o works."). The switcher shows ONE list:
//   1. fuzzy FILE-NAME matches (rankItems.ts — switch to the file), then
//   2. keyword CONTENT matches (POST /search — open the note at the match), then
//   3. the Bismuth AI escalation on zero/weak results (switcherAi.ts).
// This module owns the two pure decisions the component needs — which content rows are visible,
// and what Enter does — so both are unit-testable without Solid/DOM (switcherModel.test.ts).
import type { SearchResult } from "../searchOpts";
import type { SwitcherAiPhase } from "./switcherAi";

/** The stored outcome of the debounced content (keyword) search: the query it ran FOR plus its
 *  results. Keeping the query alongside the results is the staleness guard (see visibleContent). */
export interface ContentHits {
  query: string;
  results: SearchResult[];
}

/**
 * The content-match rows to render under the file-name matches.
 *
 * - FRESHNESS: content search is debounced (~150ms) + async, so `stored` may belong to a PRIOR
 *   query. Stale rows must not render (or be Enter-openable) under a newer query — this is the
 *   same "stale results" family of bugs the old Search tab kept reopening (#8), solved here by
 *   construction: rows only show when they were computed for exactly the current query.
 * - DEDUPE: a note whose NAME already matched (a file row) is dropped from the content rows —
 *   one list, one row per note; the file-name row (which opens the same note) wins.
 */
export function visibleContent(
  stored: ContentHits | null,
  currentQuery: string,
  fileMatchPaths: readonly string[],
): SearchResult[] {
  if (!stored || stored.query !== currentQuery) return [];
  const taken = new Set(fileMatchPaths);
  return stored.results.filter((r) => !taken.has(r.path));
}

export type SwitcherEnterAction =
  // Open the currently highlighted row (file / content / AI result) — the caller's menu-nav
  // Enter handling does this; "commit" means "let it".
  | "commit"
  // Run the one-shot Bismuth AI prompt search for the current query.
  | "ask-ai"
  // Swallow the keypress (nothing sensible to do).
  | "none";

export interface SwitcherEnterState {
  /** The query box is non-empty. */
  hasQuery: boolean;
  /** isNaturalLanguageQuery(query) — the query is question-shaped (3+ words). */
  shaped: boolean;
  /** Rows currently visible to the menu nav: file+content rows in the idle phase, AI result
   *  rows in the results phase. (Loading/error phases show no navigable rows.) */
  rowCount: number;
  /** The AI request lifecycle phase (switcherAi.ts reducer). */
  aiPhase: SwitcherAiPhase;
  /** Cmd/Ctrl+Enter — force the AI prompt search even when rows are showing. The always-
   *  reachable AI path folded in from the old Search tab (a natural-language query usually
   *  still has SOME keyword hit, which would otherwise make Enter commit forever). */
  forceAi?: boolean;
}

/**
 * What pressing Enter in the unified switcher does. Precedence:
 *  1. An in-flight AI turn swallows Enter (no double-fire; a keystroke or Esc cancels instead).
 *  2. Cmd/Ctrl+Enter always reaches the AI (with any non-empty query).
 *  3. Rows showing → commit the highlighted row.
 *  4. Zero rows + question-shaped query → escalate to Bismuth AI (idle), or retry it (error).
 *  5. Otherwise nothing.
 */
export function planSwitcherEnter(s: SwitcherEnterState): SwitcherEnterAction {
  if (s.aiPhase === "loading") return "none";
  if (s.forceAi && s.hasQuery) return "ask-ai";
  if (s.rowCount > 0) return "commit";
  if (s.hasQuery && s.shaped && (s.aiPhase === "idle" || s.aiPhase === "error")) return "ask-ai";
  return "none";
}
