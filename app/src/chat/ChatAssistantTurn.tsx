// app/src/chat/ChatAssistantTurn.tsx — ChatAssistantTurn.module.css is the ONLY importer.
// One whole assistant turn: the persona's "you"-equivalent label, its parts (prose / thinking /
// tool call / permission / question) in arrival order, and a muted footer once the turn's `result`
// frame lands. Extracted verbatim in markup/behaviour from ChatView.tsx's local `AssistantTurn`
// closure + part-kind switch.
import { createSignal, For, Show, type Component, type JSX } from 'solid-js'
import { plural } from '../plural'
import ChatTurnColumn from './ChatTurnColumn'
import ChatTurnLabel from './ChatTurnLabel'
import ChatTextBubble from './ChatTextBubble'
import ChatThinkingBlock from './ChatThinkingBlock'
import ChatToolRow from './ChatToolRow'
import ChatQuestionCard from './ChatQuestionCard'
import ChatPermissionCard from './ChatPermissionCard'
import type { AssistantItem } from './chatTranscriptLogic'
import Collapsible from '../ui/Collapsible'
import { chatTurnPreview } from './chatTurnPreview'
import styles from './ChatAssistantTurn.module.css'

export type ChatAssistantTurnProps = {
    item: AssistantItem
    persona: string
    /** The bot's face, when this is the transcript's lowest assistant turn — see chatAvatar.ts. */
    avatar?: JSX.Element
    onAnswerPermission: (
        id: string,
        behavior: 'allow' | 'deny',
        always: boolean,
    ) => void
    onAnswerQuestion: (
        id: string,
        answers: Record<string, string> | null,
    ) => void
    /** Right-click a prose bubble → Reply/Copy — the transcript owns the actual menu. */
    onBubbleContextMenu: (e: MouseEvent, text: string) => void
    /** The conversation, and where a button's `send` goes — see ChatTextBubble. */
    chatId?: string
    onSend?: (text: string) => void
    class?: string
}

const ChatAssistantTurn: Component<ChatAssistantTurnProps> = props => {
    const [open, setOpen] = createSignal(true)
    // The folded row's line: the turn's first prose, else nothing (a turn of only tool calls).
    const preview = () => {
        for (const part of props.item.parts)
            if (part.kind === 'text') {
                const line = chatTurnPreview(part.text)
                if (line) return line
            }
        return ''
    }
    return (
        <ChatTurnColumn class={`${styles['chat-msg']} ${props.class ?? ''}`}>
            <ChatTurnLabel
                label={props.persona}
                avatar={props.avatar}
                fold={{
                    open: open(),
                    onToggle: () => setOpen(!open()),
                    preview: preview(),
                }}
            />
            <Collapsible open={open()} gutter>
                <div class={styles['chat-turn']}>
                    <For each={props.item.parts}>
                        {part => {
                            if (part.kind === 'text')
                                return (
                                    <ChatTextBubble
                                        text={part.text}
                                        role="assistant"
                                        chatId={props.chatId}
                                        onSend={props.onSend}
                                        onContextMenu={e =>
                                            props.onBubbleContextMenu(
                                                e,
                                                part.text,
                                            )
                                        }
                                    />
                                )
                            if (part.kind === 'thinking')
                                return <ChatThinkingBlock part={part} />
                            if (part.kind === 'tool')
                                return <ChatToolRow part={part} />
                            if (part.kind === 'question')
                                return (
                                    <ChatQuestionCard
                                        part={part}
                                        onAnswer={answers =>
                                            props.onAnswerQuestion(
                                                part.id,
                                                answers,
                                            )
                                        }
                                    />
                                )
                            return (
                                <ChatPermissionCard
                                    part={part}
                                    onAnswer={(behavior, always) =>
                                        props.onAnswerPermission(
                                            part.id,
                                            behavior,
                                            always,
                                        )
                                    }
                                />
                            )
                        }}
                    </For>
                    <Show when={props.item.footer}>
                        {f => (
                            <div class={styles['chat-turn-footer']}>
                                {plural(f().numTurns, 'turn')}
                                <Show when={f().costUsd != null}>
                                    {' '}
                                    // ${f().costUsd!.toFixed(4)}
                                </Show>
                            </div>
                        )}
                    </Show>
                </div>
            </Collapsible>
        </ChatTurnColumn>
    )
}

export default ChatAssistantTurn
