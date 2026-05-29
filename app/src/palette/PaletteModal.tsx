// app/src/palette/PaletteModal.tsx
// Reusable Obsidian-style command/search overlay: an autofocused search input over
// a fuzzy-filtered, keyboard-navigable list. Knows nothing about commands or files —
// callers pass `items` and an `onSelect`. See CommandPalette.tsx / QuickSwitcher.tsx.
import { createSignal, createMemo, createEffect, For, Show, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import Fuse from "fuse.js";

export type PaletteItem = {
  id: string;
  label: string;
  sublabel?: string; // muted secondary text (e.g. a folder path)
  icon?: string; // optional leading emoji
};

type Match = { item: PaletteItem; indices: number[] }; // indices = matched chars in label

type Props = {
  placeholder: string;
  items: PaletteItem[];
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
  emptyText?: string;
};

// Collapse matched-char indices into contiguous runs so we render a handful of
// segments per label instead of one DOM node per character (the latter explodes
// on large lists). Returns alternating matched / unmatched text runs.
function toSegments(text: string, indices: number[]): { text: string; match: boolean }[] {
  if (indices.length === 0) return [{ text, match: false }];
  const set = new Set(indices);
  const segs: { text: string; match: boolean }[] = [];
  let run = "";
  let runMatch = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== runMatch) {
      if (run) segs.push({ text: run, match: runMatch });
      run = "";
      runMatch = m;
    }
    run += text[i];
  }
  if (run) segs.push({ text: run, match: runMatch });
  return segs;
}

// Render a label with its fuzzy-matched characters highlighted.
function Highlight(p: { text: string; indices: number[] }) {
  const segments = createMemo(() => toSegments(p.text, p.indices));
  return (
    <For each={segments()}>
      {(s) => (s.match ? <span class="palette-match">{s.text}</span> : <>{s.text}</>)}
    </For>
  );
}

export function PaletteModal(props: Props) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const fuse = createMemo(() => {
    return new Fuse(props.items, {
      keys: ["label", "sublabel"],
      includeMatches: true,
      ignoreLocation: true,
      threshold: 0.4,
    });
  });

  // Cap rendered rows: fuzzy ranking floats the best matches to the top, so a
  // large vault (1000s of files) doesn't render 1000s of DOM rows on open.
  const MAX_RESULTS = 50;

  const results = createMemo<Match[]>(() => {
    const q = query().trim();
    if (!q) {
      return props.items.slice(0, MAX_RESULTS).map((item) => ({ item, indices: [] }));
    }

    return fuse()
      .search(q, { limit: MAX_RESULTS })
      .map((r) => {
        const labelMatch = r.matches?.find((m) => m.key === "label");
        const indices: number[] = [];
        for (const [start, end] of labelMatch?.indices ?? []) {
          for (let i = start; i <= end; i++) {
            indices.push(i);
          }
        }
        return { item: r.item, indices };
      });
  });

  // Reset the highlighted row to the top whenever the query changes.
  createEffect(() => {
    query();
    setSelected(0);
  });

  // Keep the highlighted row scrolled into view.
  createEffect(() => {
    selected();
    results();
    listRef?.querySelector<HTMLElement>(".palette-row.selected")?.scrollIntoView({ block: "nearest" });
  });

  onMount(() => inputRef?.focus());

  function onKeyDown(e: KeyboardEvent): void {
    const n = results().length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, n - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        const r = results()[selected()];
        if (r) props.onSelect(r.item);
        break;
      case "Escape":
        e.preventDefault();
        props.onClose();
        break;
    }
  }

  return (
    <Portal>
      <div class="palette-overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="palette-panel">
          <input
            ref={inputRef}
            class="palette-input"
            placeholder={props.placeholder}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <div class="palette-list" ref={listRef}>
            <For each={results()}>
              {(r, i) => (
                <div
                  class="palette-row"
                  classList={{ selected: selected() === i() }}
                  onMouseEnter={() => setSelected(i())}
                  onClick={() => props.onSelect(r.item)}
                >
                  <Show when={r.item.icon}>
                    <span class="palette-icon">{r.item.icon}</span>
                  </Show>
                  <span class="palette-label">
                    <Highlight text={r.item.label} indices={r.indices} />
                  </span>
                  <Show when={r.item.sublabel}>
                    <span class="palette-sub">{r.item.sublabel}</span>
                  </Show>
                </div>
              )}
            </For>
            <Show when={results().length === 0}>
              <div class="palette-empty">{props.emptyText ?? "No matches"}</div>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
