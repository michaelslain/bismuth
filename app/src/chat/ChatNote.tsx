// app/src/chat/ChatNote.tsx — ChatNote.module.css is the ONLY importer.
// The one quiet row between turns: a system notice, a per-turn error, the "working" line while a
// reply is awaited. They were three hand-built rows — a system note and a turn error at 13px
// (`--fs-body`) beside a "working" row at 11.5px with tracking — that are the same thing: an icon
// (optional) and a line of text that is not part of the conversation. One size (`--fs-ui`), no
// tracking; `tone` is the only thing that differs. The centred reading column is the caller's
// (ChatTurnColumn), so the "working" row can sit under its speaker label inside one column.
import { Show, type Component, type JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import styles from './ChatNote.module.css'

export type ChatNoteProps = {
    /** A glyph before the text; omit for none (the "working" row has a caret instead). */
    icon?: string
    /** 'muted' (default) for a notice; 'danger' for a recoverable error — which also announces
     *  itself (`role="alert"`), as `ui/ErrorText` does. */
    tone?: 'muted' | 'danger'
    children: JSX.Element
    class?: string
}

const ChatNote: Component<ChatNoteProps> = props => {
    return (
        <div
            class={`${styles['chat-note']} ${props.class ?? ''}`}
            classList={{ [styles['danger']]: props.tone === 'danger' }}
        >
            <Show when={props.icon}>
                {icon => <Icon value={icon()} class={styles['chat-note-icon']} />}
            </Show>
            <Text
                as="span"
                inherit
                role={props.tone === 'danger' ? 'alert' : undefined}
            >
                {props.children}
            </Text>
        </div>
    )
}

export default ChatNote
