import type { Component, JSX } from 'solid-js'
import BracketToggle from './BracketToggle'
import { isConfirmKey } from './widgetKeys'
import styles from './ToggleRow.module.css'

export type ToggleRowProps = {
    label: JSX.Element
    checked: boolean
    onToggle?: () => void
    /** Faint label: the thing this row names is currently off. */
    muted?: boolean
    /** Shown but not changeable. */
    locked?: boolean
    /** Let a sentence-length label wrap instead of truncating. */
    wrap?: boolean
    /** Native tooltip on the row, e.g. explaining why a locked row cannot change. */
    title?: string
    class?: string
}

/** One on/off row in a settings form. A real switch: focusable, Enter/Space toggle it. */
const ToggleRow: Component<ToggleRowProps> = props => {
    const toggle = () => {
        if (!props.locked) props.onToggle?.()
    }
    return (
        <div
            role="switch"
            aria-checked={props.checked}
            aria-disabled={props.locked ? 'true' : undefined}
            tabindex={props.locked ? -1 : 0}
            data-testid="toggle-row"
            class={[
                styles.row,
                props.muted ? styles.off : '',
                props.locked ? styles.locked : '',
                props.wrap ? styles.wrap : '',
                props.class ?? '',
            ].filter(Boolean).join(' ')}
            title={props.title}
            onClick={toggle}
            onKeyDown={e => {
                // ui-confirm (rebindable, default Enter) plus a hardcoded Space — Space is this
                // control's own activation gesture per the WAI-ARIA switch pattern, not a named
                // command, so it stays literal even though Enter now reads through the catalog.
                if (!isConfirmKey(e) && e.key !== ' ') return
                e.preventDefault()
                toggle()
            }}
        >
            <span class={styles.name}>{props.label}</span>
            <BracketToggle checked={props.checked} class={styles.toggle} />
        </div>
    )
}

export default ToggleRow
