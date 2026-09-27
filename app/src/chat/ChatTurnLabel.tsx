// app/src/chat/ChatTurnLabel.tsx — ChatTurnLabel.module.css is the ONLY importer of its module.
// The quiet speaker label that marks a turn: "you" for a user turn, the persona name for an
// assistant turn — same lowercase, letter-spaced "eyebrow" head style the daemon panels use
// (DaemonPanel's title: `<Text eyebrow size="micro" tone="faint">`), not the old uppercase-bold
// ".chat-turn-label". Restyle for baseline issue #6 / Acceptance "Turn labels are lowercase … in
// the same head style as the daemon panels." An optional trailing slot carries a queued-turn note
// + cancel button (ChatUserTurn) — kept generic here rather than hardcoded, so the label stays a
// pure "text + optional trailing content" row.
import { children, type JSX } from 'solid-js'
import Text from '../ui/Text'
import styles from './ChatTurnLabel.module.css'

export type ChatTurnLabelProps = {
    /** "you", or the assistant persona's name. Lowercased here (Text's `eyebrow` register
     *  deliberately never applies a CSS case transform — see ui/Text.module.css — so a capitalized
     *  persona name such as the default "Claude" would otherwise reach the DOM as-is). */
    label: string
    /** Leading content before the name — the bot's face on the transcript's lowest assistant row
     *  (ChatTranscript), or nothing. The row then reads face-then-name. */
    avatar?: JSX.Element
    /** Extra content after the label — the queued note + cancel button, or nothing. */
    trailing?: JSX.Element
    class?: string
}

export default function ChatTurnLabel(props: ChatTurnLabelProps) {
    // Resolved ONCE: the avatar is read twice (the class toggle + the slot), and reading a JSX
    // getter twice would mount the face twice.
    const avatar = children(() => props.avatar)
    return (
        <div
            class={`${styles['chat-turn-label']} ${props.class ?? ''}`}
            classList={{ [styles['with-avatar']]: !!avatar() }}
        >
            {avatar()}
            <Text as="span" eyebrow size="micro" tone="faint">
                {props.label.toLowerCase()}
            </Text>
            {props.trailing}
        </div>
    )
}
