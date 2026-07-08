// app/src/ui/gallery/SymbolGallery.tsx
// A searchable grid of symbols (icons, emoji, …) in a modal overlay. The grid,
// search box, capping, "showing X of Y" hint, current-highlight, and dismissal all
// live HERE, once — each gallery just supplies a different GallerySource. Both Lucide
// names and emoji glyphs render through <Icon value=…/>, so a cell never needs to
// know which kind it's showing.
//
// Keyboard: the search box owns navigation. Once you're typing, the TOP search result
// is the default-selected candidate (highlighted, and what Enter commits) — not the
// pre-existing `current` value from the app library. Arrows move the selection in the
// grid; Enter commits the active cell.
//
// Uses the SAME shell as the command palette: the shared <Modal> (darkening
// `.ui-overlay` backdrop + Escape/backdrop-close) and the `.palette-panel` /
// `.palette-search` styling — so it looks and behaves identically, not like a
// separate, lighter overlay. Reused by the file-tree "Set icon" picker and the
// editor's icon-field / `:`-emoji autocomplete galleries (via galleryStore).
import { createSignal, createMemo, createEffect, For, Show, onMount } from "solid-js";
import { Modal } from "../Modal";
import { Button } from "../Button";
import { TextButton } from "../TextButton";
import { Icon } from "../../icons/Icon";
import { SearchBar } from "../SearchBar";
import { defaultActiveIndex, moveActive } from "./activeItem";
import type { GallerySource } from "./types";

type Props = {
  /** The symbol set to show (icons, emoji, …). */
  source: GallerySource;
  /** Heading / search placeholder override (falls back to the source's placeholder). */
  title?: string;
  /** Currently-selected value, highlighted in the grid. */
  current?: string;
  onPick: (value: string) => void;
  /** When provided, shows a reset action that clears the current selection. */
  onClear?: () => void;
  /** Label for the clear action (must be ALL CAPS per TextButton). */
  clearLabel?: string;
  onClose: () => void;
};

export function SymbolGallery(props: Props) {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(-1);
  let inputRef: HTMLInputElement | undefined;
  let gridRef: HTMLDivElement | undefined;

  const results = createMemo(() => props.source.search(query()));

  // Whenever a fresh result set renders (query changed), reset the default selection:
  // the top hit once searching, else the existing `current`. This is the fix — the
  // default-committed candidate follows the SEARCH, not the app-library ordering.
  createEffect(() => {
    const items = results().items;
    setActive(defaultActiveIndex(query(), items, props.current));
  });

  // Focus the search box on mount so typing narrows immediately and Enter commits the top hit.
  // When the gallery is opened from a TABLE CELL (#67), the cell's nested CodeMirror editor is
  // kept alive (the isGalleryOpen teardown guard) and still holds DOM focus at this moment; in the
  // packaged app's WebKit/WKWebView a programmatic `.focus()` issued during the opener's blur tick
  // does not always stick — WebKit hands focus back to the editor, so keystrokes went to the cell,
  // not this search box, and the top-result default / Enter-commit / arrow-nav never took (works in
  // Chromium, which is why it looked fine outside the packaged app). Blur whatever is focused, focus
  // now, AND re-assert on the next frame so the late WebKit focus-restore loses the race. Chromium
  // is unaffected (the input is already focused; the re-focus is a no-op). `preventScroll` keeps a
  // cell-anchored gallery from yanking the viewport.
  onMount(() => {
    const grab = (): void => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      inputRef?.focus({ preventScroll: true });
    };
    grab();
    if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(grab);
  });

  const commit = (value: string) => { props.onPick(value); props.onClose(); };

  // Live rendered column count, read from the CSS grid (auto-fill), so Up/Down move
  // by a real row. Falls back to 1 before the grid mounts.
  const cols = (): number => {
    if (!gridRef) return 1;
    const t = getComputedStyle(gridRef).gridTemplateColumns;
    const n = t ? t.split(" ").filter(Boolean).length : 1;
    return Math.max(1, n);
  };

  const scrollActiveIntoView = () => {
    const i = active();
    const cell = gridRef?.children[i] as HTMLElement | undefined;
    cell?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const items = results().items;
    if (e.key === "Enter") {
      const it = items[active()];
      if (it) { e.preventDefault(); commit(it.value); }
      return;
    }
    let dir: "left" | "right" | "up" | "down" | null = null;
    if (e.key === "ArrowLeft") dir = "left";
    else if (e.key === "ArrowRight") dir = "right";
    else if (e.key === "ArrowUp") dir = "up";
    else if (e.key === "ArrowDown") dir = "down";
    if (dir) {
      e.preventDefault();
      setActive((a) => moveActive(a, items.length, cols(), dir!));
      scrollActiveIntoView();
    }
  };

  return (
    <Modal onClose={props.onClose} class="palette-panel icon-picker-panel">
      <SearchBar
        class="palette-search"
        inputClass="palette-input"
        inputRef={(el) => { inputRef = el; }}
        placeholder={props.title ?? props.source.placeholder}
        value={query()}
        onInput={setQuery}
        onKeyDown={onKeyDown}
      />
      <Show when={props.onClear}>
        <TextButton class="icon-picker-clear" onClick={() => { props.onClear!(); props.onClose(); }}>
          {props.clearLabel ?? "RESET TO DEFAULT"}
        </TextButton>
      </Show>
      <div class="icon-picker-grid" ref={(el) => (gridRef = el)}>
        <For each={results().items}>
          {(item, i) => (
            <Button
              kind="icon"
              class="icon-picker-cell"
              classList={{ current: active() === i() }}
              aria-label={item.label}
              aria-selected={active() === i()}
              title={item.label}
              // Hover-to-select fires on real pointer MOVEMENT, not `mouseenter`.
              // When you type, the grid re-renders and the top result becomes the
              // default selection (the createEffect above). WebKit (the packaged app's
              // WKWebView) synthesizes `mouseenter`/`mouseover` on whatever cell now sits
              // under a STATIONARY cursor after that re-render — which would clobber the
              // top-result default and make Enter commit the wrong icon. `mousemove` only
              // fires on genuine cursor motion, so a stationary cursor never overrides the
              // search's top hit; deliberate hover still highlights normally.
              onMouseMove={() => setActive(i())}
              onClick={() => commit(item.value)}
            >
              <Icon value={item.value} size={20} />
            </Button>
          )}
        </For>
        <Show when={results().items.length === 0}>
          <div class="palette-empty">No matches</div>
        </Show>
      </div>
      <Show when={results().total > results().items.length}>
        <div class="icon-picker-more">
          Showing {results().items.length} of {results().total} — keep typing to narrow.
        </div>
      </Show>
    </Modal>
  );
}
