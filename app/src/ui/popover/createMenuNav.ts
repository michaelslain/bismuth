// app/src/ui/popover/createMenuNav.ts
// The keyboard behaviour shared by every navigable list: Up/Down move an active
// index (skipping disabled rows + wrapping), Enter activates it, Escape closes.
// ContextMenu and the command/quick-switcher palette both build on this so their
// nav can't drift apart. Pure logic — no DOM, no positioning; the caller decides
// where the returned keydown handler is attached (document vs the search input).
import { createSignal, type Accessor } from "solid-js";

export type MenuNav = {
  /** Index of the currently highlighted row (-1 when nothing is selectable). */
  active: Accessor<number>;
  setActive: (i: number) => void;
  /** Wire to a `keydown` (on document for ContextMenu, on the input for the palette). */
  onKeyDown: (e: KeyboardEvent) => void;
};

export function createMenuNav(opts: {
  /** Current row count (an accessor so a filtered/reactive list stays correct). */
  count: Accessor<number>;
  onSelect: (index: number) => void;
  onEscape?: () => void;
  /** Rows to skip while moving (e.g. disabled menu items). Default: none. */
  isDisabled?: (index: number) => boolean;
  /** Wrap past the ends. Default true (menus wrap; you can opt out for clamped lists). */
  wrap?: boolean;
}): MenuNav {
  const wrap = opts.wrap ?? true;
  const enabled = () => {
    const out: number[] = [];
    for (let i = 0; i < opts.count(); i++) if (!opts.isDisabled?.(i)) out.push(i);
    return out;
  };
  const [active, setActive] = createSignal<number>(enabled()[0] ?? -1);

  const move = (dir: 1 | -1) => {
    const idx = enabled();
    if (!idx.length) return;
    const cur = idx.indexOf(active());
    let next: number;
    if (cur === -1) next = dir === 1 ? 0 : idx.length - 1;
    else if (wrap) next = (cur + dir + idx.length) % idx.length;
    else next = Math.min(idx.length - 1, Math.max(0, cur + dir));
    setActive(idx[next]);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "Escape": opts.onEscape?.(); break;
      case "ArrowDown": e.preventDefault(); move(1); break;
      case "ArrowUp": e.preventDefault(); move(-1); break;
      case "Enter": {
        e.preventDefault();
        const i = active();
        if (i >= 0 && !opts.isDisabled?.(i)) opts.onSelect(i);
        break;
      }
    }
  };

  return { active, setActive, onKeyDown };
}
