// app/src/searchResults.tsx
// Result-card rendering for the unified search surface (#8: "the search tab and the cmd+o
// should be the same thing"): keyword CONTENT matches and Bismuth AI results, both rendered
// by the Cmd+O switcher (palette/SwitcherBar.tsx) as identical `.sresult` cards — file header
// + optional AI rationale + matched snippets. Extracted (originally out of the since-removed
// SearchView tab) so no surface ever forks a lookalike of the result card.
import { For, Show } from "solid-js";
import { Icon } from "./icons/Icon";
import { recordUse, fileKey } from "./frecency";
import type { SearchResult } from "./searchOpts";
import "./searchResults.css";

/** Split a vault path into its filename (sans extension) and parent folder so each result card
 *  can show a bold title + a faint folder crumb. */
export function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf(".");
  const name = dot > 0 ? file.slice(0, dot) : file;
  return { name, folder };
}

/**
 * Renders a list of search/AI-prompt results (`.sresult` cards). `onOpen` is called with the
 * bare path AFTER frecency has already been recorded — callers should not double-record.
 *
 * Keyboard-nav integration (the switcher walks these rows with Up/Down like palette rows):
 * `selected` highlights the row at that index; `onRowPointerMove` lets the caller reselect on
 * real mouse movement (same stationary-pointer guard idiom as the palette rows).
 */
export function SearchResultRows(props: {
  results: SearchResult[];
  onOpen: (path: string) => void;
  selected?: number;
  onRowPointerMove?: (index: number, e: MouseEvent) => void;
}) {
  return (
    <For each={props.results}>
      {(r, i) => {
        const parts = splitPath(r.path);
        const open = () => { recordUse(fileKey(r.path)); props.onOpen(r.path); };
        return (
          <div class="sresult" classList={{ selected: props.selected === i() }}
            onMouseMove={(e) => props.onRowPointerMove?.(i(), e)}>
            {/* The whole header opens the file too (not just the snippet rows) — AI results
                carry one byte-exact snippet, but making the title row a hit target keeps every
                result openable even if a row ever comes back without a snippet. */}
            <div class="sresult-head sresult-head-open" onClick={open}>
              <Icon value="FileText" size={15} class="sresult-icon" />
              <b class="sresult-title">{parts.name}</b>
              <Show when={parts.folder}>
                <span class="sresult-path">· {parts.folder}/</span>
              </Show>
              <span class="sresult-count">{r.matchCount}</span>
            </div>
            <Show when={r.reason}>
              <div class="sresult-reason">{r.reason}</div>
            </Show>
            <For each={r.snippets}>
              {(s) => (
                <div class="sresult-snip" onClick={open}>
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
  );
}
