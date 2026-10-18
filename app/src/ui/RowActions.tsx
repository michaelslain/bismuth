// app/src/ui/RowActions.tsx
// Controls that float over a row's trailing end while the row is hovered, selected or holds focus
// in them — a delete `[x]` on a list of logs or chats. They reserve NO column: at rest the row's
// text runs to its full width, and when they show they sit on a backing that fades in from the
// row's ground, so the text they cover never shows through and never collides with them.
//
// The row that holds them marks itself with the `data-row-actions-host` hook (a runtime hook, not a
// class, so this module can reach it); RowActions.module.css makes that row the positioning
// context and reveals the actions on its hover, its `data-selected` state, or focus inside them.
// Their own clicks and presses stop here, so an action never also picks or toggles the row.
import type { Component, JSX } from 'solid-js'
import styles from './RowActions.module.css'

export type RowActionsProps = {
    children: JSX.Element
    /** Shown regardless of hover (a story, or a row that is mid-action). */
    pinned?: boolean
    class?: string
}

const RowActions: Component<RowActionsProps> = props => (
    <div
        class={`${styles.actions} ${props.class ?? ''}`}
        data-row-actions
        data-pinned={props.pinned ? '' : undefined}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        onDblClick={e => e.stopPropagation()}
    >
        {props.children}
    </div>
)

export default RowActions
