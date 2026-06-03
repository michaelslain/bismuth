// app/src/ContextMenu.tsx
// A cursor-positioned action menu. It owns only what's specific to a context menu:
// cursor placement, outside-click / Escape dismiss, and closing after a pick. The
// SURFACE (chrome + rows) is the shared <PopoverList>; the keyboard nav is the
// shared createMenuNav hook. The autocomplete is a SIBLING surface (CodeMirror-
// driven) that matches via the same popover.css tokens — see editor/completionDisplay.ts.
import { onCleanup, onMount } from "solid-js";
import { PopoverList, type PopoverRow } from "./ui/popover/PopoverList";
import { createMenuNav } from "./ui/popover/createMenuNav";

export type MenuItem = PopoverRow & { onSelect: () => void };

/** Closes on outside-click, Escape, or after a (non-disabled) item is chosen.
 *  Arrow keys move selection; Enter activates it. */
export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const activate = (i: number) => {
    const it = props.items[i];
    if (!it || it.disabled) return;
    it.onSelect();
    props.onClose();
  };

  const nav = createMenuNav({
    count: () => props.items.length,
    isDisabled: (i) => props.items[i]?.disabled === true,
    onSelect: activate,
    onEscape: () => props.onClose(),
  });

  const handleDocClick = () => props.onClose();

  onMount(() => {
    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener("click", handleDocClick), 0);
    document.addEventListener("keydown", nav.onKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener("click", handleDocClick);
    document.removeEventListener("keydown", nav.onKeyDown);
  });

  return (
    <PopoverList
      items={props.items}
      active={nav.active()}
      onActivate={activate}
      onHover={nav.setActive}
      style={{ position: "fixed", top: `${props.y}px`, left: `${props.x}px`, "z-index": 1000 }}
    />
  );
}
