// app/src/chat/ChatCommandOutputFrame.tsx — ChatCommandOutputFrame.module.css is the ONLY importer.
// The boxed "command output" panel ChatTextBubble wraps a slash-command result in (like the Claude
// Code TUI's `/context` view): a `ui/Card` with a lowercase caption (`ui/SectionLabel`) over
// whatever body it is handed. It was a bordered box of its own with an UPPERCASE tracked head.
import type { Component, JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import Card from '../ui/Card'
import SectionLabel from '../ui/SectionLabel'
import styles from './ChatCommandOutputFrame.module.css'

export type ChatCommandOutputFrameProps = {
    children: JSX.Element
    class?: string
}

const ChatCommandOutputFrame: Component<ChatCommandOutputFrameProps> = props => {
    return (
        <Card class={`${styles['chat-command-output']} ${props.class ?? ''}`}>
            <SectionLabel class={styles['chat-command-output-head']}>
                <Icon value="SquareTerminal" /> command output
            </SectionLabel>
            {props.children}
        </Card>
    )
}

export default ChatCommandOutputFrame
