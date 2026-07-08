// app/src/palette/SwitcherBar.tsx
// The in-window Cmd+O switcher — the NON-modal successor to the old QuickSwitcher overlay.
// Instead of popping a centered modal, App enters "switcher mode": the knowledge graph
// expands to fill the window (the home/new-tab view) and THIS bar sits big at the top where
// the tab strip was. Typing fuzzy-filters vault files (same matching + frecency blend as the
// Cmd+P palette, via rankItems), a live dropdown lists the hits, Enter opens the selected
// file, and Esc leaves switcher mode (App restores the prior view). The full ranked result
// set is reported up (onResultsChange) so App can light up EVERY matching note in the
// backdrop graph while you type — the graph reads as the same surface as the search.
//
// BUG #8 (6th bounce) — Bismuth AI escalation lives HERE, not just in the Search tab: every
// earlier fix (searchEnter.ts / SearchView.tsx) targeted the ::search tab, but the user
// actually searches from THIS surface and never opens the tab. When the fuzzy file list comes
// up empty for a question-shaped query (shouldOfferAiEscalation, palette/switcherAi.ts — reuses
// searchEnter.ts's isNaturalLanguageQuery instead of re-inventing a word-count heuristic),
// pressing Enter (or clicking the CTA) runs the same one-shot Haiku prompt search SearchView
// uses (api.searchPrompt → POST /search-prompt) and renders results with the SAME row component
// SearchView does (SearchResultRows, ../searchResults.tsx) — no forked lookalike (see #49).
import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { Icon } from "../icons/Icon";
import { SearchBar } from "../ui/SearchBar";
import { createMenuNav } from "../ui/popover/createMenuNav";
import { Highlight } from "./PaletteModal";
import { rankItems, type Match } from "./rankItems";
import { vaultFileItems } from "./vaultFileItems";
import { refreshVaultTree, vaultTree } from "../treeStore";
import { loadFrecency, recordUse, scoreOf, fileKey } from "../frecency";
import { api } from "../api";
import { SearchResultRows } from "../searchResults";
import { shouldOfferAiEscalation, switcherAiReducer, initialSwitcherAiState, type SwitcherAiState } from "./switcherAi";
import "../SearchView.css";
import "./switcher.css";

type Props = {
  onClose: () => void;
  openFile: (path: string) => void;
  // The full ranked result set's file paths — App maps them to graph node ids and lights
  // up every matching note in the backdrop graph. Fires on every query change and on close
  // (empty). Empty while the query is blank (don't flood the graph with all frecent files
  // before the user has typed).
  onResultsChange?: (paths: string[]) => void;
};

export function SwitcherBar(props: Props) {
  const [query, setQuery] = createSignal("");
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // Derive items reactively from the pre-warmed cache: the list paints immediately off the
  // last-known tree (no per-open fetch). Still kick a refresh so a missed SSE corrects fast.
  const items = createMemo(() => vaultFileItems(vaultTree()));
  void refreshVaultTree();

  // Snapshot the frecency store once per open (fixed `now` — decay over the seconds the
  // switcher is visible is negligible): an empty query lists most-recently/frequently-opened
  // files first, and frecent files get boosted in fuzzy results (see rankItems blend).
  const store = loadFrecency();
  const now = Date.now();
  const frecency = (path: string) => scoreOf(store[fileKey(path)], now);

  const results = createMemo<Match[]>(() => rankItems(items(), query(), frecency));

  // Bismuth AI escalation state (idle / loading / results / error) — see switcherAi.ts. Only
  // ever entered when the fuzzy match list above is empty; typing (onQueryInput) always resets
  // it back to idle first, so the two result surfaces never show at once.
  const [aiState, setAiState] = createSignal<SwitcherAiState>(initialSwitcherAiState);

  const commit = (item: Match["item"]) => {
    recordUse(fileKey(item.id)); // learn: opening a file boosts it next time
    props.openFile(item.id);
    props.onClose();
  };

  // Open a result returned by Bismuth AI (SearchResultRows already recorded frecency for us).
  const openAiResult = (path: string) => {
    props.openFile(path);
    props.onClose();
  };

  // Run the one-shot AI prompt search for the current query (Enter or the empty-state CTA).
  // Generation-guarded via the reducer so a superseded request (a keystroke fired "reset", or a
  // second ask fired before the first resolved) can't clobber fresher state when it lands late.
  const askAi = () => {
    let gen = 0;
    setAiState((s) => {
      const next = switcherAiReducer(s, { type: "ask" });
      gen = next.gen;
      return next;
    });
    const q = query();
    api.searchPrompt(q)
      .then((r) => setAiState((s) => switcherAiReducer(s, { type: "resolved", gen, results: r })))
      .catch((e) => setAiState((s) =>
        switcherAiReducer(s, { type: "rejected", gen, message: (e as Error).message || "AI search failed" })));
  };

  // Up/Down/Enter/Escape from the shared menu-nav hook — same behaviour as the palette
  // (clamped, not wrapped). Escape leaves switcher mode. Enter only reaches here when there ARE
  // fuzzy file matches (see onKeyDown below, which intercepts Enter on an empty match list).
  const nav = createMenuNav({
    count: () => results().length,
    wrap: false,
    onSelect: (i) => { const r = results()[i]; if (r) commit(r.item); },
    onEscape: () => props.onClose(),
  });
  const selected = nav.active;

  // Reset the highlighted row to the top whenever the query changes.
  createEffect(() => {
    query();
    nav.setActive(0);
  });

  // Keep the highlighted row scrolled into view.
  createEffect(() => {
    selected();
    results();
    listRef?.querySelector<HTMLElement>(".palette-row.selected")?.scrollIntoView({ block: "nearest" });
  });

  // Report the full ranked result set up so the backdrop graph lights up EVERY matching
  // note (not just the active row). Blank query → report nothing so opening Cmd+O doesn't
  // flood the graph with all frecent files before the user has typed.
  createEffect(() => {
    props.onResultsChange?.(query().trim() ? results().map((r) => r.item.id) : []);
  });
  onCleanup(() => props.onResultsChange?.([]));

  // Every keystroke cancels/ignores any in-flight (or already-shown) Bismuth AI result — the
  // query changed, so a stale AI answer for the OLD text must not linger under the new one.
  const onQueryInput = (v: string) => {
    setQuery(v);
    setAiState((s) => switcherAiReducer(s, { type: "reset" }));
  };

  // Enter is only special-cased when the fuzzy file list is EMPTY: escalate to Bismuth AI for a
  // question-shaped query, otherwise do nothing (mirrors createMenuNav's own no-op when nothing
  // is selectable). Any non-empty match list falls straight through to nav.onKeyDown, so file
  // switching keeps working exactly as before.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && results().length === 0) {
      e.preventDefault();
      if (aiState().phase !== "loading" && shouldOfferAiEscalation(query(), 0)) askAi();
      return;
    }
    nav.onKeyDown(e);
  };

  // Same stationary-pointer guard as the palette: don't let a mouseenter under a still
  // cursor steal the keyboard default; only a real mousemove reselects.
  let lastPointer: { x: number; y: number } | undefined;
  const onRowPointerMove = (i: number, e: MouseEvent) => {
    if (lastPointer && lastPointer.x === e.clientX && lastPointer.y === e.clientY) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    nav.setActive(i);
  };

  onMount(() => inputRef?.focus());

  return (
    <div class="switcher-bar" onPointerDown={(e) => e.stopPropagation()}>
      <SearchBar
        class="switcher-search"
        inputClass="switcher-input"
        inputRef={(el) => (inputRef = el)}
        placeholder="Go to file…"
        value={query()}
        onInput={onQueryInput}
        onKeyDown={onKeyDown}
      >
        <kbd class="switcher-esc">esc</kbd>
      </SearchBar>
      <div class="switcher-list" ref={listRef}>
        <Show when={aiState().phase === "idle"}>
          <For each={results()}>
            {(r, i) => (
              <div
                class="palette-row"
                classList={{ selected: selected() === i() }}
                onMouseMove={(e) => onRowPointerMove(i(), e)}
                onClick={() => commit(r.item)}
              >
                <Show when={r.item.icon}>
                  <span class="palette-icon"><Icon value={r.item.icon!} size={15} /></span>
                </Show>
                <span class="palette-text">
                  <span class="palette-label">
                    <Highlight text={r.item.label} indices={r.indices} />
                  </span>
                </span>
                <Show when={r.item.sublabel}>
                  <span class="palette-sub">{r.item.sublabel}</span>
                </Show>
              </div>
            )}
          </For>
          <Show when={results().length === 0}>
            <Show when={!query().trim()}>
              <div class="palette-empty">Loading files…</div>
            </Show>
            <Show when={!!query().trim() && !shouldOfferAiEscalation(query(), 0)}>
              <div class="palette-empty">No matching files</div>
            </Show>
            {/* Question-shaped query with zero fuzzy file matches — same affordance copy/markup
                as the Search tab's empty-state CTA (search-empty-cta, SearchView.css). */}
            <Show when={!!query().trim() && shouldOfferAiEscalation(query(), 0)}>
              <button type="button" class="search-empty search-empty-cta" onClick={askAi}>
                <Icon value="Sparkles" size={22} class="search-empty-icon" />
                <div class="search-empty-title">No matching files</div>
                <div class="search-empty-hint">
                  Press <kbd class="search-kbd">Enter</kbd> to ask Bismuth AI about your vault
                </div>
              </button>
            </Show>
          </Show>
        </Show>
        <Show when={aiState().phase === "loading"}>
          <div class="search-state">
            <span class="search-spinner search-spinner-lg" />
            <div class="search-state-title">Searching your vault with Bismuth AI…</div>
            <div class="search-state-hint">Reading your notes to find what answers your question</div>
          </div>
        </Show>
        <Show when={aiState().phase === "error"}>
          <div class="search-state search-state-error">
            <Icon value="TriangleAlert" size={24} class="search-state-error-icon" />
            <div class="search-state-title">Bismuth AI couldn’t complete the search</div>
            <div class="search-state-msg">{aiState().error}</div>
          </div>
        </Show>
        <Show when={aiState().phase === "results"}>
          <Show
            when={aiState().results.length > 0}
            fallback={
              <div class="search-empty">
                <Icon value="Sparkles" size={22} class="search-empty-icon" />
                <div class="search-empty-title">Bismuth AI found nothing relevant</div>
              </div>
            }
          >
            <SearchResultRows results={aiState().results} onOpen={openAiResult} />
          </Show>
        </Show>
      </div>
    </div>
  );
}
