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
//
// TABLES: a GFM table renders as an atomic block-replace widget that HIDES its source, so a
// match on a table line is invisible behind the widget. The find bar does NOT flip the table to
// raw markdown source (the rejected "cmd+f converts my table to source, which is stupid" behavior,
// #31); instead `tableFindHighlight` (editor/tableWidget.ts) marks matches IN PLACE inside the
// rendered table DOM and scrolls the active one into view. So this file carries ZERO table-reveal
// logic — find just moves the selection like anywhere else, and the widget highlighter reacts to it.

import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { type EditorState } from "@codemirror/state";
import {
  search,
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  closeSearchPanel,
} from "@codemirror/search";

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

  // Close the bar and return focus to the editor. Tables never need "un-revealing": the in-place
  // table highlighter (tableFindHighlight) clears its own marks the moment the panel closes (#31).
  const closeBar = () => {
    closeSearchPanel(view);
    view.focus();
  };

  // Move the editor selection to the nearest match at/after `pos` (wrapping to the top),
  // WITHOUT touching the input. We reveal matches ourselves on the typing path instead of
  // calling CM's findNext, because findNext select-all's the search field on every call —
  // which would clobber what the user is typing. Searching from the match START (not its
  // end) means refining the query keeps you on the current match instead of skipping it.
  // A match inside a table is highlighted in place by tableFindHighlight; scrolling the
  // selection into view brings the containing table widget into view too.
  const revealFrom = (pos: number) => {
    const m = nextMatchFrom(view.state, getSearchQuery(view.state), pos);
    if (!m) return; // no match → leave the selection where it is
    view.dispatch({
      selection: { anchor: m.from, head: m.to },
      effects: EditorView.scrollIntoView(m.to, { y: "center" }),
      userEvent: "select.search",
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
      updateCount();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeBar();
    }
  });
  prevBtn.addEventListener("click", () => {
    findPrevious(view);
    updateCount();
    input.focus();
  });
  nextBtn.addEventListener("click", () => {
    findNext(view);
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
