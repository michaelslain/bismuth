// app/src/SearchView.tsx
// The Search tab: ranked full-text search across the vault + integrated
// find-and-replace (per-file and vault-wide). Opened via the `search` command
// or the default toolbar button (routed from PaneContent on the ::search id).
// Uses the shared Button/Icon primitives so its chrome matches the rest of the app.
import { createSignal, For, Show } from "solid-js";
import { api } from "./api";
import { isValidRegex, type SearchResult } from "./searchOpts";
import { Button } from "./ui/Button";
import { Icon } from "./icons/Icon";
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
        <div class="search-row">
          <Icon value="Search" size={16} class="search-lead" />
          <input
            class="search-input"
            placeholder="Search vault…"
            value={query()}
            onInput={(e) => onInput(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          />
          <Button variant="ghost" size="sm" class="search-tg" active={caseSensitive()} title="Case sensitive"
            onClick={() => { setCaseSensitive(!caseSensitive()); runSearch(); }}>
            <Icon value="CaseSensitive" size={16} />
          </Button>
          <Button variant="ghost" size="sm" class="search-tg" active={wholeWord()} title="Whole word"
            onClick={() => { setWholeWord(!wholeWord()); runSearch(); }}>
            <Icon value="WholeWord" size={16} />
          </Button>
          <Button variant="ghost" size="sm" class="search-tg" active={regex()} title="Use regular expression"
            onClick={() => { setRegex(!regex()); runSearch(); }}>
            <Icon value="Regex" size={16} />
          </Button>
          <Button variant="icon" active={showReplace()} title="Toggle replace"
            onClick={() => setShowReplace(!showReplace())}>
            <Icon value={showReplace() ? "ChevronDown" : "ChevronRight"} size={16} />
          </Button>
        </div>
        <Show when={showReplace()}>
          <div class="search-row">
            <Icon value="Replace" size={16} class="search-lead" />
            <input
              class="search-input"
              placeholder="Replace with…"
              value={replacement()}
              onInput={(e) => setReplacement(e.currentTarget.value)}
            />
            <Button variant="primary" size="sm" class="search-replace-all" onClick={() => doReplace("vault")}>Replace all</Button>
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
                  <Button variant="icon" title="Replace all in this file" onClick={() => doReplace(r.path)}>
                    <Icon value="Replace" size={15} />
                  </Button>
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
