// app/src/ui/popover/MenuRow.tsx
// One popover row: [icon] label [detail]. Pure presentation — no positioning,
// no event wiring beyond the click/hover the parent passes in. Shared by the
// context menu; the autocomplete reproduces the SAME anatomy via CodeMirror's
// addToOptions (see editor/completionDisplay.ts), reading the same CSS classes.
import { Show, type JSX } from "solid-js";
import { Icon } from "../../icons/Icon";

export function MenuRow(props: {
  label: string;
  icon?: string;
  detail?: string;
  danger?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** Render a right-side chevron marking a nested submenu. */
  hasSubmenu?: boolean;
  onClick?: (e: MouseEvent) => void;
  onMouseEnter?: () => void;
}): JSX.Element {
  return (
    <div
      class="bismuth-popover-row"
      classList={{
        "bismuth-popover-row--selected": props.selected,
        "bismuth-popover-row--danger": props.danger,
        "bismuth-popover-row--disabled": props.disabled,
      }}
      onMouseEnter={() => props.onMouseEnter?.()}
      onClick={(e) => !props.disabled && props.onClick?.(e)}
    >
      <Show when={props.icon}>
        <span class="bismuth-popover-icon"><Icon value={props.icon!} size={14} /></span>
      </Show>
      <span class="bismuth-popover-label">{props.label}</span>
      <Show when={props.detail}>
        <span class="bismuth-popover-detail">{props.detail}</span>
      </Show>
      <Show when={props.hasSubmenu}>
        <span class="bismuth-popover-chev"><Icon value="ChevronRight" size={13} /></span>
      </Show>
    </div>
  );
}
