// app/src/chat/ChatThinkingBlock.tsx — ChatThinkingBlock.module.css is the ONLY importer.
// A dim, collapsible one-liner for a turn's extended-thinking text. Collapsed by default.
// Extracted verbatim (markup + behaviour) from ChatView.tsx's local `ThinkingBlock` closure.
import { createSignal, Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
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
            <button
                type="button"
                class={styles['chat-thinking-head']}
                onClick={() => setOpen(!open())}
            >
                <Icon value={open() ? 'ChevronDown' : 'ChevronRight'} size={13} />
                <Icon value="Brain" size={13} />
                <Text as="span" size="ui" tone="faint">
                    Thinking
                </Text>
            </button>
            <Show when={open()}>
                <pre class={styles['chat-thinking-body']}>{props.part.text}</pre>
            </Show>
        </div>
    )
}
