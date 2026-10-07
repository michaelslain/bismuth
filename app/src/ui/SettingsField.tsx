import {
    createUniqueId,
    onCleanup,
    onMount,
    Show,
    type Component,
    type JSX,
} from 'solid-js'
import SettingsHint from './SettingsHint'
import { observeFieldLabel } from './fieldLabelBinding'
import styles from './SettingsField.module.css'

export type SettingsFieldProps = {
    label: JSX.Element
    /** Right-aligned badge on the label line, rendered as plain text (no box). It has its own
     *  grid track, so it never wraps under a long label or changes the row's height. */
    badge?: 'required' | 'optional'
    hint?: JSX.Element
    /** Stack the control full-width under the label instead of sharing the label-column row. */
    span?: boolean
    class?: string
    /** Extra class merged onto the <label> itself, for a site that restyles the caption. */
    labelClass?: string
    children?: JSX.Element
}

/** One labelled control in a settings form: a label column + the control (and an optional hint
 *  under it) in the same row, keyed to the shared `--label-col` token so it lines up whether it
 *  sits inside a SettingsGrid or stands alone.
 *
 *  The label is a real `<label>` bound to the first control inside (see fieldLabelBinding.ts), so a
 *  screen reader announces it and a click on it focuses the control. This is THE field primitive:
 *  `ui/Field` is a deprecated alias of it. The label shares a first baseline with the control's
 *  value — both sit centred in the same `--h-control` box. */
const SettingsField: Component<SettingsFieldProps> = props => {
    const labelId = createUniqueId()
    let labelEl: HTMLLabelElement | undefined
    let controlEl: HTMLDivElement | undefined
    onMount(() => {
        if (!labelEl || !controlEl) return
        onCleanup(
            observeFieldLabel(
                labelEl,
                controlEl,
                () => props.badge === 'required',
            ),
        )
    })
    return (
        <div
            data-testid="settings-field"
            class={[
                styles.field,
                props.span ? styles.span : '',
                props.class ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <div class={styles.head}>
                <label
                    ref={labelEl}
                    id={`sf-${labelId}`}
                    class={[styles.label, props.labelClass ?? '']
                        .filter(Boolean)
                        .join(' ')}
                    title={
                        typeof props.label === 'string' ? props.label : undefined
                    }
                >
                    {props.label}
                </label>
                <Show when={props.badge}>
                    {b => (
                        <span
                            class={b() === 'required' ? styles.req : styles.opt}
                        >
                            {b() === 'required' ? 'req' : 'opt'}
                        </span>
                    )}
                </Show>
            </div>
            <div class={styles.control} ref={controlEl}>
                {props.children}
                <Show when={props.hint}>
                    <SettingsHint>{props.hint}</SettingsHint>
                </Show>
            </div>
        </div>
    )
}

export default SettingsField
