import { Show } from 'solid-js'
import { IconButton } from '../ui/IconButton'
import Badge from '../ui/Badge'
import styles from './CommandButton.module.css'

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
// `.toolbar-btn-wrap` / `.toolbar-badge` are reached through the imported `styles` object —
// bracket access, not `styles.toolbarBtnWrap`: Vite only exposes camelCase aliases under
// css.modules.localsConvention, which app/vite.config.ts does not set.
//
// `size="sm"` IS this component's concern now (2026-08-27, visual-unification wave 2) — every
// caller of CommandButton wants the fixed toolzone box (ui/ui.css's `.btn--icon.btn--sm`), so it
// is hardcoded here rather than threaded as a prop nobody would ever set differently. This used
// to be a per-PARENT `:global(.btn--icon)` CSS override copied into Sidebar/TabRail/EmptyPane's
// own modules; giving the component the size fixes every caller from one place.
//
// `class` (one-global-followups Task 2) forwards onto the inner IconButton/Button, same shape as
// every other primitive in `ui/`. No caller passes it yet — App.tsx's `ToolbarButton` (which
// actually instantiates this component for the sidebar bar, the tab rail and the top strip) is
// out of this task's file scope, so wiring a per-container local class through it is follow-up
// work, reported rather than done here.
//
// `data-command-icon="true"` is the real fix for THIS task's job (Sidebar/TabRail/TopStrip no
// longer reaching `.btn--icon` via `:global()`): those three containers still need a per-parent
// override of the toolzone box (Sidebar/TabRail want `--bar-icon-size` = 18px; Button.module.css's
// own `.btn--icon.btn--sm` default is 24px — genuinely different values, not a duplicate to
// delete), but since App.tsx is the one instantiating this component, there is no scoped `class`
// they can attach yet. An unhashed `data-*` attribute is this repo's existing escape hatch for
// exactly that shape (see `data-sidebar-toolbar`/`data-tab-rail`/`data-pane-leaf`) — a plain
// attribute selector, never a class-name reach, so it carries no `globalReach` bridge at all
// instead of a permanent `:global()` one. Sidebar.module.css/TabRail.module.css/TopStrip.module.css
// now select `[data-command-icon]` scoped under their own container class.
export function CommandButton(props: {
    icon: string
    label: string
    iconSize?: number
    disabled?: boolean
    /** Rendered only when greater than 0. */
    badge?: number
    onClick?: (e: MouseEvent) => void
    /** Forwarded onto the inner Button. No current caller sets this — see header comment. */
    class?: string
}) {
    return (
        <div class={styles['toolbar-btn-wrap']}>
            <IconButton
                icon={props.icon}
                iconSize={props.iconSize}
                size="sm"
                disabled={props.disabled}
                label={props.label}
                onClick={props.onClick}
                class={props.class}
                data-command-icon="true"
            />
            <Show when={(props.badge ?? 0) > 0}>
                <Badge variant="solid" class={styles['toolbar-badge']}>
                    {props.badge}
                </Badge>
            </Show>
        </div>
    )
}
