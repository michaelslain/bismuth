import { Show } from 'solid-js'
import { IconButton } from '../ui/IconButton'
import Badge from '../ui/Badge'
import styles from './CommandButton.module.css'

// The purely-presentational rendering half of App.tsx's configurable toolbar button
// (shared by the sidebar header bar and the vertical tab rail): an icon button
// plus an optional numeric badge, wrapped so the two lay out as one inline row (Task 3 fix round
// 2 — see CommandButton.module.css's `.toolbar-badge` comment for why this is in-flow rather than
// an absolute corner overlay).
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
// `display: inline-flex; align-items: center; gap: var(--sp-1)` — it costs nothing extra when
// there is no badge (the `<Show>` below renders nothing, so the gap has no second child to apply
// to) — so this does not change the disabled button's own appearance; it only means a disabled
// button could in principle host a badge too, which no caller currently passes.
//
// `.toolbar-btn-wrap` / `.toolbar-badge` are reached through the imported `styles` object —
// bracket access, not `styles.toolbarBtnWrap`: Vite only exposes camelCase aliases under
// css.modules.localsConvention, which app/vite.config.ts does not set.
//
// `size="sm"` / a hardcoded `iconSize` are GONE (toolbar-iconbar plan, Task 3). Every caller of
// CommandButton now renders inside a `ui/IconBar` — the sidebar row and the tab rail's action
// row — and `IconBar` sets the toolbar box and glyph size for every
// `IconButton` beneath it via Solid context, with no `size`/`iconSize` from this component or its
// caller. An explicit `iconSize` prop passed to THIS component (a caller that genuinely wants a
// different glyph size than its bar) is still forwarded through and still wins, same as it always
// has on `IconButton` itself.
//
// `class` forwards onto the inner IconButton/Button, same shape as every other primitive in
// `ui/`. No caller passes it yet.
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
                disabled={props.disabled}
                label={props.label}
                onClick={props.onClick}
                class={props.class}
            />
            <Show when={(props.badge ?? 0) > 0}>
                <Badge variant="solid" class={styles['toolbar-badge']}>
                    {props.badge}
                </Badge>
            </Show>
        </div>
    )
}
