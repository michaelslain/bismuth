// app/src/chat/ChatThinkingBlock.tsx — ChatThinkingBlock.module.css is the ONLY importer.
// A dim, collapsible one-liner for a turn's extended-thinking text. Collapsed by default.
// Extracted verbatim (markup + behaviour) from ChatView.tsx's local `ThinkingBlock` closure.
import { createSignal, Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import CodeBlock from '../ui/CodeBlock'
import type { ThinkingPart } from '../chatTranscript'
import styles from './ChatThinkingBlock.module.css'

export type ChatThinkingBlockProps = {
    part: ThinkingPart
    class?: string
}

export default function ChatThinkingBlock(props: ChatThinkingBlockProps) {
    const [open, setOpen] = createSignal(false)
    return (
        <div class={`${styles['chat-thinking']} ${props.class ?? ''}`}>
            <PlainButton
                class={styles['chat-thinking-head']}
                onClick={() => setOpen(!open())}
            >
                <Icon value={open() ? 'ChevronDown' : 'ChevronRight'} />
                <Icon value="Brain" />
                <Text as="span" size="ui" tone="faint">
                    Thinking
                </Text>
            </PlainButton>
            <Show when={open()}>
                <CodeBlock class={styles['chat-thinking-body']}>
                    {props.part.text}
                </CodeBlock>
            </Show>
        </div>
    )
}
