import type { Component, JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import FormControl from './FormControl'
import styles from './PromptInput.module.css'

export type PromptInputProps = {
    class?: string
    ref?: (el: HTMLInputElement) => void
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class' | 'ref'>

/**
 * A text input styled for <PromptModal> content — FolderPrompt's typed path, GcalConnectModal's
 * Client ID / Secret fields. Used to carry its own distinct chrome (a different font, padding,
 * background, focus treatment than ui/TextInput's `.ui-input` — see PromptInput.module.css for
 * why they were kept apart). The modal redesign (Task 3) unified every field onto FormControl's
 * shared chrome, so this now composes `<FormControl as="input">` exactly like TextInput does —
 * the same underline as TextInput and Select's trigger. Forwards every native input attribute,
 * so callers use it exactly like a plain `<input>`.
 */
const PromptInput: Component<PromptInputProps> = props => {
    const [local, rest] = splitProps(props, ['class'])
    return (
        <FormControl
            as="input"
            class={`${styles['prompt-input']} ${local.class ?? ''}`}
            {...(rest as JSX.InputHTMLAttributes<HTMLInputElement>)}
        />
    )
}

export default PromptInput
