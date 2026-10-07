import { type Component, type JSX } from 'solid-js'
import SettingsField from './SettingsField'
import styles from './Field.module.css'

export type FieldProps = {
    label: JSX.Element
    class?: string
    /** Extra class merged onto the label, for a site that needs the caption itself restyled (e.g.
     *  CardEditModal's micro-caps Title caption) without reaching into the DOM from outside. */
    labelClass?: string
    children: JSX.Element
}

/**
 * @deprecated Use `SettingsField` — this is a thin alias of it, kept so existing imports keep
 * working. Field and SettingsField were two primitives for one job (a caption beside a control);
 * the one 27 files adopted rendered its label as a bare <div> nothing associated with the control,
 * so SettingsField won and became a real <label> bound to its control (ds-improve-r1 Task 13).
 * The only thing Field keeps of its own is the content-sized label column (`Field.module.css`),
 * for a narrow form where the 20-cell `--label-col` would leave a dead gap.
 */
const Field: Component<FieldProps> = props => (
    <SettingsField
        label={props.label}
        labelClass={props.labelClass}
        class={`${styles['ui-field']} ${props.class ?? ''}`.trim()}
    >
        {props.children}
    </SettingsField>
)

export default Field
