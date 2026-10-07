// app/src/chat/ChatSystemNote.tsx — a quiet, non-error system notice (BUG #87): confirms a
// client-side slash command like `/chrome` actually did something, without pretending to be part
// of the conversation (no speaker label, never replayed from session history). The row itself is
// ChatNote (shared with the per-turn error and the "working" line); this only seats it in the
// reading column.
import type { Component } from 'solid-js'
import ChatNote from './ChatNote'
import ChatTurnColumn from './ChatTurnColumn'

export type ChatSystemNoteProps = {
    text: string
    class?: string
}

const ChatSystemNote: Component<ChatSystemNoteProps> = props => {
    return (
        <ChatTurnColumn class={props.class ?? ''}>
            <ChatNote icon="Info">{props.text}</ChatNote>
        </ChatTurnColumn>
    )
}

export default ChatSystemNote
