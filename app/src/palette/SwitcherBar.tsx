// app/src/palette/SwitcherBar.tsx
// The in-window Cmd+O switcher — the NON-modal successor to the old QuickSwitcher overlay.
// Instead of popping a centered modal, App enters "switcher mode": the knowledge graph
// expands to fill the window (the home/new-tab view) and THIS bar sits big at the top where
// the tab strip was. Typing fuzzy-filters vault files (same matching + frecency blend as the
// Cmd+P palette, via rankItems), a live dropdown lists the hits, Enter opens the selected
// file, and Esc leaves switcher mode (App restores the prior view). The active row is
// reported up (onActiveChange) so App can highlight the matching node in the backdrop graph.
import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { Icon } from "../icons/Icon";
import { SearchBar } from "../ui/SearchBar";
import { createMenuNav } from "../ui/popover/createMenuNav";
import { Highlight } from "./PaletteModal";
import { rankItems, type Match } from "./rankItems";
import { vaultFileItems } from "./vaultFileItems";
import { refreshVaultTree } from "../treeStore";
import { loadFrecency, recordUse, scoreOf, fileKey } from "../frecency";
import "./switcher.css";

type Props = {
  onClose: () => void;
  openFile: (path: string) => void;
  // The currently-highlighted row's file path (or null) — App maps it to a graph node to
  // highlight in the backdrop. Fires on selection move and on close (null).
  onActiveChange?: (path: string | null) => void;
};

export function SwitcherBar(props: Props) {
  const [query, setQuery] = createSignal("");
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // Derive items reactively from the pre-warmed cache: the list paints immediately off the
  // last-known tree (no per-open fetch). Still kick a refresh so a missed SSE corrects fast.
  const items = createMemo(() => vaultFileItems());
  void refreshVaultTree();

  // Snapshot the frecency store once per open (fixed `now` — decay over the seconds the
  // switcher is visible is negligible): an empty query lists most-recently/frequently-opened
  // files first, and frecent files get boosted in fuzzy results (see rankItems blend).
  const store = loadFrecency();
  const now = Date.now();
  const frecency = (path: string) => scoreOf(store[fileKey(path)], now);

  const results = createMemo<Match[]>(() => rankItems(items(), query(), frecency));

  const commit = (item: Match["item"]) => {
    recordUse(fileKey(item.id)); // learn: opening a file boosts it next time
    props.openFile(item.id);
    props.onClose();
  };

  // Up/Down/Enter/Escape from the shared menu-nav hook — same behaviour as the palette
  // (clamped, not wrapped). Escape leaves switcher mode.
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

  // Report the highlighted file up so the backdrop graph can highlight its node.
  createEffect(() => {
    const r = results()[selected()];
    props.onActiveChange?.(r ? r.item.id : null);
  });
  onCleanup(() => props.onActiveChange?.(null));

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
        onInput={setQuery}
        onKeyDown={nav.onKeyDown}
      >
        <kbd class="switcher-esc">esc</kbd>
      </SearchBar>
      <div class="switcher-list" ref={listRef}>
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
          <div class="palette-empty">{query().trim() ? "No matching files" : "Loading files…"}</div>
        </Show>
      </div>
    </div>
  );
}
