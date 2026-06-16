// app/src/ContextMenu.tsx
// A cursor-positioned action menu. It owns only what's specific to a context menu:
// cursor placement, outside-click / Escape dismiss, closing after a pick, and ONE
// level of nested submenus (a row with `submenu` flies out a second <PopoverList> to
// its side). The SURFACE (chrome + rows) is the shared <PopoverList>; keyboard nav is
// the shared createMenuNav hook (one per level, but a single document listener so the
// two levels never both react to the same key).
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { PopoverList, type PopoverRow } from "./ui/popover/PopoverList";
import { createMenuNav } from "./ui/popover/createMenuNav";

export type MenuItem = PopoverRow & {
  /** Run when the row is picked. Optional for rows that only open a `submenu`. */
  onSelect?: () => void;
  /** Nested rows; a row with a non-empty submenu opens a flyout instead of selecting. */
  submenu?: MenuItem[];
};

// Estimated flyout width, used only to decide whether to flip the submenu to the
// left when there isn't room on the right. The actual width is the popover min-width.
const SUB_WIDTH = 190;

/** Closes on outside-click, Escape, or after a (non-disabled) leaf item is chosen.
 *  Arrow keys move selection; Right opens a submenu, Left closes it; Enter activates. */
export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  let rootEl: HTMLDivElement | undefined;
  // The open submenu: which parent row, and where to place its flyout.
  const [sub, setSub] = createSignal<{ index: number; x: number; y: number } | null>(null);
  const subItems = (): MenuItem[] => {
    const s = sub();
    return s ? props.items[s.index]?.submenu ?? [] : [];
  };

  const openSub = (i: number) => {
    const item = props.items[i];
    if (!item?.submenu?.length) return;
    const rowEl = rootEl?.querySelectorAll(".oa-popover-row")[i] as HTMLElement | undefined;
    const pr = rootEl?.getBoundingClientRect();
    const rr = rowEl?.getBoundingClientRect();
    const right = pr ? pr.right : props.x;
    const left = pr ? pr.left : props.x;
    // Flip to the left edge when the flyout would overflow the viewport on the right.
    const x = right + SUB_WIDTH > window.innerWidth ? Math.max(2, left - SUB_WIDTH + 2) : right - 2;
    const y = rr ? rr.top : props.y;
    setSub({ index: i, x, y });
    subNav.setActive(0);
  };

  const parentActivate = (i: number) => {
    const it = props.items[i];
    if (!it || it.disabled) return;
    if (it.submenu?.length) { openSub(i); return; }
    it.onSelect?.();
    props.onClose();
  };

  const parentHover = (i: number) => {
    nav.setActive(i);
    const it = props.items[i];
    // Hover a submenu row → open its flyout; hover any other row → close an open one.
    if (it?.submenu?.length) openSub(i);
    else setSub(null);
  };

  const subActivate = (j: number) => {
    const it = subItems()[j];
    if (!it || it.disabled) return;
    it.onSelect?.();
    props.onClose();
  };

  const nav = createMenuNav({
    count: () => props.items.length,
    isDisabled: (i) => props.items[i]?.disabled === true,
    onSelect: parentActivate,
    onEscape: () => props.onClose(),
  });
  const subNav = createMenuNav({
    count: () => subItems().length,
    isDisabled: (j) => subItems()[j]?.disabled === true,
    onSelect: subActivate,
    onEscape: () => setSub(null),
  });

  // Single document keydown owner. When a submenu is open it takes Up/Down/Enter/Escape
  // and Left closes it; otherwise the parent nav drives and Right opens a submenu.
  const onKeyDown = (e: KeyboardEvent) => {
    if (sub()) {
      if (e.key === "ArrowLeft") { e.preventDefault(); setSub(null); return; }
      subNav.onKeyDown(e);
      return;
    }
    if (e.key === "ArrowRight") {
      const i = nav.active();
      if (props.items[i]?.submenu?.length) { e.preventDefault(); openSub(i); }
      return;
    }
    nav.onKeyDown(e);
  };

  const handleDocClick = () => props.onClose();

  onMount(() => {
    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener("click", handleDocClick), 0);
    document.addEventListener("keydown", onKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener("click", handleDocClick);
    document.removeEventListener("keydown", onKeyDown);
  });

  // Mark rows that open a submenu so MenuRow draws the chevron.
  const parentRows = () => props.items.map((it) => (it.submenu?.length ? { ...it, hasSubmenu: true } : it));

  return (
    <>
      <PopoverList
        ref={(el) => (rootEl = el)}
        items={parentRows()}
        active={nav.active()}
        onActivate={parentActivate}
        onHover={parentHover}
        style={{ position: "fixed", top: `${props.y}px`, left: `${props.x}px`, "z-index": 1000 }}
      />
      <Show when={sub()}>
        {(s) => (
          <PopoverList
            items={subItems()}
            active={subNav.active()}
            onActivate={subActivate}
            onHover={(j) => subNav.setActive(j)}
            style={{ position: "fixed", top: `${s().y}px`, left: `${s().x}px`, "z-index": 1001 }}
          />
        )}
      </Show>
    </>
  );
}
