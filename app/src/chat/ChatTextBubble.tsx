// app/src/chat/ChatTextBubble.tsx — ChatTextBubble.module.css is the ONLY importer of its module.
// One turn's prose, rendered through the SAME note markdown pipeline (renderNoteBody) every note
// uses, so a message reads exactly like a note — shared by ChatUserTurn's bubble and
// ChatAssistantTurn's text parts. `command` renders a boxed monospace "Command output" panel
// (like the Claude Code TUI's `/context` view) instead of loose prose (#28); the body still goes
// through the same pipeline, so headings/bold/code fences/tables still render formatted.
import { Show, type Component } from 'solid-js'
import { renderNoteBody } from '../bases/markdown'
import ChatCommandOutputFrame from './ChatCommandOutputFrame'
import ChatCopyButton from './ChatCopyButton'
import styles from './ChatTextBubble.module.css'

export type ChatTextBubbleProps = {
    /** Raw markdown source. Renders nothing when blank (an image-only turn, say). */
    text: string
    role: 'user' | 'assistant'
    /** Slash-command result: boxed monospace panel instead of loose prose (#28). */
    command?: boolean
    /** Right-click → Reply/Copy menu, wired by the transcript (which owns the ContextMenu). */
    onContextMenu?: (e: MouseEvent) => void
    class?: string
}

const ChatTextBubble: Component<ChatTextBubbleProps> = props => {
    const bubble = (
        <div
            class={`${styles['chat-bubble']} ${styles[props.role]}`}
            classList={{
                [styles['chat-command-output-body']]: props.command,
            }}
            data-chat-bubble
            innerHTML={renderNoteBody(props.text)}
        />
    )
    return (
        <Show when={props.text.trim()}>
            <div
                class={`${styles['chat-bubble-wrap']} ${props.class ?? ''}`}
                data-chat-bubble-wrap
                onContextMenu={e => props.onContextMenu?.(e)}
            >
                <Show when={props.command} fallback={bubble}>
                    <ChatCommandOutputFrame>{bubble}</ChatCommandOutputFrame>
                </Show>
                <ChatCopyButton text={props.text} />
            </div>
        </Show>
    )
}

export default ChatTextBubble
