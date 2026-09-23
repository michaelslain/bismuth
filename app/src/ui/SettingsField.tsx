import { Show, type Component, type JSX } from 'solid-js'
import SettingsHint from './SettingsHint'
import styles from './SettingsField.module.css'

export type SettingsFieldProps = {
    label: JSX.Element
    /** Right-aligned badge on the label line, rendered as plain text (no box). */
    badge?: 'required' | 'optional'
    hint?: JSX.Element
    /** Stack the control full-width under the label instead of sharing the label-column row. */
    span?: boolean
    class?: string
    children?: JSX.Element
}

/** One labelled control in a settings form: a label column + the control (and an optional hint
 *  under it) in the same row, keyed to the shared `--label-col` token so it lines up whether it
 *  sits inside a SettingsGrid or stands alone. */
const SettingsField: Component<SettingsFieldProps> = props => (
    <div
        data-testid="settings-field"
        class={[styles.field, props.span ? styles.span : '', props.class ?? '']
            .filter(Boolean)
            .join(' ')}
    >
        <div class={styles.label}>
            {props.label}
            <Show when={props.badge}>
                {b => (
                    <span class={b() === 'required' ? styles.req : styles.opt}>
                        {b()}
                    </span>
                )}
            </Show>
        </div>
        <div class={styles.control}>
            {props.children}
            <Show when={props.hint}>
                <SettingsHint>{props.hint}</SettingsHint>
            </Show>
        </div>
    </div>
)

export default SettingsField
