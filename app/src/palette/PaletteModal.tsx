// app/src/palette/PaletteModal.tsx
// Reusable Obsidian-style command/search overlay: an autofocused search input over
// a fuzzy-filtered, keyboard-navigable list. Knows nothing about commands or files —
// callers pass `items` and an `onSelect`. See CommandPalette.tsx (the in-window Cmd+O
// switcher is SwitcherBar.tsx, which reuses the shared ranking + Highlight from here).
import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { Icon } from "../icons/Icon";
import { Modal } from "../ui/Modal";
import { SearchBar } from "../ui/SearchBar";
import { createMenuNav } from "../ui/popover/createMenuNav";
import { createPointerGuard, resetActiveOnChange, scrollSelectedIntoView } from "./paletteNav";
import { rankItems, toSegments, type Match, type PaletteItem } from "./rankItems";
import "./palette.css";

// Re-exported so existing importers (CommandPalette, and SwitcherBar) keep resolving
// PaletteItem from here; the canonical definition now lives in rankItems.ts.
export type { PaletteItem };

type Props = {
  placeholder: string;
  items: PaletteItem[];
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
  emptyText?: string;
  // Optional frecency score for an item id (see frecency.ts) — higher = used more/recently.
  // When provided, the list LEARNS from usage: an empty query lists most-frecent first, and
  // a non-empty query blends frecency into the fuzzy ranking as a gentle tiebreaker/booster
  // (a strong text match still wins — see FRECENCY_WEIGHT). Omit it for a plain fuzzy list.
  frecency?: (id: string) => number;
};

// Render a label with its fuzzy-matched characters highlighted. Exported so the in-window
// switcher (SwitcherBar.tsx) renders identical highlighted rows.
export function Highlight(p: { text: string; indices: number[] }) {
  const segments = createMemo(() => toSegments(p.text, p.indices));
  return (
    <For each={segments()}>
      {(s) => (s.match ? <span class="palette-match">{s.text}</span> : <>{s.text}</>)}
    </For>
  );
}

export function PaletteModal(props: Props) {
  const [query, setQuery] = createSignal("");
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // Fuzzy rank + frecency blend live in the shared pure helper (see rankItems.ts).
  const results = createMemo<Match[]>(() => rankItems(props.items, query(), props.frecency));

  // Up/Down/Enter/Escape come from the shared menu-nav hook (same logic as the
  // context menu); the palette clamps instead of wrapping, hence wrap:false.
  const nav = createMenuNav({
    count: () => results().length,
    wrap: false,
    onSelect: (i) => { const r = results()[i]; if (r) props.onSelect(r.item); },
    onEscape: () => props.onClose(),
  });
  const selected = nav.active;

  // Hover must not steal the selection from the keyboard default until the cursor genuinely
  // moves (see createPointerGuard).
  const onRowPointerMove = createPointerGuard(nav.setActive);

  // Reset the highlighted row to the top whenever the query changes.
  resetActiveOnChange(() => { query(); }, () => nav.setActive(0));

  // Keep the highlighted row scrolled into view.
  scrollSelectedIntoView(() => { selected(); results(); }, () => listRef, ".palette-row.selected");

  onMount(() => inputRef?.focus());

  return (
    <Modal onClose={props.onClose} class="palette-panel">
      <SearchBar
        class="palette-search"
        inputClass="palette-input"
        inputRef={(el) => (inputRef = el)}
        placeholder={props.placeholder}
        value={query()}
        onInput={setQuery}
        onKeyDown={nav.onKeyDown}
      />
      <div class="palette-list" ref={listRef}>
        <For each={results()}>
          {(r, i) => (
            <div
              class="palette-row"
              classList={{ selected: selected() === i() }}
              onMouseMove={(e) => onRowPointerMove(i(), e)}
              onClick={() => props.onSelect(r.item)}
            >
              <Show when={r.item.icon}>
                <span class="palette-icon"><Icon value={r.item.icon!} size={15} /></span>
              </Show>
              <span class="palette-text">
                <span class="palette-label">
                  <Highlight text={r.item.label} indices={r.indices} />
                </span>
                <Show when={r.item.description}>
                  <span class="palette-desc">{r.item.description}</span>
                </Show>
              </span>
              <Show when={r.item.sublabel}>
                <span class="palette-sub">{r.item.sublabel}</span>
              </Show>
              <Show when={r.item.shortcut}>
                <span class="palette-shortcut">{r.item.shortcut}</span>
              </Show>
            </div>
          )}
        </For>
        <Show when={results().length === 0}>
          <div class="palette-empty">{props.emptyText ?? "No matches"}</div>
        </Show>
      </div>
    </Modal>
  );
}
