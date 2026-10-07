import type { Component } from 'solid-js'
import styles from './BracketToggle.module.css'

/** The two marks a task box shows beyond `[ ]` / `[x]`: `[/]` under way, `[-]` cancelled. */
export type BracketToggleState = 'doing' | 'cancelled'

export type BracketToggleProps = {
    checked: boolean
    /** A third and fourth glyph for a four-state box (a task: `[/]` doing, `[-]` cancelled). It
     *  wins over `checked`. Absent, the toggle is the plain two-state `[ ]` / `[x]`. */
    state?: BracketToggleState
    class?: string
}

/** `[ ]` / `[x]` (and `[/]` / `[-]` via `state`). Presentational: the row or label around it owns
 *  the click and the ARIA. */
const BracketToggle: Component<BracketToggleProps> = props => (
    <span
        aria-hidden="true"
        class={[
            styles.toggle,
            props.checked && !props.state ? styles.on : '',
            props.state ? styles[props.state] : '',
            props.class ?? '',
        ]
            .filter(Boolean)
            .join(' ')}
    >
        <i />
    </span>
)

export default BracketToggle
