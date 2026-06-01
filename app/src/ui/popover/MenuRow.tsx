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
  onClick?: (e: MouseEvent) => void;
  onMouseEnter?: () => void;
}): JSX.Element {
  return (
    <div
      class="oa-popover-row"
      classList={{
        "oa-popover-row--selected": props.selected,
        "oa-popover-row--danger": props.danger,
        "oa-popover-row--disabled": props.disabled,
      }}
      onMouseEnter={() => props.onMouseEnter?.()}
      onClick={(e) => !props.disabled && props.onClick?.(e)}
    >
      <Show when={props.icon}>
        <span class="oa-popover-icon"><Icon value={props.icon!} size={14} /></span>
      </Show>
      <span class="oa-popover-label">{props.label}</span>
      <Show when={props.detail}>
        <span class="oa-popover-detail">{props.detail}</span>
      </Show>
    </div>
  );
}
