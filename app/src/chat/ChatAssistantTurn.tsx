// app/src/chat/ChatAssistantTurn.tsx — ChatAssistantTurn.module.css is the ONLY importer.
// One whole assistant turn: the persona's "you"-equivalent label, its parts (prose / thinking /
// tool call / permission / question) in arrival order, and a muted footer once the turn's `result`
// frame lands. Extracted verbatim in markup/behaviour from ChatView.tsx's local `AssistantTurn`
// closure + part-kind switch.
import { For, Show } from 'solid-js'
import { plural } from '../plural'
import ChatTurnLabel from './ChatTurnLabel'
import ChatTextBubble from './ChatTextBubble'
import ChatThinkingBlock from './ChatThinkingBlock'
import ChatToolRow from './ChatToolRow'
import ChatQuestionCard from './ChatQuestionCard'
import ChatPermissionCard from './ChatPermissionCard'
import type { AssistantItem } from '../chatTranscript'
import styles from './ChatAssistantTurn.module.css'

export type ChatAssistantTurnProps = {
    item: AssistantItem
    persona: string
    onAnswerPermission: (
        id: string,
        behavior: 'allow' | 'deny',
        always: boolean,
    ) => void
    onAnswerQuestion: (id: string, answers: Record<string, string> | null) => void
    /** Right-click a prose bubble → Reply/Copy — the transcript owns the actual menu. */
    onBubbleContextMenu: (e: MouseEvent, text: string) => void
    class?: string
}

export default function ChatAssistantTurn(props: ChatAssistantTurnProps) {
    return (
        <div class={`${styles['chat-msg']} ${props.class ?? ''}`}>
            <ChatTurnLabel label={props.persona} />
            <div class={styles['chat-turn']}>
                <For each={props.item.parts}>
                    {part => {
                        if (part.kind === 'text')
                            return (
                                <ChatTextBubble
                                    text={part.text}
                                    role="assistant"
                                    command={props.item.command}
                                    onContextMenu={e =>
                                        props.onBubbleContextMenu(e, part.text)
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
                                        props.onAnswerQuestion(part.id, answers)
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
        </div>
    )
}
