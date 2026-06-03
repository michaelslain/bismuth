// app/src/GraphSearch.tsx
// Presentational graph-scoped search overlay. A text input over a case-insensitive,
// substring-filtered, keyboard-navigable list of graph nodes. ArrowUp/Down (and hover)
// PREVIEW the highlighted node — onPreview lights up its label without moving the camera;
// Enter / click COMMIT — onFly flies the camera there. Esc closes. Pure props in / callbacks
// out — it knows nothing about the renderer; GraphView supplies `items` and wires the
// callbacks. Styled as a small graph overlay via theme tokens (--surface-2/--fg/--faint,
// selected row = --accent-soft) so it tracks light and dark themes, 10–11px.
import { createSignal, createMemo, createEffect, For, Show, onMount } from "solid-js";
import { SearchBar } from "./ui/SearchBar";
import { IconButton } from "./ui/IconButton";

export interface SearchItem {
  id: string;
  label: string;
  sub?: string; // folder / community — also searched
}

// Cap rendered rows so a large graph doesn't render thousands of DOM rows.
const MAX_RESULTS = 30;

export function GraphSearch(props: {
  items: SearchItem[];
  onPreview?: (id: string) => void; // arrow-nav / hover → highlight (force label), no camera move
  onFly: (id: string) => void;      // Enter / click → commit: fly the camera to the node
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const results = createMemo<SearchItem[]>(() => {
    // Empty query → no rows, so the cluster list owns the panel until the user actually searches.
    const q = query().trim().toLowerCase();
    if (!q) return [];
    return props.items
      .filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          (it.sub?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, MAX_RESULTS);
  });

  // Reset the highlighted row to the top whenever the query changes, and preview that top match
  // (highlight its label) so typing surfaces where the best match is — without flying the camera.
  createEffect(() => {
    const q = query();
    setSelected(0);
    if (q.trim()) {
      const top = results()[0];
      if (top) props.onPreview?.(top.id);
    }
  });

  // Keep the highlighted row scrolled into view.
  createEffect(() => {
    selected();
    results();
    listRef
      ?.querySelector<HTMLElement>("[data-row].selected")
      ?.scrollIntoView({ block: "nearest" });
  });

  onMount(() => inputRef?.focus());

  // Move selection and PREVIEW the newly highlighted node (label highlight only; no camera move,
  // so holding an arrow doesn't thrash a 450ms glide or flood the camera history).
  function move(delta: number): void {
    const n = results().length;
    if (n === 0) return;
    const next = Math.max(0, Math.min(selected() + delta, n - 1));
    setSelected(next);
    const item = results()[next];
    if (item) props.onPreview?.(item.id);
  }

  function onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Enter": {
        e.preventDefault();
        const item = results()[selected()];
        if (item) props.onFly(item.id);
        break;
      }
      case "Escape":
        e.preventDefault();
        props.onClose();
        break;
    }
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "font-family": "inherit",
        width: "100%",
        "min-height": 0,
        overflow: "hidden",
        "pointer-events": "auto",
      }}
    >
      <SearchBar
        leadingIcon="Search"
        placeholder="Search graph..."
        value={query()}
        onInput={setQuery}
        onKeyDown={onKeyDown}
        inputRef={(el) => (inputRef = el)}
        class="graph-search-bar"
      >
        <IconButton icon="X" label="Close search" size="sm" onClick={props.onClose} />
      </SearchBar>
      {/* Only render the divider + list once there's a query — keeps the panel a tidy
          single search bar (no empty sliver) until the user actually searches. */}
      <Show when={query().trim()}>
      <div
        ref={listRef}
        class="graph-search-list"
        style={{ "overflow-y": "auto", padding: "4px" }}
      >
        <For each={results()}>
          {(item, i) => (
            <div
              data-row
              classList={{ selected: selected() === i() }}
              onMouseEnter={() => { setSelected(i()); props.onPreview?.(item.id); }}
              // Commit on mousedown, not click: hovering a row runs a scrollIntoView effect, and if
              // the list shifts between mousedown and mouseup the browser cancels the click (the open
              // was intermittent). mousedown fires at press time regardless. preventDefault keeps the
              // search input focused and avoids text-selection.
              onMouseDown={(e) => { e.preventDefault(); props.onFly(item.id); }}
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                padding: "4px 6px",
                "border-radius": "3px",
                cursor: "pointer",
                "white-space": "nowrap",
                background:
                  selected() === i() ? "var(--accent-soft)" : "transparent",
              }}
            >
              <span
                style={{
                  flex: 1,
                  "min-width": 0,
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  color: "var(--fg)",
                }}
              >
                {item.label}
              </span>
              <Show when={item.sub}>
                <span
                  style={{
                    "margin-left": "auto",
                    "padding-left": "10px",
                    "max-width": "42%",
                    "flex-shrink": 0,
                    "white-space": "nowrap",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "text-align": "right",
                    color: "var(--faint)",
                    "font-size": "10px",
                  }}
                >
                  {item.sub}
                </span>
              </Show>
            </div>
          )}
        </For>
        <Show when={query().trim() && results().length === 0}>
          <div style={{ padding: "8px 9px", color: "var(--faint)", "font-size": "10px" }}>
            No matches
          </div>
        </Show>
      </div>
      </Show>
    </div>
  );
}
