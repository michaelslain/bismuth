// app/src/chat/ChatUserTurn.tsx — ChatUserTurn.module.css is the ONLY importer.
// One user turn: the "you" label (+ a queued note/cancel while staged), the prose bubble, and any
// sent images. Extracted verbatim in markup/behaviour from ChatView.tsx's transcript list render
// (the fallback branch of its role Show chain).
import { For, Show } from 'solid-js'
import { IconButton } from '../ui/IconButton'
import Text from '../ui/Text'
import ChatTurnColumn from './ChatTurnColumn'
import ChatTurnLabel from './ChatTurnLabel'
import ChatTextBubble from './ChatTextBubble'
import type { UserItem } from '../chatTranscript'
import styles from './ChatUserTurn.module.css'

export type ChatUserTurnProps = {
    item: UserItem
    onCancelQueued: (queueId: string) => void
    /** Right-click a prose bubble → Reply/Copy — the transcript owns the actual menu. */
    onBubbleContextMenu: (e: MouseEvent, text: string) => void
    class?: string
}

export default function ChatUserTurn(props: ChatUserTurnProps) {
    return (
        <ChatTurnColumn
            class={`${styles['chat-msg']} ${props.class ?? ''}`}
            classList={{ [styles['queued']]: !!props.item.queued }}
        >
            <ChatTurnLabel
                label="you"
                trailing={
                    <Show when={props.item.queued}>
                        <Text
                            as="span"
                            tone="faint"
                            class={styles['chat-queued-note']}
                        >
                            queued
                        </Text>
                        <IconButton
                            icon="X"
                            label="Cancel queued message"
                            size="sm"
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
