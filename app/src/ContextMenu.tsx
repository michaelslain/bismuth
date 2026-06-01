// app/src/ContextMenu.tsx
// PARENT 1 of the unified popover. We fully own this surface: cursor positioning,
// outside-click / Escape dismiss, and Up/Down/Enter keyboard nav. It renders the
// shared base (MenuRow + popover.css). The autocomplete is a SIBLING parent (it is
// CodeMirror-driven), not a child of this — see editor/completionDisplay.ts.
import { For, createSignal, onCleanup, onMount } from "solid-js";
import { MenuRow } from "./ui/popover/MenuRow";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  icon?: string;        // Lucide name
  detail?: string;      // right-aligned hint
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean; // draw a divider above this row
};

/** A cursor-positioned action menu. Closes on outside-click, Escape, or after a
 *  (non-disabled) item is chosen. Arrow keys move selection; Enter activates it. */
export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const selectable = () => props.items.map((it, i) => ({ it, i })).filter(({ it }) => !it.disabled);
  const [active, setActive] = createSignal<number>(selectable()[0]?.i ?? -1);

  const move = (dir: 1 | -1) => {
    const idx = selectable().map((s) => s.i);
    if (!idx.length) return;
    const cur = idx.indexOf(active());
    const next = cur === -1 ? (dir === 1 ? 0 : idx.length - 1) : (cur + dir + idx.length) % idx.length;
    setActive(idx[next]);
  };
  const activate = (i: number) => {
    const it = props.items[i];
    if (!it || it.disabled) return;
    it.onSelect();
    props.onClose();
  };

  const handleDocClick = () => props.onClose();
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return props.onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); activate(active()); }
  };

  onMount(() => {
    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener("click", handleDocClick), 0);
    document.addEventListener("keydown", handleKeydown);
  });
  onCleanup(() => {
    document.removeEventListener("click", handleDocClick);
    document.removeEventListener("keydown", handleKeydown);
  });

  return (
    <div
      class="oa-popover"
      style={{ position: "fixed", top: `${props.y}px`, left: `${props.x}px`, "z-index": 1000 }}
      onClick={(e) => e.stopPropagation()}
    >
      <For each={props.items}>
        {(item, i) => (
          <>
            {item.separatorBefore && <div class="oa-popover-sep" />}
            <MenuRow
              label={item.label}
              icon={item.icon}
              detail={item.detail}
              danger={item.danger}
              disabled={item.disabled}
              selected={active() === i()}
              onMouseEnter={() => !item.disabled && setActive(i())}
              onClick={() => activate(i())}
            />
          </>
        )}
      </For>
    </div>
  );
}
