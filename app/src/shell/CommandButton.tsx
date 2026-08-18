import { Show } from "solid-js";
import { IconButton } from "../ui/IconButton";

// The purely-presentational rendering half of App.tsx's configurable toolbar button (shared by
// the sidebar header bar, the horizontal tab strip, and the vertical tab rail): an icon button
// plus an optional numeric badge, wrapped so the badge can position itself absolutely against it.
//
// WHAT DELIBERATELY STAYED IN App.tsx (as the local `ToolbarButton` wrapper): resolving a
// `{command}` / `{commands: [...]}` config to a live Command via `resolveButtonCommands`, hiding
// the inbox button entirely while `settings.daemon.enabled` is off, and computing the inbox's live
// `dueCount()` badge. None of that is presentational — it reads app state this component must not
// know about — so `ToolbarButton` resolves it and hands this component plain props.
//
// ONE BEHAVIOURAL NOTE: the pre-extraction "unknown command" fallback rendered a bare
// `<IconButton disabled>` with no `.toolbar-btn-wrap` around it. This component always wraps,
// including when `disabled` is true, so both branches now share one shape. `.toolbar-btn-wrap` is
// `position: relative; display: inline-flex` — a non-visual sizing box — so this does not change
// the disabled button's own appearance; it only means a disabled button could in principle host a
// badge too, which no caller currently passes.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only.
export function CommandButton(props: {
  icon: string;
  label: string;
  iconSize?: number;
  disabled?: boolean;
  /** Rendered only when greater than 0. */
  badge?: number;
  onClick?: (e: MouseEvent) => void;
}) {
  return (
    <span class="toolbar-btn-wrap">
      <IconButton
        icon={props.icon}
        iconSize={props.iconSize}
        disabled={props.disabled}
        label={props.label}
        onClick={props.onClick}
      />
      <Show when={(props.badge ?? 0) > 0}>
        <span class="toolbar-badge">{props.badge}</span>
      </Show>
    </span>
  );
}
