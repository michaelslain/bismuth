// The placeholder shown where a field has no value — an em dash, muted.
//
// Extracted per the visual-unification audit §6/§9.8. This was a bare `<span class="bismuth-empty">—</span>`
// written as a string literal in two different files, against a rule declared `:global()` in a
// third. Three places had to agree on a string for a one-character piece of UI to look right.
//
// It is a component rather than a constant because "how this app renders an absent value" is a real
// design decision with exactly one correct answer, and the em dash is only half of it — the muted
// tone is the other half, and a bare `—` in a caller's markup would silently lose it.
import { type Component } from 'solid-js'
import styles from './EmptyValue.module.css'

export type EmptyValueProps = {
    class?: string
    /** Override the glyph. Defaults to an em dash; a caller wanting "none" or "∅" passes it here
     *  rather than hand-rolling a span, so the muted tone still applies. */
    children?: string
}

const EmptyValue: Component<EmptyValueProps> = props => (
    <span class={`${styles.empty} ${props.class ?? ''}`}>
        {props.children ?? '—'}
    </span>
)

export default EmptyValue
export { EmptyValue }
