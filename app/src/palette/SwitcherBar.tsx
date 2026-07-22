// app/src/palette/SwitcherBar.tsx
// The in-window Cmd+O switcher — the app's ONE search surface (#8, 7th round: "the search tab
// and the cmd+o should be the same thing. all of it should be how cmd+o works."). App enters
// "switcher mode": the knowledge graph expands to fill the window and THIS panel sits on the
// left. It unifies what used to be split across the Cmd+O switcher and the (now removed)
// ::search tab, in one list:
//
//   1. Fuzzy FILE-NAME matches (rankItems — same matching + frecency blend as the Cmd+P
//      palette). Enter/click switches to the file.
//   2. Keyword CONTENT matches (POST /search, debounced live) for notes whose BODY matches —
//      rendered as the same `.sresult` snippet cards the AI results use (searchResults.tsx),
//      deduped against the file-name rows (switcherModel.ts). Enter/click opens the note.
//   3. Bismuth AI escalation (POST /search-prompt, one Haiku turn) on zero/weak results:
//      a question-shaped query (3+ words, switcherAi.ts) with no rows offers "Press Enter to
//      ask Bismuth AI"; Cmd+Enter forces the AI from anywhere (the always-reachable path
//      folded in from the old Search tab). Loading/error/results render in this same panel.
//
// Up/Down walk the WHOLE list (file rows + content rows, or AI result rows), Enter commits the
// highlighted row (planSwitcherEnter), Esc leaves switcher mode. Every keystroke supersedes any
// in-flight AI turn (switcherAiReducer's generation guard). The visible result set is reported
// up (onResultsChange) so App lights up EVERY matching note in the backdrop graph.
import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { Icon } from "../icons/Icon";
import { SearchBar } from "../ui/SearchBar";
import { createMenuNav } from "../ui/popover/createMenuNav";
import { createPointerGuard, resetActiveOnChange, scrollSelectedIntoView } from "./paletteNav";
import { Highlight } from "./PaletteModal";
import { rankItems, type Match } from "./rankItems";
import { vaultFileItems } from "./vaultFileItems";
import { refreshVaultTree, vaultTree } from "../treeStore";
import { loadFrecency, recordUse, scoreOf, fileKey } from "../frecency";
import { api } from "../api";
import { SearchResultRows } from "../searchResults";
import { isNaturalLanguageQuery, switcherAiReducer, initialSwitcherAiState, type SwitcherAiState } from "./switcherAi";
import { visibleContent, planSwitcherEnter, type ContentHits } from "./switcherModel";
import type { SearchResult } from "../searchOpts";
import "./switcher.css";

type Props = {
  onClose: () => void;
  openFile: (path: string) => void;
  // The visible result set's file paths — App maps them to graph node ids and lights up every
  // matching note in the backdrop graph. Fires on every change and on close (empty). Empty
  // while the query is blank (don't flood the graph with all frecent files before the user
  // has typed).
  onResultsChange?: (paths: string[]) => void;
};

// How long a keystroke waits before firing the live content (keyword) search — same debounce
// the old Search tab used; the fuzzy file matching above it stays synchronous/instant.
const CONTENT_DEBOUNCE_MS = 150;

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

  // 1. Fuzzy file-name matches (instant, client-side).
  const fileRows = createMemo<Match[]>(() => rankItems(items(), query(), frecency));

  // 2. Keyword content matches: debounced POST /search, stored WITH the query they ran for so
  //    stale rows never render under a newer query (visibleContent — see switcherModel.ts).
  //    A generation counter drops late responses for superseded queries.
  const [contentHits, setContentHits] = createSignal<ContentHits | null>(null);
  let contentGen = 0;
  let contentTimer: ReturnType<typeof setTimeout> | undefined;
  const runContentSearch = (q: string) => {
    const gen = ++contentGen;
    api.search(q, { caseSensitive: false, wholeWord: false, regex: false })
      .then((r) => { if (gen === contentGen) setContentHits({ query: q, results: r }); })
      .catch(() => { /* content search is best-effort; the file rows + AI path still work */ });
  };
  onCleanup(() => clearTimeout(contentTimer));

  const contentRows = createMemo<SearchResult[]>(() =>
    visibleContent(contentHits(), query(), fileRows().map((r) => r.item.id)));

  // 3. Bismuth AI escalation state (idle / loading / results / error) — see switcherAi.ts.
  const [aiState, setAiState] = createSignal<SwitcherAiState>(initialSwitcherAiState);
  const aiPhase = () => aiState().phase;

  const shaped = createMemo(() => isNaturalLanguageQuery(query()));

  // Rows the menu nav walks, per phase: the unified file+content list while idle, the AI
  // result cards after a turn. Loading/error panels have no navigable rows.
  const navCount = createMemo(() => {
    if (aiPhase() === "idle") return fileRows().length + contentRows().length;
    if (aiPhase() === "results") return aiState().results.length;
    return 0;
  });

  const openPath = (path: string) => {
    props.openFile(path);
    props.onClose();
  };

  const commitFile = (item: Match["item"]) => {
    recordUse(fileKey(item.id)); // learn: opening a file boosts it next time
    openPath(item.id);
  };

  // Open the keyboard-highlighted row, whichever section it falls in. Click paths record
  // frecency themselves (SearchResultRows records before onOpen; commitFile above records).
  const commitRow = (i: number) => {
    if (aiPhase() === "results") {
      const r = aiState().results[i];
      if (r) { recordUse(fileKey(r.path)); openPath(r.path); }
      return;
    }
    const files = fileRows();
    if (i < files.length) { const f = files[i]; if (f) commitFile(f.item); return; }
    const c = contentRows()[i - files.length];
    if (c) { recordUse(fileKey(c.path)); openPath(c.path); }
  };

  // Run the one-shot AI prompt search for the current query (Enter, Cmd+Enter, or a CTA).
  // Generation-guarded via the reducer so a superseded request (a keystroke fired "reset", or
  // a second ask fired before the first resolved) can't clobber fresher state when it lands.
  const askAi = () => {
    clearTimeout(contentTimer); // a pending live content search is pointless under the AI panel
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
  // (clamped, not wrapped). Escape leaves switcher mode. Enter routing happens in onKeyDown
  // below (planSwitcherEnter); when it says "commit", nav's own Enter handling lands here.
  const nav = createMenuNav({
    count: navCount,
    wrap: false,
    onSelect: commitRow,
    onEscape: () => props.onClose(),
  });
  const selected = nav.active;

  // Every keystroke: reset the AI lifecycle (cancels/ignores any in-flight or shown AI turn —
  // the query changed, so a stale answer must not linger) and re-arm the content-search
  // debounce, dropping any late response for the superseded query.
  const onQueryInput = (v: string) => {
    setQuery(v);
    setAiState((s) => switcherAiReducer(s, { type: "reset" }));
    clearTimeout(contentTimer);
    contentGen++; // a late response for the previous query must not render
    if (v.trim()) contentTimer = setTimeout(() => runContentSearch(v), CONTENT_DEBOUNCE_MS);
    else setContentHits(null);
  };

  // Reset the highlighted row to the top when the query changes or the AI phase flips
  // (AI results arriving / clearing restart the walk from the first row).
  resetActiveOnChange(() => { query(); aiPhase(); }, () => nav.setActive(0));

  // Keep the highlighted row scrolled into view (file rows and result cards both mark
  // themselves with `.selected`).
  scrollSelectedIntoView(() => { selected(); navCount(); }, () => listRef, ".selected");

  // Report the visible result set up so the backdrop graph lights up EVERY matching note:
  // file + content rows while idle, the AI's picks after a turn. Blank query → nothing (don't
  // flood the graph with all frecent files before the user has typed).
  createEffect(() => {
    if (!query().trim()) { props.onResultsChange?.([]); return; }
    const paths = aiPhase() === "results"
      ? aiState().results.map((r) => r.path)
      : aiPhase() === "idle"
        ? [...fileRows().map((r) => r.item.id), ...contentRows().map((r) => r.path)]
        : [];
    props.onResultsChange?.(paths);
  });
  onCleanup(() => props.onResultsChange?.([]));

  // Enter routing (see planSwitcherEnter): commit falls through to the menu nav; ask-ai runs
  // the prompt search; none swallows the keypress. Cmd/Ctrl+Enter forces the AI path.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const plan = planSwitcherEnter({
        hasQuery: !!query().trim(),
        shaped: shaped(),
        rowCount: navCount(),
        aiPhase: aiPhase(),
        forceAi: e.metaKey || e.ctrlKey,
      });
      if (plan !== "commit") {
        e.preventDefault();
        if (plan === "ask-ai") askAi();
        return;
      }
    }
    nav.onKeyDown(e);
  };

  // Same stationary-pointer guard as the palette — see createPointerGuard.
  const onRowPointerMove = createPointerGuard(nav.setActive);

  onMount(() => inputRef?.focus());

  return (
    <div class="switcher-bar" onPointerDown={(e) => e.stopPropagation()}>
      <SearchBar
        class="switcher-search"
        inputClass="switcher-input"
        inputRef={(el) => (inputRef = el)}
        placeholder="Search files, contents, or ask…"
        value={query()}
        onInput={onQueryInput}
        onKeyDown={onKeyDown}
      >
        <kbd class="switcher-esc">esc</kbd>
      </SearchBar>
      <div class="switcher-list" ref={listRef}>
        <Show when={aiPhase() === "idle"}>
          <For each={fileRows()}>
            {(r, i) => (
              <div
                class="palette-row"
                classList={{ selected: selected() === i() }}
                onMouseMove={(e) => onRowPointerMove(i(), e)}
                onClick={() => commitFile(r.item)}
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
          {/* Keyword content matches, under the file-name rows — the old Search tab's
              full-text results folded into this one list. Selection indices continue from
              the file rows (the nav walks the whole list). */}
          <Show when={contentRows().length > 0}>
            <div class="switcher-section">Content matches</div>
            <SearchResultRows results={contentRows()} onOpen={openPath}
              selected={selected() - fileRows().length}
              onRowPointerMove={(i, e) => onRowPointerMove(fileRows().length + i, e)} />
          </Show>
          {/* Persistent AI affordance for question-shaped queries that DO have rows — plain
              Enter commits the highlighted row, so the AI needs its own visible path. */}
          <Show when={navCount() > 0 && shaped()}>
            <button type="button" class="search-ask-ai switcher-ask-ai" onClick={askAi}
              title="Search your vault with Bismuth AI (natural-language)">
              <Icon value="Sparkles" size={15} class="search-ask-ai-icon" />
              <span class="search-ask-ai-label">Ask Bismuth AI about your vault</span>
              <span class="search-ask-ai-kbd"><kbd class="search-kbd">⌘↵</kbd></span>
            </button>
          </Show>
          <Show when={navCount() === 0}>
            <Show when={!query().trim()}>
              <div class="palette-empty">Loading files…</div>
            </Show>
            <Show when={!!query().trim() && !shaped()}>
              <div class="palette-empty">No matching files</div>
            </Show>
            {/* Question-shaped query with zero rows — the Enter-to-AI empty state. */}
            <Show when={!!query().trim() && shaped()}>
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
        <Show when={aiPhase() === "loading"}>
          <div class="search-state">
            <span class="search-spinner search-spinner-lg" />
            <div class="search-state-title">Searching your vault with Bismuth AI…</div>
            <div class="search-state-hint">Reading your notes to find what answers your question</div>
          </div>
        </Show>
        <Show when={aiPhase() === "error"}>
          <div class="search-state search-state-error">
            <Icon value="TriangleAlert" size={24} class="search-state-error-icon" />
            <div class="search-state-title">Bismuth AI couldn’t complete the search</div>
            <div class="search-state-msg">{aiState().error}</div>
          </div>
        </Show>
        <Show when={aiPhase() === "results"}>
          <Show
            when={aiState().results.length > 0}
            fallback={
              <div class="search-empty">
                <Icon value="Sparkles" size={22} class="search-empty-icon" />
                <div class="search-empty-title">Bismuth AI found nothing relevant</div>
              </div>
            }
          >
            <SearchResultRows results={aiState().results} onOpen={openPath}
              selected={selected()} onRowPointerMove={onRowPointerMove} />
          </Show>
        </Show>
      </div>
    </div>
  );
}
