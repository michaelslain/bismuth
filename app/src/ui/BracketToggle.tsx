import type { Component } from 'solid-js'
import styles from './BracketToggle.module.css'

export type BracketToggleProps = { checked: boolean; class?: string }

/** `[ ]` / `[x]`. Presentational: the row or label around it owns the click and the ARIA. */
const BracketToggle: Component<BracketToggleProps> = props => (
    <span
        aria-hidden="true"
        class={[styles.toggle, props.checked ? styles.on : '', props.class ?? ''].filter(Boolean).join(' ')}
    >
        <i />
    </span>
)

export default BracketToggle
