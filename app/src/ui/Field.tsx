import { type JSX } from 'solid-js'
import styles from './Field.module.css'

export type FieldProps = {
    label: JSX.Element
    class?: string
    /** Extra class merged onto the label's caption span, for a site that needs the label
     *  itself restyled (e.g. CardEditModal's micro-caps Title caption) without reaching
     *  into Field's internal DOM from outside. */
    labelClass?: string
    children: JSX.Element
}

/**
 * A label that wraps its control (label > span + control), the idiom repeated
 * across EventModal and BaseSettings (was .event-modal label / .srs-field /
 * .card-add-field). Pass `class` to keep a site-specific layout class.
 */
function Field(props: FieldProps) {
    return (
        <label class={`${styles['ui-field']} ${props.class ?? ''}`}>
            <span class={props.labelClass}>{props.label}</span>
            {props.children}
        </label>
    )
}

export default Field
