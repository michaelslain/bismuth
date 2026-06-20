// app/src/SearchView.tsx
// The Search tab: ranked full-text search across the vault + integrated
// find-and-replace (per-file and vault-wide). Opened via the `search` command
// or the default toolbar button (routed from PaneContent on the ::search id).
// Uses the shared Button/Icon primitives so its chrome matches the rest of the app.
import { createSignal, onCleanup, For, Show } from "solid-js";
import { api } from "./api";
import { isValidRegex, type SearchResult } from "./searchOpts";
import { TextButton } from "./ui/TextButton";
import { IconButton } from "./ui/IconButton";
import { Chip } from "./ui/Chip";
import { SearchBar } from "./ui/SearchBar";
import { Icon } from "./icons/Icon";
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
    // Regex search bypasses the index and scans every note body line-by-line, so don't re-run it on
    // every keystroke — wait for Enter. Literal search stays live-as-you-type (index-backed, cheap).
    if (regex()) { setStatus(v ? "Press Enter to run regex search" : ""); return; }
    debounceTimer = setTimeout(runSearch, 150);
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
        <SearchBar class="search-row" value={query()} placeholder="Search vault…" onInput={onInput} onEnter={runSearch}>
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
        <Show when={showReplace()}>
          <SearchBar class="search-row" leadingIcon="Replace" value={replacement()} placeholder="Replace with…" onInput={setReplacement}>
            <TextButton size="sm" class="search-replace-all" onClick={() => doReplace("vault")}>REPLACE ALL</TextButton>
          </SearchBar>
        </Show>
        <Show when={error()}><div class="search-error">{error()}</div></Show>
        <Show when={!error() && status()}><div class="search-status">{status()}</div></Show>
      </div>

      <div class="search-results">
        <For each={results()}>
          {(r) => {
            const parts = splitPath(r.path);
            return (
              <div class="sresult">
                <div class="sresult-head">
                  <Icon value="FileText" size={15} class="sresult-icon" />
                  <b class="sresult-title">{parts.name}</b>
                  <Show when={parts.folder}>
                    <span class="sresult-path">· {parts.folder}/</span>
                  </Show>
                  <span class="sresult-count">{r.matchCount}</span>
                  <Show when={showReplace()}>
                    <IconButton label="Replace all in this file" icon="Replace" iconSize={15} onClick={() => doReplace(r.path)} />
                  </Show>
                </div>
                <For each={r.snippets}>
                  {(s) => (
                    <div class="sresult-snip" onClick={() => props.onOpen(r.path)}>
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
