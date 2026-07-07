// app/src/editor/findPanel.ts
// In-editor "Find" bar (default Cmd/Ctrl+F). A custom CodeMirror search panel wired
// through @codemirror/search, so we get match highlighting + next/prev navigation for
// free while fully owning the bar's look (it matches the app, not CM's stock panel).
//
// Why a custom `createPanel` rather than a Solid overlay: @codemirror/search only
// highlights matches while a *panel* is registered as open — its highlighter returns
// `Decoration.none` when `state.panel` is null. Supplying `createPanel` keeps that
// highlighting alive and keeps the query/selection plumbing inside CodeMirror, while
// the DOM we build is ours to style. The keybinding itself is owned by Editor.tsx
// (reads settings.keybindings.find) so it's user-rebindable like every other shortcut.

import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { type EditorState, type StateEffect, type Text } from "@codemirror/state";
import {
  search,
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  closeSearchPanel,
} from "@codemirror/search";
import { groupTableBlocks } from "./tableModel";
import { activeTableField, setActiveTableEffect } from "./tableState";

// Cap the count scan so a 1-char query in a huge doc can't stall the UI.
const MAX_COUNT = 10000;

/** Total matches of `query` in the doc, and the 1-based index of the one currently
 *  selected (0 when the selection isn't sitting on a match). */
function matchStats(view: EditorView, query: SearchQuery): { total: number; current: number } {
  if (!query.valid) return { total: 0, current: 0 };
  const sel = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let total = 0;
  let current = 0;
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++;
    const m = r.value;
    if (m && m.from === sel.from && m.to === sel.to) current = total;
    if (total >= MAX_COUNT) break;
  }
  return { total, current };
}

/** The match range at/after `pos` (wrapping to the doc start when nothing matches from `pos`
 *  onward), or null when the query is invalid/empty or the doc has no match at all. Pure over
 *  the state + query — this is the range the find bar selects + scrolls to on every keystroke,
 *  factored out of the DOM-coupled panel so the "Cmd+F selects the match" behavior is unit-tested.
 *  Searching from the match START (not its end) means refining the query keeps you on the current
 *  match instead of skipping past it. */
export function nextMatchFrom(
  state: EditorState,
  query: SearchQuery,
  pos: number,
): { from: number; to: number } | null {
  if (!query.valid) return null;
  let cursor = query.getCursor(state, pos);
  let r = cursor.next();
  if (r.done) {
    cursor = query.getCursor(state, 0); // wrap to the start of the doc
    r = cursor.next();
  }
  return r.done ? null : { from: r.value.from, to: r.value.to };
}

/** Interval-overlap test for #21: the START LINE of the first table block whose source
 *  character span overlaps the (half-open) range `[from, to)`, or null when the range
 *  touches no block. Pure over the block spans so the "does a search match land inside a
 *  table" logic is unit-tested without an EditorView. A match that merely ABUTS a block
 *  boundary (ends exactly at its start, or starts exactly at its end) is NOT inside it. */
export function tableBlockAtRange(
  blocks: { from: number; to: number; startLine: number }[],
  from: number,
  to: number,
): number | null {
  for (const b of blocks) {
    if (from < b.to && to > b.from) return b.startLine;
  }
  return null;
}

/** The header (start) line of the rendered table block a doc-offset range falls inside,
 *  or null. Wraps `groupTableBlocks` + `tableBlockAtRange`: a GFM table is drawn as an
 *  atomic block-replace WIDGET that hides its source lines, so a search match landing on
 *  those lines is invisible — the find bar uses this to know when it must reveal that
 *  block's raw source (via `setActiveTableEffect`) so the highlight actually shows (#21). */
export function tableBlockStartForRange(doc: Text, from: number, to: number): number | null {
  const { blocks } = groupTableBlocks(doc);
  const spans = blocks.map((b) => ({
    from: doc.line(b.startLine).from,
    to: doc.line(b.endLine).to,
    startLine: b.startLine,
  }));
  return tableBlockAtRange(spans, from, to);
}

/** Decide how the find bar's table reveal must change when the active match lands on `[from, to)`
 *  (#31). Pure so the reveal lifecycle is unit-tested without an EditorView.
 *   - `target`: the table block (header line) the match is genuinely INSIDE, or null when the
 *     match is not in any table (normal Cmd+F over prose → never touches a table).
 *   - `reveal`: the block to newly flip to source — `target` when it isn't ALREADY the active
 *     (revealed) block, else null (already shown → nothing to dispatch).
 *  The find bar reveals `reveal` (if non-null); `nextOwnedTable` derives what it must revert. */
export function tableRevealDecision(
  blocks: { from: number; to: number; startLine: number }[],
  from: number,
  to: number,
  activeTable: number | null,
): { target: number | null; reveal: number | null } {
  const target = tableBlockAtRange(blocks, from, to);
  return { target, reveal: target != null && target !== activeTable ? target : null };
}

/** Next value of the "table block the find bar OWNS (and must revert on close / move)" tracker,
 *  given the reveal decision for the match it just landed on (#31). Find only owns a block it
 *  itself revealed:
 *   - the match left ALL tables (`target == null`) → own nothing;
 *   - find dispatched a reveal (`reveal != null`) → own `target`;
 *   - the match is inside a block that was ALREADY active — keep the prior claim. If find owned
 *     it, it stays owned; if the USER opened it manually (find never revealed it, so `prevOwned`
 *     is null / a different block), find does NOT claim it, so closing the bar leaves a
 *     manually-revealed table alone. When find is mid-navigation among matching tables
 *     (`prevOwned != null`) it refreshes ownership to the current block, so an auto-switch from
 *     one matching table to another is still reverted on close. */
export function nextOwnedTable(
  prevOwned: number | null,
  decision: { target: number | null; reveal: number | null },
): number | null {
  if (decision.target == null) return null;
  if (decision.reveal != null) return decision.target;
  return prevOwned != null ? decision.target : prevOwned;
}

/** Full reveal reconcile for the find bar's ACTIVE match — or `null` when the query has no match at
 *  all (empty / typo'd query) (#31). This is the piece the PRIOR fix missed: it scoped the REVEAL
 *  correctly but left the REVERT implicit, relying on `activeTableField` auto-clearing once a
 *  *dispatched selection* leaves the block. On the no-match path the find bar dispatches nothing, so
 *  that auto-clear never fires and a table revealed by an earlier (matching) keystroke stays STUCK in
 *  raw source (the "Cmd+F flipped my table to source" the user still saw). Making the revert explicit
 *  here fixes it. Pure so the whole lifecycle is unit-tested without an EditorView.
 *   - `reveal`: a table (header line) to newly flip to source, or null.
 *   - `revert`: flip the find bar's OWN revealed table back to a widget (dispatch
 *     `setActiveTableEffect.of(null)`). Only ever the table find owns AND that is currently active, so
 *     a manually-opened ("Edit source") table — which find never owned — is never collapsed.
 *   - `owned`: the next value of the find-owned-table tracker.
 *  Transitions: a match inside a not-active table → reveal + own it; a match inside the already-active
 *  table → keep (own it only if find was mid-navigation, never claiming a manually-opened one); a
 *  match in prose OR no match at all → revert the find-owned table (if any) and own nothing. */
export function reconcileTableReveal(
  blocks: { from: number; to: number; startLine: number }[],
  match: { from: number; to: number } | null,
  active: number | null,
  owned: number | null,
): { reveal: number | null; revert: boolean; owned: number | null } {
  if (match) {
    const decision = tableRevealDecision(blocks, match.from, match.to, active);
    if (decision.target != null) {
      return { reveal: decision.reveal, revert: false, owned: nextOwnedTable(owned, decision) };
    }
    // match landed in prose (no table): fall through to the revert branch.
  }
  // No match, or a prose match: flip find's OWN table back iff it's the one currently showing source.
  return { reveal: null, revert: owned != null && owned === active, owned: null };
}

// Lucide-style inline icons (the registry renders Solid components; the panel is raw
// DOM, so we inline the same paths).
const ICONS = {
  prev: '<path d="m18 15-6-6-6 6"/>',
  next: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
};

function iconButton(svgPath: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "bismuth-find-btn";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
  return b;
}

/** Build the find bar for a view. Conforms to CodeMirror's `Panel` contract so
 *  openSearchPanel/closeSearchPanel manage its lifecycle. */
export function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "bismuth-find";
  // Keys typed in the bar are the bar's business — don't let them bubble to the
  // editor's keymap or App.tsx's global shortcut handler.
  dom.addEventListener("keydown", (e) => e.stopPropagation());
  dom.addEventListener("mousedown", (e) => e.stopPropagation());

  const input = document.createElement("input");
  input.className = "bismuth-find-input";
  input.placeholder = "Find";
  input.setAttribute("aria-label", "Find in note");
  // NOTE: intentionally NOT tagged `main-field`. CM's findNext/findPrevious end by
  // calling selectSearchInput(), which select-all's the `main-field` element. Since we
  // run a search on every keystroke, that would make each new character replace the whole
  // query (the "one character at a time" bug). We manage focus ourselves (mount() +
  // Editor.tsx's onFindKey), so opting out of CM's field auto-management is what we want.

  const count = document.createElement("span");
  count.className = "bismuth-find-count";

  const prevBtn = iconButton(ICONS.prev, "Previous match (Shift+Enter)");
  const nextBtn = iconButton(ICONS.next, "Next match (Enter)");

  const caseBtn = document.createElement("button");
  caseBtn.type = "button";
  caseBtn.className = "bismuth-find-btn bismuth-find-case";
  caseBtn.textContent = "Aa";
  caseBtn.title = "Match case";
  caseBtn.setAttribute("aria-label", "Match case");

  const closeBtn = iconButton(ICONS.close, "Close (Esc)");

  dom.append(input, count, prevBtn, nextBtn, caseBtn, closeBtn);

  let caseSensitive = getSearchQuery(view.state).caseSensitive;

  const updateCount = () => {
    const q = getSearchQuery(view.state);
    if (!q.search) {
      count.textContent = "";
      count.classList.remove("bismuth-find-empty");
      return;
    }
    const { total, current } = matchStats(view, q);
    count.textContent = total === 0 ? "No results" : `${current || "–"}/${total}`;
    count.classList.toggle("bismuth-find-empty", total === 0);
  };

  // The GFM table blocks in the doc as {from,to,startLine} char spans — input to the pure
  // reveal decision. Recomputed per reveal (cheap) so edits above a table don't desync it.
  const tableSpans = (): { from: number; to: number; startLine: number }[] => {
    const doc = view.state.doc;
    return groupTableBlocks(doc).blocks.map((b) => ({
      from: doc.line(b.startLine).from,
      to: doc.line(b.endLine).to,
      startLine: b.startLine,
    }));
  };

  // The table block (header line) THIS find bar has flipped to raw source and must flip back —
  // when the active match leaves it, or the bar closes (#31). Null when find hasn't revealed a
  // table, so closing the bar NEVER collapses a table the user opened manually ("Edit source").
  let findRevealed: number | null = null;

  // Reconcile the table reveal for the match the find bar just landed on (or `null` when the query
  // has NO match): return the effect(s) to fold into the dispatch, plus a `park` line-offset to move
  // the caret to when we REVERT (so it isn't stranded inside a re-widgetized atomic table). Both a
  // reveal AND a revert are explicit here — the revert no longer relies on `activeTableField`'s
  // implicit auto-clear (which never fires when the query stops matching, so a find-revealed table
  // would otherwise stay stuck in source, #31). Only a match GENUINELY inside a table flips it to
  // source; a prose match reveals nothing and reverts find's own table; a manually-opened ("Edit
  // source") table is never touched (find only ever reverts a block it itself revealed).
  const reconcileReveal = (match: { from: number; to: number } | null): { effects: StateEffect<unknown>[]; park: number | null } => {
    const active = view.state.field(activeTableField, false) ?? null;
    const prevOwned = findRevealed;
    const r = reconcileTableReveal(tableSpans(), match, active, prevOwned);
    findRevealed = r.owned;
    if (r.reveal != null) return { effects: [setActiveTableEffect.of(r.reveal) as StateEffect<unknown>], park: null };
    if (r.revert) {
      const doc = view.state.doc;
      const park = prevOwned != null && prevOwned >= 1 && prevOwned <= doc.lines ? doc.line(prevOwned).from : null;
      return { effects: [setActiveTableEffect.of(null) as StateEffect<unknown>], park };
    }
    return { effects: [], park: null };
  };

  // Flip a table the find bar itself revealed BACK to its rendered widget (a manually-opened one
  // is left alone) and park the caret just before it — so closing the bar returns that block to
  // normal (#31). No-op unless find still owns the currently-active table.
  const revertFindReveal = () => {
    const active = view.state.field(activeTableField, false) ?? null;
    if (findRevealed == null || findRevealed !== active) {
      findRevealed = null;
      return;
    }
    const start = findRevealed;
    findRevealed = null;
    const doc = view.state.doc;
    const anchor = start >= 1 && start <= doc.lines ? doc.line(start).from : view.state.selection.main.from;
    view.dispatch({ selection: { anchor }, effects: setActiveTableEffect.of(null) });
  };

  // Close the bar: revert a find-revealed table FIRST (its own transaction), then tear down the
  // panel and return focus to the editor.
  const closeBar = () => {
    revertFindReveal();
    closeSearchPanel(view);
    view.focus();
  };

  // Move the editor selection to the nearest match at/after `pos` (wrapping to the top),
  // WITHOUT touching the input. We reveal matches ourselves on the typing path instead of
  // calling CM's findNext, because findNext select-all's the search field on every call —
  // which would clobber what the user is typing. Searching from the match START (not its
  // end) means refining the query keeps you on the current match instead of skipping it.
  const revealFrom = (pos: number) => {
    const m = nextMatchFrom(view.state, getSearchQuery(view.state), pos);
    // Reconcile EVEN when there's no match: an empty / non-matching query must still flip a
    // find-revealed table back to a widget instead of leaving it stuck in source (#31).
    const { effects, park } = reconcileReveal(m);
    if (!m) {
      // No match → don't move the selection to a match, but DO apply a pending revert (parking the
      // caret at the reverted table's start so it isn't left inside the re-widgetized atomic block).
      if (effects.length) view.dispatch(park != null ? { selection: { anchor: park }, effects } : { effects });
      return;
    }
    view.dispatch({
      selection: { anchor: m.from, head: m.to },
      effects: [EditorView.scrollIntoView(m.to, { y: "center" }), ...effects],
      userEvent: "select.search",
    });
  };

  // findNext / findPrevious (Enter + the prev/next buttons) are CodeMirror's own commands:
  // they move the selection but don't know about our table widgets, so a jumped-to match inside
  // a table (when none was open) would stay hidden behind its widget. After one runs, reconcile
  // the reveal under the NEW selection — flipping the match's table to source (re-scrolling) and
  // tracking it so it's reverted on close.
  const revealTableAtSelection = () => {
    const sel = view.state.selection.main;
    const { effects, park } = reconcileReveal({ from: sel.from, to: sel.to });
    if (!effects.length) return;
    view.dispatch({
      selection: park != null ? { anchor: park } : undefined,
      effects: [...effects, EditorView.scrollIntoView(sel.to, { y: "center" }) as StateEffect<unknown>],
    });
  };

  // Push the input's text as the active query (live highlight) and reveal the nearest match.
  const runQuery = () => {
    const from = view.state.selection.main.from;
    const q = new SearchQuery({ search: input.value, caseSensitive, literal: true });
    view.dispatch({ effects: setSearchQuery.of(q) });
    revealFrom(from);
    updateCount();
  };

  input.addEventListener("input", runQuery);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
      revealTableAtSelection();
      updateCount();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeBar();
    }
  });
  prevBtn.addEventListener("click", () => {
    findPrevious(view);
    revealTableAtSelection();
    updateCount();
    input.focus();
  });
  nextBtn.addEventListener("click", () => {
    findNext(view);
    revealTableAtSelection();
    updateCount();
    input.focus();
  });
  caseBtn.addEventListener("click", () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle("bismuth-find-active", caseSensitive);
    runQuery();
    input.focus();
  });
  closeBtn.addEventListener("click", closeBar);

  return {
    dom,
    top: true,
    mount() {
      // openSearchPanel seeds the query from the selection (single-line, <100 chars);
      // reflect whatever's active so the input + count are correct on open.
      const q = getSearchQuery(view.state);
      if (q.search) input.value = q.search;
      caseSensitive = q.caseSensitive;
      caseBtn.classList.toggle("bismuth-find-active", caseSensitive);
      updateCount();
      input.focus();
      input.select();
    },
    update(u: ViewUpdate) {
      const queryChanged = u.transactions.some((t) => t.effects.some((ef) => ef.is(setSearchQuery)));
      if (!u.docChanged && !u.selectionSet && !queryChanged) return;
      // An external query change (e.g. a re-open seeded from a new selection) should
      // sync into the field — but never clobber what the user is actively typing.
      if (queryChanged && document.activeElement !== input) {
        const cur = getSearchQuery(u.state);
        if (cur.search !== input.value) input.value = cur.search;
      }
      updateCount();
    },
  };
}

/** The editor extension that enables in-editor find with our custom bar. */
export function findExtension() {
  return search({ top: true, literal: true, createPanel: createFindPanel });
}
