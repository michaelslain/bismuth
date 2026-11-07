// app/src/chat/ChatTextBubble.tsx — ChatTextBubble.module.css is the ONLY importer of its module.
// One turn's prose, rendered through ui/NoteProse — the note editor's own read-only markdown view —
// so a message reads exactly like a note: the same spacing, code blocks, tables, math, links and
// the same fold triangles on headings and on bullets at every depth. Shared by ChatUserTurn's
// bubble and ChatAssistantTurn's text parts.
import { Show, type Component } from 'solid-js'
import NoteProse from '../ui/NoteProse'
import ChatCopyButton from './ChatCopyButton'
import { chatTurnPreview } from './chatTurnPreview'
import { useChatVaultNames } from './chatVaultNames'
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
    const names = useChatVaultNames()
    // Where a right-click fold lock on this message is kept: the chat, the speaker and the
    // message's first line, which a reloaded transcript reproduces.
    const foldKey = `chat:${props.chatId ?? 'local'}:${props.role}:${chatTurnPreview(props.text)}`
    const buttons = () =>
        props.chatId
            ? {
                  host: { kind: 'chat', chatId: props.chatId } as const,
                  onSend: props.role === 'assistant' ? props.onSend : undefined,
              }
            : undefined
    return (
        <Show when={props.text.trim()}>
            <div
                class={`${styles['chat-bubble-wrap']} ${props.class ?? ''}`}
                classList={{ [styles['muted']]: props.muted }}
                data-chat-bubble-wrap
                onContextMenu={e => props.onContextMenu?.(e)}
            >
                <div class={styles[props.role]} data-chat-bubble>
                    <NoteProse
                        text={props.text}
                        foldKey={foldKey}
                        noteNames={names.noteNames}
                        memoryNames={names.memoryNames}
                        buttons={buttons()}
                        lazy
                    />
                </div>
                <ChatCopyButton text={props.text} />
            </div>
        </Show>
    )
}

export default ChatTextBubble
