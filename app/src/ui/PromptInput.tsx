import type { Component, JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import styles from './PromptInput.module.css'

export type PromptInputProps = {
    class?: string
    ref?: (el: HTMLInputElement) => void
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class' | 'ref'>

/**
 * A text input styled for <PromptModal> content — FolderPrompt's typed path, GcalConnectModal's
 * Client ID / Secret fields. Its own chrome (narrower padding scale, an explicit monospace font
 * for typed paths/ids), distinct from ui/TextInput's `.ui-input` — see PromptInput.module.css
 * for the diff and why the two were left separate. Forwards every native input attribute, so
 * callers use it exactly like a plain `<input>`.
 */
const PromptInput: Component<PromptInputProps> = props => {
    const [local, rest] = splitProps(props, ['class', 'ref'])
    return (
        <input
            class={`${styles['prompt-input']} ${local.class ?? ''}`}
            ref={local.ref}
            {...rest}
        />
    )
}

export default PromptInput
