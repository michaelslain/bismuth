// app/src/chat/ChatTurnColumn.tsx — ChatTurnColumn.module.css is the ONLY importer.
// The centred, max-width-680px reading column shared by every row ChatTranscript renders (a user
// turn, an assistant turn, a system note, the awaiting-reply row, a per-turn error). Extracted
// because that 680px/centred rule was copy-pasted verbatim into four sibling stylesheets
// (ChatUserTurn/ChatAssistantTurn/ChatSystemNote/ChatTranscript) — the "shared stylesheet means a
// missing component" case. Owns ONLY the width/centering; callers still bring their own
// flex-direction/gap/color via `class`.
import type { JSX } from 'solid-js'
import styles from './ChatTurnColumn.module.css'

export type ChatTurnColumnProps = {
    children: JSX.Element
    class?: string
    classList?: Record<string, boolean>
}

export default function ChatTurnColumn(props: ChatTurnColumnProps) {
    return (
        <div
            class={`${styles['chat-turn-column']} ${props.class ?? ''}`}
            classList={props.classList}
        >
            {props.children}
        </div>
    )
}
