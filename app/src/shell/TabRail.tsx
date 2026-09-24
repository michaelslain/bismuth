// app/src/shell/TabRail.tsx
// The app's ONLY tab presentation — a right-edge vertical rail. Collapsed (48px) it shows just the
// action toolbar + tab icons; expanded (232px, via :hover / :focus-within) it widens leftward over
// the editor without reflowing it. Lifted out of App.tsx verbatim.
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
import type { JSX } from 'solid-js'
import styles from './TabRail.module.css'
import IconBar from '../ui/IconBar'

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
        </div>
    )
}
