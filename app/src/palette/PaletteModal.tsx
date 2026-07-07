// app/src/palette/PaletteModal.tsx
// Reusable Obsidian-style command/search overlay: an autofocused search input over
// a fuzzy-filtered, keyboard-navigable list. Knows nothing about commands or files —
// callers pass `items` and an `onSelect`. See CommandPalette.tsx / QuickSwitcher.tsx.
import { createSignal, createMemo, createEffect, For, Show, onMount } from "solid-js";
import Fuse from "fuse.js";
import { Icon } from "../icons/Icon";
import { Modal } from "../ui/Modal";
import { SearchBar } from "../ui/SearchBar";
import { createMenuNav } from "../ui/popover/createMenuNav";
import "./palette.css";

export type PaletteItem = {
  id: string;
  label: string;
  sublabel?: string; // muted secondary text (e.g. a folder path)
  description?: string; // optional faint second-line description under the label
  shortcut?: string; // optional right-aligned shortcut-key hint (already display-formatted)
  icon?: string; // optional leading icon (Lucide name or emoji)
};

type Match = { item: PaletteItem; indices: number[] }; // indices = matched chars in label

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

// How much frecency may nudge a fuzzy match, on the same 0..1 scale as text "goodness"
// (1 = perfect match). Small on purpose: a perfect/prefix match (goodness ≈ 1) always beats
// a fuzzy-but-frecent one (goodness + ≤0.15); frecency only reorders similar-quality matches.
const FRECENCY_WEIGHT = 0.15;

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
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const fuse = createMemo(() => {
    return new Fuse(props.items, {
      keys: ["label"],
      includeMatches: true,
      includeScore: true, // needed to blend frecency into the text-match rank
      ignoreLocation: true,
      threshold: 0.4,
    });
  });

  // Cap rendered rows: fuzzy ranking floats the best matches to the top, so a
  // large vault (1000s of files) doesn't render 1000s of DOM rows on open.
  const MAX_RESULTS = 50;

  const results = createMemo<Match[]>(() => {
    const q = query().trim();
    const frecency = props.frecency;
    if (!q) {
      // Empty query: with frecency, most-used-first (stable — equal/zero scores keep the
      // caller's order); without it, the plain incoming order. Then cap the rendered rows.
      // Decorate-sort so frecency() is called once per item, not per comparison.
      const ordered = frecency
        ? props.items
            .map((item) => ({ item, f: frecency(item.id) }))
            .sort((a, b) => b.f - a.f)
            .map((s) => s.item)
        : props.items;
      return ordered.slice(0, MAX_RESULTS).map((item) => ({ item, indices: [] }));
    }

    const hits = fuse().search(q, { limit: MAX_RESULTS }).map((r) => {
      const labelMatch = r.matches?.find((m) => m.key === "label");
      const indices: number[] = [];
      for (const [start, end] of labelMatch?.indices ?? []) {
        for (let i = start; i <= end; i++) indices.push(i);
      }
      // Fuse score: 0 = perfect, 1 = worst. Convert to "goodness" (higher = better) so it
      // shares a scale with the frecency boost below.
      return { item: r.item, indices, goodness: 1 - (r.score ?? 0) };
    });

    if (!frecency) return hits.map(({ item, indices }) => ({ item, indices }));

    // Blend frecency as a gentle boost: normalize each hit's frecency against the max in
    // THIS candidate set (relative, so absolute counts don't matter), scale by
    // FRECENCY_WEIGHT, add to goodness, and re-sort. Ties/near-ties get reordered by usage;
    // a decisively better text match is never overtaken. Stable sort keeps Fuse's order
    // when boosts are equal (e.g. no history yet).
    let maxF = 0;
    for (const h of hits) maxF = Math.max(maxF, frecency(h.item.id));
    const ranked = hits
      .map((h) => ({
        h,
        rank: h.goodness + (maxF > 0 ? FRECENCY_WEIGHT * (frecency(h.item.id) / maxF) : 0),
      }))
      .sort((a, b) => b.rank - a.rank);
    return ranked.map(({ h }) => ({ item: h.item, indices: h.indices }));
  });

  // Up/Down/Enter/Escape come from the shared menu-nav hook (same logic as the
  // context menu); the palette clamps instead of wrapping, hence wrap:false.
  const nav = createMenuNav({
    count: () => results().length,
    wrap: false,
    onSelect: (i) => { const r = results()[i]; if (r) props.onSelect(r.item); },
    onEscape: () => props.onClose(),
  });
  const selected = nav.active;

  // Hover must not steal the selection from the keyboard default until the
  // cursor genuinely moves: the palette often opens (or scrolls during Up/Down
  // nav) under a stationary pointer, and the browser fires mouseenter on
  // whatever row sits beneath it. We listen on mousemove — which doesn't fire on
  // open or on wheel-scroll under a still cursor — and ignore events whose
  // coordinates haven't changed, so the top result lingers until the user
  // actually moves the mouse.
  let lastPointer: { x: number; y: number } | undefined;
  const onRowPointerMove = (i: number, e: MouseEvent) => {
    if (lastPointer && lastPointer.x === e.clientX && lastPointer.y === e.clientY) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    nav.setActive(i);
  };

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
