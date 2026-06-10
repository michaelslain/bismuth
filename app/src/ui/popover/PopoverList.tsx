// app/src/ui/popover/PopoverList.tsx
// The popover SURFACE: the .oa-popover container + a list of <MenuRow>s with
// separators. Pure presentation — no positioning, no dismiss, no keyboard (the
// parent owns those, e.g. ContextMenu adds cursor placement + outside-click +
// createMenuNav). This is the one Solid surface every menu-style popover renders,
// so the chrome can't drift. The autocomplete can't use it (CodeMirror owns its
// list DOM) — it matches via the shared tokens in popover.css instead.
import { For, type JSX } from "solid-js";
import { MenuRow } from "./MenuRow";

export type PopoverRow = {
  label: string;
  icon?: string;
  detail?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
};

export function PopoverList(props: {
  items: PopoverRow[];
  /** Index of the highlighted row (from createMenuNav). */
  active?: number;
  onActivate: (index: number) => void;
  onHover?: (index: number) => void;
  /** Inline style for the container (ContextMenu passes fixed x/y/z-index). */
  style?: JSX.CSSProperties;
  /** Extra class on the container (additive; e.g. Select's `.ui-select-list`). */
  class?: string;
}) {
  return (
    <div class={`oa-popover ${props.class ?? ""}`} style={props.style} onClick={(e) => e.stopPropagation()}>
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
              selected={props.active === i()}
              onMouseEnter={() => !item.disabled && props.onHover?.(i())}
              onClick={() => props.onActivate(i())}
            />
          </>
        )}
      </For>
    </div>
  );
}
