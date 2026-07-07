// app/src/SearchView.tsx
// The Search tab: ranked full-text search across the vault + integrated
// find-and-replace (per-file and vault-wide). Opened via the `search` command
// or the default toolbar button (routed from PaneContent on the ::search id).
// Uses the shared Button/Icon primitives so its chrome matches the rest of the app.
import { createSignal, onCleanup, For, Show } from "solid-js";
import { api } from "./api";
import { isValidRegex, type SearchResult } from "./searchOpts";
import { planEnter } from "./searchEnter";
import { TextButton } from "./ui/TextButton";
import { IconButton } from "./ui/IconButton";
import { Chip } from "./ui/Chip";
import { SearchBar } from "./ui/SearchBar";
import { Icon } from "./icons/Icon";
import { recordUse, fileKey } from "./frecency";
import "./SearchView.css";

// Split a vault path into its filename (sans extension) and parent folder
// so each result card can show a bold title + a faint folder crumb.
function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf(".");
  const name = dot > 0 ? file.slice(0, dot) : file;
  return { name, folder };
}

export function SearchView(props: { onOpen: (path: string) => void }) {
  const [query, setQuery] = createSignal("");
  const [replacement, setReplacement] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [wholeWord, setWholeWord] = createSignal(false);
  const [regex, setRegex] = createSignal(false);
  const [showReplace, setShowReplace] = createSignal(false);
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal("");
  // AI prompt-search ("Bismuth AI") mode: an Enter-gated, one-shot natural-language re-rank of the
  // keyword candidates. `promptMode` = we're in AI mode; `promptBusy` = a request is in flight.
  const [promptMode, setPromptMode] = createSignal(false);
  const [promptBusy, setPromptBusy] = createSignal(false);

  const opts = () => ({ caseSensitive: caseSensitive(), wholeWord: wholeWord(), regex: regex() });

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // Monotonic request generation: a late AI/keyword response for a superseded query (a newer run,
  // an exit from prompt mode, or a cleared box) is ignored so results never flicker to stale data.
  let searchGen = 0;
  const runSearch = () => {
    clearTimeout(debounceTimer); // this may BE the debounced call; also drops any redundant pending one
    const q = query();
    searchGen++;
    if (!q) { setResults([]); setError(null); setStatus(""); return; }
    if (regex() && !isValidRegex(q)) { setError("Invalid regular expression"); return; }
    setError(null);
    const gen = searchGen;
    api.search(q, opts())
      .then((r) => {
        if (gen !== searchGen) return; // superseded
        setResults(r);
        // Zero literal hits → nudge the user toward the AI fallback (Enter escalates to prompt mode).
        setStatus(r.length ? `${r.length} file(s)` : "No results — press Enter to ask Bismuth AI");
      })
      .catch((e) => { if (gen === searchGen) setError(e.message); });
  };

  // Run the AI prompt search for the current query. Enter-gated (never debounced) — one Haiku turn.
  const runPromptSearch = () => {
    // Cancel any pending live keyword-search debounce (armed by the last keystroke). Without this it
    // fires ~150ms later, bumps searchGen, and supersedes THIS AI request — dropping its response and
    // overwriting the results with the empty keyword set. That was the "Enter doesn't run AI" bug.
    clearTimeout(debounceTimer);
    const q = query();
    searchGen++;
    if (!q) { setResults([]); setStatus(""); return; }
    const gen = searchGen;
    setError(null);
    setPromptBusy(true);
    setStatus("Asking Bismuth AI…");
    api.searchPrompt(q)
      .then((r) => {
        if (gen !== searchGen) return; // superseded
        setResults(r);
        setStatus(r.length ? `${r.length} file(s) · Bismuth AI` : "Bismuth AI found nothing relevant");
      })
      .catch((e) => {
        if (gen !== searchGen) return;
        setResults([]);
        // The backend surfaces "AI search needs Claude Code installed" (400) here for a missing CLI.
        setError((e as Error).message || "AI search failed");
      })
      .finally(() => { if (gen === searchGen) setPromptBusy(false); });
  };

  // Escalate to the AI prompt search (from Enter on a zero-hit query, or the empty-state CTA).
  const askAi = () => {
    if (!promptMode()) setPromptMode(true);
    runPromptSearch(); // clears the pending live-search debounce so it can't clobber this run
  };

  // Enter behavior depends on mode (see planEnter): AI mode runs the prompt search; regex mode is
  // Enter-gated; literal mode with zero hits escalates to AI, otherwise re-runs the keyword search.
  // `forceAi` (Cmd/Ctrl+Enter) ALWAYS runs the AI prompt search — the always-reachable path so a
  // natural-language query with keyword hits can still escalate to AI without the Sparkles chip.
  const onEnter = (forceAi = false) => {
    const plan = planEnter({
      promptMode: promptMode(),
      regex: regex(),
      hasQuery: !!query(),
      resultCount: results().length,
      forceAi,
    });
    // Enter is a deliberate submit: cancel any pending live-search debounce first so its trailing run
    // can't bump searchGen and supersede the run we're about to start.
    if (plan.cancelPendingLiveSearch) clearTimeout(debounceTimer);
    switch (plan.action) {
      case "prompt": runPromptSearch(); break;
      case "escalate-ai": askAi(); break;
      case "regex":
      case "keyword": runSearch(); break;
    }
  };

  // Toggle AI mode explicitly (the Sparkles chip) — usable even when keyword hits exist. Turning it
  // on with a query in the box runs immediately; turning it off returns to live keyword search.
  const togglePromptMode = () => {
    if (promptMode()) {
      setPromptMode(false);
      setPromptBusy(false);
      searchGen++; // drop any in-flight AI response
      runSearch();
    } else {
      setPromptMode(true);
      setError(null);
      if (query()) runPromptSearch();
      else setStatus("Ask about your vault, then press Enter");
    }
  };

  // Escape leaves AI mode back to literal search (mirrors the input's own Escape). A no-op otherwise.
  const exitPromptMode = () => {
    if (!promptMode()) return;
    setPromptMode(false);
    setPromptBusy(false);
    searchGen++;
    runSearch();
  };

  const onInput = (v: string) => {
    setQuery(v);
    clearTimeout(debounceTimer);
    // Clearing the box exits AI mode so the next keystroke is ordinary keyword search again.
    if (!v && promptMode()) { setPromptMode(false); setPromptBusy(false); }
    // AI mode is Enter-gated only (one model turn per press) — never live-as-you-type. Typing
    // supersedes any in-flight AI turn (searchGen++), and since no new request starts until the
    // next Enter, we must clear promptBusy here too — otherwise the spinner sticks on forever (the
    // generation-guarded `.finally` in runPromptSearch won't reset it once its gen is stale).
    if (promptMode()) {
      searchGen++;
      setPromptBusy(false);
      setStatus(v ? "Press Enter to ask Bismuth AI" : "");
      return;
    }
    // Regex search bypasses the index and scans every note body line-by-line, so don't re-run it on
    // every keystroke — wait for Enter. Literal search stays live-as-you-type (index-backed, cheap).
    if (regex()) { setStatus(v ? "Press Enter to run regex search" : ""); return; }
    debounceTimer = setTimeout(runSearch, 150);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && promptMode()) { e.preventDefault(); exitPromptMode(); return; }
    // Cmd/Ctrl+Enter forces the AI prompt search regardless of mode / keyword-hit count.
    if (e.key === "Enter") { e.preventDefault(); onEnter(e.metaKey || e.ctrlKey); }
  };
  onCleanup(() => clearTimeout(debounceTimer));

  const totalMatches = () => results().reduce((n, r) => n + r.matchCount, 0);

  const doReplace = async (scope: string) => {
    const q = query();
    if (!q) return;
    if (regex() && !isValidRegex(q)) { setError("Invalid regular expression"); return; }
    const n = scope === "vault" ? totalMatches() : (results().find((r) => r.path === scope)?.matchCount ?? 0);
    if (n === 0) { setStatus("No matches"); return; }
    if (!confirm(`Replace ${n} match(es)${scope === "vault" ? " across the vault" : ` in ${scope}`}? A backup snapshot is taken first.`)) return;
    try {
      const res = await api.replace(q, replacement(), opts(), scope);
      setStatus(`Replaced ${res.replaced} in ${res.files.length} file(s)`);
      runSearch();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div class="search-view">
      <div class="search-header">
        <SearchBar class={`search-row${promptMode() ? " search-row-ai" : ""}`} value={query()}
          placeholder={promptMode() ? "Ask about your vault…" : "Search vault…"}
          onInput={onInput} onKeyDown={onKeyDown}>
          <Chip tone="teal" selected={promptMode()} title="Ask Bismuth AI (natural-language search)"
            icon="Sparkles" iconSize={16}
            onClick={togglePromptMode} />
          <Chip tone="teal" selected={caseSensitive()} title="Case sensitive"
            icon="CaseSensitive" iconSize={16}
            onClick={() => { setCaseSensitive(!caseSensitive()); runSearch(); }} />
          <Chip tone="teal" selected={wholeWord()} title="Whole word"
            icon="WholeWord" iconSize={16}
            onClick={() => { setWholeWord(!wholeWord()); runSearch(); }} />
          <Chip tone="teal" selected={regex()} title="Use regular expression"
            icon="Regex" iconSize={16}
            onClick={() => { setRegex(!regex()); runSearch(); }} />
          <IconButton variant={showReplace() ? "selected" : "unselected"} label="Toggle replace"
            icon={showReplace() ? "ChevronDown" : "ChevronRight"} iconSize={16}
            onClick={() => setShowReplace(!showReplace())} />
        </SearchBar>
        <Show when={promptMode()}>
          <div class="search-ai-mode">
            <Icon value="Sparkles" size={12} />
            <span>Bismuth AI — natural-language search. Press Esc to return to keyword search.</span>
          </div>
        </Show>
        {/* Persistent AI affordance (BUG #8): shown whenever a literal search returned hits and we're
            NOT already in AI mode — so the user can escalate a natural-language query to the AI even
            though it matched some keyword (the case where plain Enter just re-runs keyword search and
            the AI never used to be reachable). Clicking runs the prompt search immediately — the same
            as Cmd+Enter or the Sparkles chip. (Zero-hit queries get the bigger empty-state CTA below.)
            Hidden while an AI turn is in flight (the mode banner + spinner show instead). */}
        <Show when={!!query() && !promptMode() && !promptBusy() && !regex() && results().length > 0}>
          <button type="button" class="search-ask-ai" onClick={askAi}
            title="Search your vault with Bismuth AI (natural-language)">
            <Icon value="Sparkles" size={15} class="search-ask-ai-icon" />
            <span class="search-ask-ai-label">Not what you meant? Ask Bismuth AI about your vault</span>
            <span class="search-ask-ai-kbd"><kbd class="search-kbd">⌘↵</kbd></span>
          </button>
        </Show>
        <Show when={showReplace()}>
          <SearchBar class="search-row" leadingIcon="Replace" value={replacement()} placeholder="Replace with…" onInput={setReplacement}>
            <TextButton size="sm" class="search-replace-all" onClick={() => doReplace("vault")}>REPLACE ALL</TextButton>
          </SearchBar>
        </Show>
        <Show when={error()}><div class="search-error">{error()}</div></Show>
        <Show when={!error() && status()}>
          <div class={`search-status${promptBusy() ? " search-status-busy" : ""}`}>
            <Show when={promptBusy()}><span class="search-spinner" /></Show>
            {status()}
          </div>
        </Show>
      </div>

      <div class="search-results">
        {/* Empty state: a non-empty query with zero results. In literal mode it's a clear CTA to
            escalate to the AI (click, or the Enter that onEnter already handles); in AI mode it
            reports the model found nothing. Hidden while an AI turn is in flight (spinner shows). */}
        <Show when={!!query() && !error() && !promptBusy() && results().length === 0}>
          <Show
            when={promptMode()}
            fallback={
              <button type="button" class="search-empty search-empty-cta" onClick={askAi}>
                <Icon value="Sparkles" size={22} class="search-empty-icon" />
                <div class="search-empty-title">No matching files</div>
                <div class="search-empty-hint">
                  Press <kbd class="search-kbd">Enter</kbd> to ask Bismuth AI about your vault
                </div>
              </button>
            }
          >
            <div class="search-empty">
              <Icon value="Sparkles" size={22} class="search-empty-icon" />
              <div class="search-empty-title">Bismuth AI found nothing relevant</div>
              <div class="search-empty-hint">
                Press <kbd class="search-kbd">Esc</kbd> to return to keyword search
              </div>
            </div>
          </Show>
        </Show>
        <For each={results()}>
          {(r) => {
            const parts = splitPath(r.path);
            return (
              <div class="sresult">
                {/* The whole header opens the file too (not just the snippet rows) — AI results
                    carry one byte-exact snippet, but making the title row a hit target keeps every
                    result openable even if a row ever comes back without a snippet. */}
                <div class="sresult-head sresult-head-open"
                  onClick={() => { recordUse(fileKey(r.path)); props.onOpen(r.path); }}>
                  <Icon value="FileText" size={15} class="sresult-icon" />
                  <b class="sresult-title">{parts.name}</b>
                  <Show when={parts.folder}>
                    <span class="sresult-path">· {parts.folder}/</span>
                  </Show>
                  <span class="sresult-count">{r.matchCount}</span>
                  <Show when={showReplace()}>
                    <IconButton label="Replace all in this file" icon="Replace" iconSize={15}
                      onClick={(e) => { e.stopPropagation(); doReplace(r.path); }} />
                  </Show>
                </div>
                <Show when={r.reason}>
                  <div class="sresult-reason">{r.reason}</div>
                </Show>
                <For each={r.snippets}>
                  {(s) => (
                    <div class="sresult-snip" onClick={() => { recordUse(fileKey(r.path)); props.onOpen(r.path); }}>
                      <span class="sresult-line">{s.line}</span>
                      <span class="sresult-text">
                        {s.before}<mark>{s.match}</mark>{s.after}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
