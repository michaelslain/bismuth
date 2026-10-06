// app/src/shell/TabRail.tsx
// The app's ONLY tab presentation — a vertical rail on either edge. Collapsed (46px) it shows just the
// action toolbar + tab icons; expanded (232px, via :hover / :focus-within) it widens toward the
// editor without reflowing it. Lifted out of App.tsx verbatim.
//
// TabRailRow.tsx now has its OWN module (TabRailRow.module.css, task 11 of ds-conformance). This
// component's root carries `data-tab-rail` + `data-rail-pinned` — stable, UNHASHED attributes that
// let TabRailRow.module.css's rules reach "the rail is hovered/pinned" without needing this file's
// hashed `.tab-rail`/`.rail-pinned` class names, which a rule in a different module could never
// match. See TabRail.module.css's header and TabRailRow.module.css's header for the full account.
//
// `data-tabstrip="vertical"` is a real attribute `dnd/viewDrag.ts:92` reads via
// `closest('[data-tabstrip="vertical"]')` — an ATTRIBUTE selector, not a class, so it is untouched
// by this migration.
import { Show, createSignal, createEffect, on, type JSX } from 'solid-js'
import styles from './TabRail.module.css'
import IconBar from '../ui/IconBar'

export function TabRail(props: {
    actions: JSX.Element
    children: JSX.Element
    /** Hold the rail expanded without the pointer on it (Alt+Shift+S / "Toggle tab rail"). */
    pinned?: boolean
    /** The `<EdgeHandle>` on the rail's editor-side line — drag to set the open width, click to pin.
     *  Placed here, riding the surface's edge as it opens and closes; built by the caller. */
    edge?: JSX.Element
    /** A width drag is live — the open/close animation is switched off so the edge tracks the
     *  pointer instead of easing after it. */
    resizing?: boolean
    /** Which window edge the rail sits against. `left` mirrors the surface: anchored left, border
     *  on its right, flyout widening rightward, edge strip on the right line. Default `right`. */
    side?: 'left' | 'right'
}) {
    // Unpinned UNDER THE POINTER (the edge line or its chevron was just clicked): hold off the
    // hover-expand until the pointer leaves, or the unpin would look like it did nothing — the
    // rail would stay open on `:hover`. Whether the pointer is on the rail is tracked from its own
    // pointerenter/leave, NOT `matches(':hover')`: a click on the edge strip holds pointer capture,
    // and Chrome has not recomputed `:hover` by the time the unpin lands (measured: false). An
    // unpin from the keyboard with the pointer elsewhere therefore never suppresses the next hover.
    const [pointerIn, setPointerIn] = createSignal(false)
    const [hoverOff, setHoverOff] = createSignal(false)
    createEffect(
        on(
            () => !!props.pinned,
            // NOT `{ defer: true }`: a deferred `on` skips recording the first input, so the
            // first unpin would see `was === undefined` and never suppress.
            (pinned, was) => {
                if (was && !pinned && pointerIn()) setHoverOff(true)
            },
        ),
    )
    return (
        <div
            onPointerEnter={() => setPointerIn(true)}
            onPointerLeave={() => {
                setPointerIn(false)
                setHoverOff(false)
            }}
            data-hover-off={hoverOff() ? 'true' : undefined}
            class={styles['tab-rail']}
            classList={{
                [styles['rail-pinned']]: props.pinned,
                [styles['resizing']]: props.resizing,
                [styles['hover-off']]: hoverOff(),
                [styles['side-left']]: props.side === 'left',
            }}
            data-rail-side={props.side === 'left' ? 'left' : 'right'}
            data-tab-rail="true"
            data-rail-pinned={props.pinned ? 'true' : undefined}
        >
            <div class={styles['tab-rail-inner']}>
                <IconBar
                    band
                    layout="wrap"
                    label="Tab actions"
                    class={styles['tab-rail-actions']}
                >
                    {props.actions}
                </IconBar>
                <div class={styles['tab-rail-list']} data-tabstrip="vertical">
                    {props.children}
                </div>
            </div>
            <Show when={props.edge}>
                <div class={styles['rail-edge']}>{props.edge}</div>
            </Show>
        </div>
    )
}
