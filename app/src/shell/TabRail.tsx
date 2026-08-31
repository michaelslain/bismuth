// app/src/shell/TabRail.tsx
// The app's ONLY tab presentation — a right-edge vertical rail. Collapsed (48px) it shows just the
// action toolbar + tab icons; expanded (232px, via :hover / :focus-within) it widens leftward over
// the editor without reflowing it. Lifted out of App.tsx verbatim.
//
// SHARES `TabRail.module.css` WITH `TabRailRow.tsx` — do not give TabRailRow its own module. Hashes
// are per-file, and eight hover/focus selectors span both components (`.tab-rail:hover
// .tab-rail-label`, `.tab-rail:focus-within .tab-rail-row.pinned .tab-pin`, …); splitting the module
// would silently break every one of them behind a green build (Trap 4). See TabRail.module.css's
// header for the full account, including the `docked`/`pane`/`dragging`-shaped traps this file does
// NOT have (no co-riding state classes live on this component's own elements).
//
// `data-tabstrip="vertical"` is a real attribute `dnd/viewDrag.ts:92` reads via
// `closest('[data-tabstrip="vertical"]')` — an ATTRIBUTE selector, not a class, so it is untouched
// by this migration.
import type { JSX } from 'solid-js'
import styles from './TabRail.module.css'

export function TabRail(props: {
    actions: JSX.Element
    children: JSX.Element
    /** Hold the rail expanded without the pointer on it (Alt+Shift+S / "Toggle tab rail"). */
    pinned?: boolean
}) {
    return (
        <div
            class={styles['tab-rail']}
            classList={{ [styles['rail-pinned']]: props.pinned }}
        >
            <div class={styles['tab-rail-inner']}>
                <div class={styles['tab-rail-actions']}>{props.actions}</div>
                <div class={styles['tab-rail-list']} data-tabstrip="vertical">
                    {props.children}
                </div>
            </div>
        </div>
    )
}
