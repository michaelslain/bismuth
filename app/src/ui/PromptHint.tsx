import type { Component, JSX } from 'solid-js'
import styles from './PromptHint.module.css'

export type PromptHintProps = {
    children: JSX.Element
    class?: string
}

/**
 * A muted status/info paragraph inside a <PromptModal> — a description, a loading message, a
 * connection status, a warning list. Used anywhere from once to several times per modal,
 * frequently behind a <Show>, so it stays a dumb presentational wrapper: every existing branch
 * keeps rendering exactly as it did as a raw `<div class="folder-prompt-hint">`.
 */
const PromptHint: Component<PromptHintProps> = props => {
    return (
        <div class={`${styles['prompt-hint']} ${props.class ?? ''}`}>
            {props.children}
        </div>
    )
}

export default PromptHint
