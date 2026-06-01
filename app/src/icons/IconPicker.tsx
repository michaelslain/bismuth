// app/src/icons/IconPicker.tsx
//
// A searchable grid of every Lucide icon. Used by the file tree's right-click
// "Set icon" on files (writes the `icon:` frontmatter) and folders (writes the
// folder-icon override). Reuses the command-palette overlay/panel styling.
import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { allIcons } from "./registry";
import { TextButton } from "../ui/TextButton";
import { IconButton } from "../ui/IconButton";
import { SearchBar } from "../ui/SearchBar";

type Props = {
  /** Placeholder / heading for the search box. */
  title?: string;
  /** Currently-selected icon name, highlighted in the grid. */
  current?: string;
  onPick: (name: string) => void;
  /** When provided, shows a "Reset to default" action that clears the icon. */
  onClear?: () => void;
  onClose: () => void;
};

// Cap rendered cells: there are ~1700 icons; rendering all SVGs at once janks.
// Search narrows the set, so the cap only bites on the unfiltered view.
const MAX_CELLS = 300;

export function IconPicker(props: Props) {
  const [query, setQuery] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  const results = createMemo(() => {
    const q = query().trim().toLowerCase();
    const all = allIcons();
    if (!q) return { items: all.slice(0, MAX_CELLS), total: all.length };
    const starts: typeof all = [];
    const includes: typeof all = [];
    for (const e of all) {
      const n = e.name.toLowerCase();
      if (n.startsWith(q)) starts.push(e);
      else if (n.includes(q)) includes.push(e);
    }
    const ranked = starts.concat(includes);
    return { items: ranked.slice(0, MAX_CELLS), total: ranked.length };
  });

  onMount(() => inputRef?.focus());

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };

  return (
    <Portal>
      <div class="palette-overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="palette-panel icon-picker-panel">
          <SearchBar
            inputRef={(el) => { inputRef = el; }}
            inputClass="palette-input"
            placeholder={props.title ?? "Search icons…"}
            value={query()}
            onInput={setQuery}
            onKeyDown={onKeyDown}
          />
          <Show when={props.onClear}>
            <TextButton class="icon-picker-clear" onClick={() => { props.onClear!(); props.onClose(); }}>
              RESET TO DEFAULT ICON
            </TextButton>
          </Show>
          <div class="icon-picker-grid">
            <For each={results().items}>
              {(e) => (
                <IconButton
                  class="icon-picker-cell"
                  classList={{ current: props.current === e.name }}
                  label={e.name}
                  icon={e.name}
                  iconSize={20}
                  onClick={() => { props.onPick(e.name); props.onClose(); }}
                />
              )}
            </For>
            <Show when={results().items.length === 0}>
              <div class="palette-empty">No icons match</div>
            </Show>
          </div>
          <Show when={results().total > results().items.length}>
            <div class="icon-picker-more">
              Showing {results().items.length} of {results().total} — keep typing to narrow.
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
