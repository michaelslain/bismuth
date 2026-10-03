// app/src/chat/ChatCommandOutputFrame.tsx — ChatCommandOutputFrame.module.css is the ONLY importer.
// The boxed "Command output" panel ChatTextBubble wraps a slash-command result in (like the Claude
// Code TUI's `/context` view): a small header over whatever body it is handed.
import type { Component, JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import styles from './ChatCommandOutputFrame.module.css'

export type ChatCommandOutputFrameProps = {
    children: JSX.Element
    class?: string
}

const ChatCommandOutputFrame: Component<ChatCommandOutputFrameProps> = props => {
    return (
        <div class={`${styles['chat-command-output']} ${props.class ?? ''}`}>
            <div class={styles['chat-command-output-head']}>
                <Icon value="SquareTerminal" /> Command output
            </div>
            {props.children}
        </div>
    )
}

export default ChatCommandOutputFrame
