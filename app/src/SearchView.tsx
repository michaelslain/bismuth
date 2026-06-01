// app/src/SearchView.tsx
// The Search tab: ranked full-text search across the vault + integrated
// find-and-replace (per-file and vault-wide). Opened via the `search` command
// or the default toolbar button (routed from PaneContent on the ::search id).
import { createSignal, For, Show } from "solid-js";
import { api } from "./api";
import { isValidRegex, type SearchResult } from "./searchOpts";
import "./SearchView.css";

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

  const opts = () => ({ caseSensitive: caseSensitive(), wholeWord: wholeWord(), regex: regex() });

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const runSearch = () => {
    const q = query();
    if (!q) { setResults([]); setError(null); return; }
    if (regex() && !isValidRegex(q)) { setError("Invalid regular expression"); return; }
    setError(null);
    api.search(q, opts())
      .then((r) => { setResults(r); setStatus(`${r.length} file(s)`); })
      .catch((e) => setError(e.message));
  };
  const onInput = (v: string) => {
    setQuery(v);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 150);
  };

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
        <div class="search-row">
          <input
            class="search-input"
            placeholder="Search vault…"
            value={query()}
            onInput={(e) => onInput(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          />
          <button classList={{ "search-toggle": true, on: caseSensitive() }} title="Case sensitive"
            onClick={() => { setCaseSensitive(!caseSensitive()); runSearch(); }}>Aa</button>
          <button classList={{ "search-toggle": true, on: wholeWord() }} title="Whole word"
            onClick={() => { setWholeWord(!wholeWord()); runSearch(); }}>W</button>
          <button classList={{ "search-toggle": true, on: regex() }} title="Regular expression"
            onClick={() => { setRegex(!regex()); runSearch(); }}>.*</button>
          <button class="search-toggle" title="Toggle replace"
            onClick={() => setShowReplace(!showReplace())}>⇄</button>
        </div>
        <Show when={showReplace()}>
          <div class="search-row">
            <input
              class="search-input"
              placeholder="Replace with…"
              value={replacement()}
              onInput={(e) => setReplacement(e.currentTarget.value)}
            />
            <button class="search-replace-all" onClick={() => doReplace("vault")}>Replace all</button>
          </div>
        </Show>
        <Show when={error()}><div class="search-error">{error()}</div></Show>
        <Show when={!error() && status()}><div class="search-status">{status()}</div></Show>
      </div>

      <div class="search-results">
        <For each={results()}>
          {(r) => (
            <div class="search-group">
              <div class="search-file">
                <span class="search-file-path">{r.path}</span>
                <span class="search-count">{r.matchCount}</span>
                <Show when={showReplace()}>
                  <button class="search-file-replace" title="Replace all in this file"
                    onClick={() => doReplace(r.path)}>↺</button>
                </Show>
              </div>
              <For each={r.snippets}>
                {(s) => (
                  <div class="search-snippet" onClick={() => props.onOpen(r.path)}>
                    <span class="search-line">{s.line}</span>
                    <span class="search-text">
                      {s.before}<mark>{s.match}</mark>{s.after}
                    </span>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
