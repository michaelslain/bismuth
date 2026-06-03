// app/src/ui/gallery/SymbolGallery.tsx
// A searchable grid of symbols (icons, emoji, …) in a modal overlay. The grid,
// search box, capping, "showing X of Y" hint, current-highlight, and dismissal all
// live HERE, once — each gallery just supplies a different GallerySource. Both Lucide
// names and emoji glyphs render through <Icon value=…/>, so a cell never needs to
// know which kind it's showing.
//
// Uses the SAME shell as the command palette: the shared <Modal> (darkening
// `.ui-overlay` backdrop + Escape/backdrop-close) and the `.palette-panel` /
// `.palette-search` styling — so it looks and behaves identically, not like a
// separate, lighter overlay. Reused by the file-tree "Set icon" picker and the
// editor's icon-field / `:`-emoji autocomplete galleries (via galleryStore).
import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { Modal } from "../Modal";
import { Button } from "../Button";
import { TextButton } from "../TextButton";
import { Icon } from "../../icons/Icon";
import { SearchBar } from "../SearchBar";
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
  let inputRef: HTMLInputElement | undefined;

  const results = createMemo(() => props.source.search(query()));

  onMount(() => inputRef?.focus());

  return (
    <Modal onClose={props.onClose} class="palette-panel icon-picker-panel">
      <SearchBar
        class="palette-search"
        inputClass="palette-input"
        inputRef={(el) => { inputRef = el; }}
        placeholder={props.title ?? props.source.placeholder}
        value={query()}
        onInput={setQuery}
      />
      <Show when={props.onClear}>
        <TextButton class="icon-picker-clear" onClick={() => { props.onClear!(); props.onClose(); }}>
          {props.clearLabel ?? "RESET TO DEFAULT"}
        </TextButton>
      </Show>
      <div class="icon-picker-grid">
        <For each={results().items}>
          {(item) => (
            <Button
              kind="icon"
              class="icon-picker-cell"
              classList={{ current: props.current === item.value }}
              aria-label={item.label}
              title={item.label}
              onClick={() => { props.onPick(item.value); props.onClose(); }}
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
