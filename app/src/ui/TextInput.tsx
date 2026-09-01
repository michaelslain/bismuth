import { splitProps, type JSX } from 'solid-js'
import './ui.css'

export type TextInputProps = {
    value: string
    onInput: (value: string) => void
    /** Render a multi-line `<textarea>` instead of a single-line `<input>`. */
    multiline?: boolean
    /** Drop the `.ui-input` surface/border chrome — for a field that reads as text rather than as
     *  a control (a modal's large title field, an inline rename). Keeps the shared sizing and
     *  focus behaviour; the call site supplies its own typography via `class`. */
    plain?: boolean
    class?: string
} & Omit<
    JSX.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onInput' | 'class'
>

/**
 * The standard single- or multi-line text field. Shares the `.ui-input` chrome
 * (surface fill, soft border, accent focus ring) with every other form control so
 * inputs/selects look identical. Pass `type="date"`/`"time"` etc. through `rest`.
 */
function TextInput(props: TextInputProps) {
    const [local, rest] = splitProps(props, [
        'value',
        'onInput',
        'multiline',
        'plain',
        'class',
    ])
    const cls = () =>
        `${local.plain ? 'ui-input-plain' : 'ui-input'} ${local.class ?? ''}`
    if (local.multiline) {
        return (
            <textarea
                class={cls()}
                value={local.value}
                onInput={e => local.onInput(e.currentTarget.value)}
                {...(rest as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
        )
    }
    return (
        <input
            class={cls()}
            value={local.value}
            onInput={e => local.onInput(e.currentTarget.value)}
            {...rest}
        />
    )
}

export default TextInput
export { TextInput }
