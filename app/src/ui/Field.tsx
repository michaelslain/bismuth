import { type JSX } from 'solid-js'
import styles from './Field.module.css'

export type FieldProps = {
    label: JSX.Element
    class?: string
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
            <span>{props.label}</span>
            {props.children}
        </label>
    )
}

export default Field
