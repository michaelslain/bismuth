// app/src/searchResults.tsx
// Shared result-row rendering for every surface that shows Bismuth AI / keyword search hits:
// the Search tab (SearchView.tsx) AND the Cmd+O switcher's AI escalation panel
// (palette/SwitcherBar.tsx). Extracted so the switcher's AI results render IDENTICALLY to the
// Search tab's (same markup, same SearchView.css classes) instead of forking a lookalike — see
// SwitcherBar.tsx's header comment for why that matters (BUG #8, 6th bounce; #49 already burned a
// row for a popup that didn't match its sibling).
import { For, Show } from "solid-js";
import { Icon } from "./icons/Icon";
import { IconButton } from "./ui/IconButton";
import { recordUse, fileKey } from "./frecency";
import type { SearchResult } from "./searchOpts";

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
 * Renders a list of search/AI-prompt results (`.sresult` cards: file header + optional AI
 * rationale + matched snippets). `onOpen` is called with the bare path AFTER frecency has already
 * been recorded — callers should not double-record. `showReplace`/`onReplaceFile` are optional
 * (the switcher has no find-and-replace; only SearchView passes them).
 */
export function SearchResultRows(props: {
  results: SearchResult[];
  onOpen: (path: string) => void;
  showReplace?: boolean;
  onReplaceFile?: (path: string) => void;
}) {
  return (
    <For each={props.results}>
      {(r) => {
        const parts = splitPath(r.path);
        const open = () => { recordUse(fileKey(r.path)); props.onOpen(r.path); };
        return (
          <div class="sresult">
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
              <Show when={props.showReplace}>
                <IconButton label="Replace all in this file" icon="Replace" iconSize={15}
                  onClick={(e) => { e.stopPropagation(); props.onReplaceFile?.(r.path); }} />
              </Show>
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
