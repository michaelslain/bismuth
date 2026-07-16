// app/src/ContextMenu.tsx
// A cursor-positioned action menu. It owns only what's specific to a context menu:
// cursor placement, outside-click / Escape dismiss, closing after a pick, and ONE
// level of nested submenus (a row with `submenu` flies out a second <PopoverList> to
// its side). The SURFACE (chrome + rows) is the shared <PopoverList>; keyboard nav is
// the shared createMenuNav hook (one per level, but a single document listener so the
// two levels never both react to the same key).
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { PopoverList, type PopoverRow } from "./ui/popover/PopoverList";
import { createMenuNav } from "./ui/popover/createMenuNav";
import { registerActiveMenu } from "./activeMenu";
import { Icon } from "./icons/Icon";

export type MenuItem = PopoverRow & {
  /** Run when the row is picked. Optional for rows that only open a `submenu`. */
  onSelect?: () => void;
  /** Nested rows; a row with a non-empty submenu opens a flyout instead of selecting. */
  submenu?: MenuItem[];
};

/** A top-level action shown as an icon on the RAIL beside the menu, instead of as a row
 *  inside it — for actions that must stay visible rather than compete with a long option
 *  list (the emoji library, #67). `label` is the tooltip/aria-label; it isn't drawn. */
export type QuickAction = { icon: string; label: string; onSelect: () => void };

// Estimated flyout width, used only to decide whether to flip the submenu to the
// left when there isn't room on the right. The actual width is the popover min-width.
const SUB_WIDTH = 190;

// The rail's own footprint — button (30) + .bismuth-popover padding (2×4) + border (2×1).
// Fixed, so the rail can be placed to the LEFT of the menu without measuring it first
// (its right edge is the menu's left edge, which is just props.x). Keep in sync with
// `.bismuth-popover-rail*` in ui/popover/popover.css.
const RAIL_WIDTH = 40;
const RAIL_GAP = 6;

/** Closes on outside-click, Escape, or after a (non-disabled) leaf item is chosen.
 *  Arrow keys move selection; Right opens a submenu, Left closes it; Enter activates. */
export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; quickActions?: QuickAction[]; onClose: () => void }) {
  let rootEl: HTMLDivElement | undefined;
  // The open submenu: which parent row, and where to place its flyout.
  const [sub, setSub] = createSignal<{ index: number; x: number; y: number } | null>(null);
  // Measured menu width — needed ONLY for the left-edge flip below. Re-measured when the rows
  // change, since a different menu is a different width.
  const [menuW, setMenuW] = createSignal(0);
  createEffect(() => {
    props.items; // track: re-measure when this menu's rows change
    setMenuW(rootEl?.getBoundingClientRect().width ?? 0);
  });
  // Rail x, DERIVED (not a one-shot signal): <Show> isn't keyed, so a second right-click reuses
  // this component and only updates props — a snapshot taken at creation would strand the rail at
  // the first menu's position. The menu's left edge IS props.x, so the normal case needs no
  // measurement and paints correctly on the first frame. Right-clicking near the left viewport
  // edge leaves no room, so the rail flips to hang off the menu's RIGHT edge instead.
  const railX = () => {
    const left = props.x - RAIL_WIDTH - RAIL_GAP;
    return left >= RAIL_GAP ? left : props.x + menuW() + RAIL_GAP;
  };
  const subItems = (): MenuItem[] => {
    const s = sub();
    return s ? props.items[s.index]?.submenu ?? [] : [];
  };

  const openSub = (i: number) => {
    const item = props.items[i];
    if (!item?.submenu?.length) return;
    const rowEl = rootEl?.querySelectorAll(".bismuth-popover-row")[i] as HTMLElement | undefined;
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

  // Global single-menu exclusivity: registering as the active menu closes any menu that
  // was already open on ANY other surface (this is the one funnel every context menu —
  // App's pane/editor/create menus, FileTree, DaemonList, chat bubbles, task status,
  // calendar chips — passes through, since they all render this component). A right-click
  // that opens a new menu no longer leaves another surface's menu on screen.
  let disposeActive: (() => void) | undefined;

  onMount(() => {
    disposeActive = registerActiveMenu(() => props.onClose());
    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener("click", handleDocClick), 0);
    document.addEventListener("keydown", onKeyDown);
  });
  onCleanup(() => {
    disposeActive?.();
    document.removeEventListener("click", handleDocClick);
    document.removeEventListener("keydown", onKeyDown);
  });

  // Mark rows that open a submenu so MenuRow draws the chevron.
  const parentRows = () => props.items.map((it) => (it.submenu?.length ? { ...it, hasSubmenu: true } : it));

  return (
    <>
      {/* Quick-action rail: icon buttons pinned BESIDE the menu (to its left), never inside
          the option list — so they stay visible however long the list gets (#67). */}
      <Show when={props.quickActions?.length}>
        <div
          class="bismuth-popover bismuth-popover-rail"
          style={{ position: "fixed", top: `${props.y}px`, left: `${railX()}px`, "z-index": 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <For each={props.quickActions}>
            {(a) => (
              <button
                type="button"
                class="bismuth-popover-rail-btn"
                title={a.label}
                aria-label={a.label}
                onClick={() => {
                  a.onSelect();
                  props.onClose();
                }}
              >
                <Icon value={a.icon} size={16} />
              </button>
            )}
          </For>
        </div>
      </Show>
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
