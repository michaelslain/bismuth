// app/src/chat/ChatTextBubble.tsx — ChatTextBubble.module.css is the ONLY importer of its module.
// One turn's prose, rendered through the SAME note markdown pipeline (renderNoteBody) every note
// uses, so a message reads exactly like a note — shared by ChatUserTurn's bubble and
// ChatAssistantTurn's text parts.
import { Show, type Component } from 'solid-js'
import { renderNoteBody } from '../bases/markdown'
import ChatCopyButton from './ChatCopyButton'
import { createTypedTables } from '../ui/table/typeTables'
import { createCodeFences } from '../ui/codeFences'
import { createButtonBlocks } from '../buttons/createButtonBlocks'
import styles from './ChatTextBubble.module.css'

export type ChatTextBubbleProps = {
    /** Raw markdown source. Renders nothing when blank (an image-only turn, say). */
    text: string
    role: 'user' | 'assistant'
    /** Settled-aside ink (--text-muted) for a turn that is staged, not yet sent — instead of a
     *  fade, which no state may use. */
    muted?: boolean
    /** Right-click → Reply/Copy menu, wired by the transcript (which owns the ContextMenu). */
    onContextMenu?: (e: MouseEvent) => void
    /** The conversation this bubble sits in. With `onSend`, an ASSISTANT bubble's ```button fences
     *  are live; without either (or in a user bubble) they stay the inert `[label]` row. */
    chatId?: string
    /** A button's `send` text becomes the user's next message in `chatId` (ChatSession.sendText). */
    onSend?: (text: string) => void
    class?: string
}

const ChatTextBubble: Component<ChatTextBubbleProps> = props => {
    let el!: HTMLDivElement
    const bubble = (
        <div
            ref={el}
            class={`${styles['chat-bubble']} ${styles[props.role]}`}
            classList={{
                [styles['muted']]: props.muted,
            }}
            data-chat-bubble
            innerHTML={renderNoteBody(props.text)}
        />
    )
    // Tables are a typed grid (DESIGN.md's Typed Grid Rule), not drawn borders: once the markdown
    // string has landed, mount the edges onto its cells. Declared AFTER `bubble` so it re-runs after
    // the `innerHTML` binding when `text` changes, and tears its roots down before the next pass.
    createTypedTables(
        () => el,
        () => props.text,
    )
    // Fences likewise: each `<pre>` becomes a CodeFence, the ```lang label + copy button a note's
    // code block wears.
    createCodeFences(
        () => el,
        () => props.text,
    )
    // ```button fences: renderNoteBody leaves an inert placeholder; adopt it into a live row for an
    // assistant message only. Same ordering as the tables above.
    createButtonBlocks(
        () => el,
        () => props.text,
        () =>
            props.role === 'assistant' && props.chatId
                ? { kind: 'chat', chatId: props.chatId }
                : undefined,
        () => props.onSend,
    )
    return (
        <Show when={props.text.trim()}>
            <div
                class={`${styles['chat-bubble-wrap']} ${props.class ?? ''}`}
                data-chat-bubble-wrap
                onContextMenu={e => props.onContextMenu?.(e)}
            >
                {bubble}
                <ChatCopyButton text={props.text} />
            </div>
        </Show>
    )
}

export default ChatTextBubble
