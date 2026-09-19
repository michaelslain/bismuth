import { splitProps, type JSX } from 'solid-js'
import './ui.css'
import styles from './TextInput.module.css'

export type TextInputProps = {
    value: string
    onInput: (value: string) => void
    /** Drop the `.ui-input` chrome entirely — not just the border. This strips the surface
     *  fill, the padding/box-sizing, AND the shared accent focus ring; the call site owns its
     *  own focus treatment (e.g. `.evm-titlein:focus { border-bottom-color: var(--accent) }`).
     *  For a field that reads as text rather than as a control — a modal's large title field,
     *  an inline rename — where the call site supplies its own typography AND focus state via
     *  `class`. */
    plain?: boolean
    class?: string
} & (
    | ({
          /** Render a multi-line `<textarea>` instead of a single-line `<input>`. A literal
           *  `true` (not a plain `boolean`) so this discriminates the union below: `multiline`
           *  gets `<textarea>`-shaped attrs (`ref: (el: HTMLTextAreaElement) => void`, `rows`,
           *  `cols`, …); the other branch gets `<input>`-shaped attrs. A call site that needs to
           *  pick the mode at runtime branches in JSX rather than passing a computed boolean —
           *  see TextInput.stories.tsx's `Controlled` helper. */
          multiline: true
      } & Omit<
          JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
          'value' | 'onInput' | 'class'
      >)
    | ({ multiline?: false } & Omit<
          JSX.InputHTMLAttributes<HTMLInputElement>,
          'value' | 'onInput' | 'class'
      >)
)

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
        `${local.plain ? styles['ui-input-plain'] : 'ui-input'} ${local.class ?? ''}`
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
            {...(rest as JSX.InputHTMLAttributes<HTMLInputElement>)}
        />
    )
}

export default TextInput
export { TextInput }
