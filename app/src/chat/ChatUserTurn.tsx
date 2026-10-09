// app/src/chat/ChatUserTurn.tsx — ChatUserTurn.module.css is the ONLY importer.
// One user turn: the "you" label (+ a queued note/cancel while staged), the prose bubble, and any
// sent images. Extracted verbatim in markup/behaviour from ChatView.tsx's transcript list render
// (the fallback branch of its role Show chain).
import { For, Show, type Component } from 'solid-js'
import Text from '../ui/Text'
import ChatTurnColumn from './ChatTurnColumn'
import ChatTurnLabel from './ChatTurnLabel'
import ChatTextBubble from './ChatTextBubble'
import type { UserItem } from './chatTranscriptLogic'
import styles from './ChatUserTurn.module.css'
import CloseButton from '../ui/CloseButton'

export type ChatUserTurnProps = {
    item: UserItem
    onCancelQueued: (queueId: string) => void
    /** Right-click a prose bubble → Reply/Copy — the transcript owns the actual menu. */
    onBubbleContextMenu: (e: MouseEvent, text: string) => void
    class?: string
}

const ChatUserTurn: Component<ChatUserTurnProps> = props => {
    return (
        <ChatTurnColumn class={`${styles['chat-msg']} ${props.class ?? ''}`}>
            <ChatTurnLabel
                label="you"
                trailing={
                    <Show when={props.item.queued}>
                        <Text as="span" eyebrow size="micro" tone="muted">
                            queued
                        </Text>
                        <CloseButton
                            label="Cancel queued message"
                            class={styles['chat-queued-cancel']}
                            onClick={() =>
                                props.onCancelQueued(props.item.queueId!)
                            }
                        />
                    </Show>
                }
            />
            <ChatTextBubble
                text={props.item.text}
                role="user"
                muted={!!props.item.queued}
                onContextMenu={e =>
                    props.onBubbleContextMenu(e, props.item.text)
                }
            />
            <Show when={props.item.images?.length}>
                <div class={styles['chat-user-images']}>
                    <For each={props.item.images}>
                        {src => (
                            <img
                                class={styles['chat-user-image']}
                                src={src}
                                alt="attachment"
                            />
                        )}
                    </For>
                </div>
            </Show>
        </ChatTurnColumn>
    )
}

export default ChatUserTurn
