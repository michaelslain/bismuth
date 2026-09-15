// app/src/chat/ChatTurnLabel.tsx — ChatTurnLabel.module.css is the ONLY importer of its module.
// The quiet speaker label that marks a turn: "you" for a user turn, the persona name for an
// assistant turn — same lowercase, letter-spaced "eyebrow" head style the daemon panels use
// (DaemonPanel's title: `<Text eyebrow size="micro" tone="faint">`), not the old uppercase-bold
// ".chat-turn-label". Restyle for baseline issue #6 / Acceptance "Turn labels are lowercase … in
// the same head style as the daemon panels." An optional trailing slot carries a queued-turn note
// + cancel button (ChatUserTurn) — kept generic here rather than hardcoded, so the label stays a
// pure "text + optional trailing content" row.
import type { JSX } from 'solid-js'
import Text from '../ui/Text'
import styles from './ChatTurnLabel.module.css'

export type ChatTurnLabelProps = {
    /** "you", or the assistant persona's name — rendered as-is (no forced case transform, same as
     *  DaemonPanel's titles, which are already lowercase at the call site). */
    label: string
    /** Extra content after the label — the queued note + cancel button, or nothing. */
    trailing?: JSX.Element
    class?: string
}

export default function ChatTurnLabel(props: ChatTurnLabelProps) {
    return (
        <div class={`${styles['chat-turn-label']} ${props.class ?? ''}`}>
            <Text as="span" eyebrow size="micro" tone="faint">
                {props.label}
            </Text>
            {props.trailing}
        </div>
    )
}
