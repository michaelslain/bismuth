// app/src/SearchView.tsx
// The Search tab: ranked full-text search across the vault + integrated
// find-and-replace (per-file and vault-wide). Opened via the `search` command
// or the default toolbar button (routed from PaneContent on the ::search id).
// Uses the shared Button/Icon primitives so its chrome matches the rest of the app.
import { createSignal, For, Show } from "solid-js";
import { api } from "./api";
import { isValidRegex, type SearchResult } from "./searchOpts";
import { TextButton } from "./ui/TextButton";
import { IconButton } from "./ui/IconButton";
import { SearchBar } from "./ui/SearchBar";
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
    if (!q) { setResults([]); setError(null); setStatus(""); return; }
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
        <SearchBar class="search-row" value={query()} placeholder="Search vault…" onInput={onInput} onEnter={runSearch}>
          <IconButton variant="ghost" size="sm" class="search-tg" active={caseSensitive()} label="Case sensitive"
            icon="CaseSensitive" iconSize={16}
            onClick={() => { setCaseSensitive(!caseSensitive()); runSearch(); }} />
          <IconButton variant="ghost" size="sm" class="search-tg" active={wholeWord()} label="Whole word"
            icon="WholeWord" iconSize={16}
            onClick={() => { setWholeWord(!wholeWord()); runSearch(); }} />
          <IconButton variant="ghost" size="sm" class="search-tg" active={regex()} label="Use regular expression"
            icon="Regex" iconSize={16}
            onClick={() => { setRegex(!regex()); runSearch(); }} />
          <IconButton active={showReplace()} label="Toggle replace"
            icon={showReplace() ? "ChevronDown" : "ChevronRight"} iconSize={16}
            onClick={() => setShowReplace(!showReplace())} />
        </SearchBar>
        <Show when={showReplace()}>
          <SearchBar class="search-row" leadingIcon="Replace" value={replacement()} placeholder="Replace with…" onInput={setReplacement}>
            <TextButton variant="primary" size="sm" class="search-replace-all" onClick={() => doReplace("vault")}>REPLACE ALL</TextButton>
          </SearchBar>
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
                  <IconButton label="Replace all in this file" icon="Replace" iconSize={15} onClick={() => doReplace(r.path)} />
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
