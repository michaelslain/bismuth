import { Show, type Component, type JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import SettingsHint from './SettingsHint'
import styles from './SettingsField.module.css'

export type SettingsFieldProps = {
    label: JSX.Element
    /** Icon name, drawn in the accent colour before the label. */
    icon?: string
    /** Right-aligned badge on the label line. */
    badge?: 'required' | 'optional'
    hint?: JSX.Element
    /** Span both columns of a SettingsGrid. */
    span?: boolean
    class?: string
    children?: JSX.Element
}

/** One labelled control in a settings form: label line, the control, then an optional hint. */
const SettingsField: Component<SettingsFieldProps> = props => (
    <div
        data-testid="settings-field"
        class={[styles.field, props.span ? styles.span : '', props.class ?? '']
            .filter(Boolean)
            .join(' ')}
    >
        <div class={styles.label}>
            <Show when={props.icon}>
                {i => <Icon value={i()} size={14} strokeWidth={2} />}
            </Show>
            {props.label}
            <Show when={props.badge}>
                {b => (
                    <span class={b() === 'required' ? styles.req : styles.opt}>
                        {b()}
                    </span>
                )}
            </Show>
        </div>
        {props.children}
        <Show when={props.hint}>
            <SettingsHint>{props.hint}</SettingsHint>
        </Show>
    </div>
)

export default SettingsField
