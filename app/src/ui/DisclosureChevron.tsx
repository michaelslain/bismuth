// The one disclosure chevron: a bare `ChevronRight` that turns a quarter turn when open. A
// disclosure is not an on/off toggle, so it never draws brackets at any state.
import { Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import PlainButton from './PlainButton'
import styles from './DisclosureChevron.module.css'

export type DisclosureChevronProps = {
    open: boolean
    /** Given: renders a button (`aria-expanded`, `aria-label` = `label`). Absent: an `aria-hidden`
     *  glyph inside a larger clickable header that owns the click and the `aria-expanded`. */
    onToggle?: () => void
    /** Accessible name of the button form. */
    label?: string
    /** Tab order of the button form; `-1` for a host that is itself one tab stop. */
    tabindex?: number
    /** Merged onto the root, so a caller can adjust one instance without forking the component. */
    class?: string
}

const DisclosureChevron: Component<DisclosureChevronProps> = props => {
    const glyph = () => (
        <span
            class={`${styles.chevron} ${props.open ? styles.open : ''}`}
            aria-hidden="true"
            data-disclosure-glyph
        >
            <Icon value="ChevronRight" />
        </span>
    )
    return (
        <Show
            when={props.onToggle}
            fallback={
                <span class={`${styles.root} ${props.class ?? ''}`}>
                    {glyph()}
                </span>
            }
        >
            <PlainButton
                class={`${styles.root} ${styles.button} ${props.class ?? ''}`}
                aria-expanded={props.open}
                aria-label={props.label}
                title={props.label}
                tabindex={props.tabindex}
                onClick={() => props.onToggle?.()}
            >
                {glyph()}
            </PlainButton>
        </Show>
    )
}

export default DisclosureChevron
export { DisclosureChevron }
