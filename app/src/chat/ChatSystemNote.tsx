// app/src/chat/ChatSystemNote.tsx — ChatSystemNote.module.css is the ONLY importer.
// A quiet, non-error system notice (BUG #87): confirms a client-side slash command like `/chrome`
// actually did something, without pretending to be part of the conversation (no speaker label,
// never replayed from session history). Extracted verbatim from ChatView.tsx's transcript render.
import type { Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import ChatTurnColumn from './ChatTurnColumn'
import styles from './ChatSystemNote.module.css'

export type ChatSystemNoteProps = {
    text: string
    class?: string
}

const ChatSystemNote: Component<ChatSystemNoteProps> = props => {
    return (
        <ChatTurnColumn class={`${styles['chat-system-note']} ${props.class ?? ''}`}>
            <Icon value="Info" />
            <Text as="span" inherit>
                {props.text}
            </Text>
        </ChatTurnColumn>
    )
}

export default ChatSystemNote
