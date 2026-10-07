// app/src/chat/ChatThinkingBlock.tsx — ChatThinkingBlock.module.css is the ONLY importer.
// A quiet, collapsible one-liner for a turn's extended-thinking text. Collapsed by default. The
// collapse is `ui/Disclosure` (leading chevron, `aria-expanded`, body hung under the label), so it
// opens exactly like a tool row. The text is the model's own reasoning — prose — so it is set in
// the readable register, not mono micro.
import { createSignal, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import Disclosure from '../ui/Disclosure'
import type { ThinkingPart } from './chatTranscriptLogic'
import styles from './ChatThinkingBlock.module.css'

export type ChatThinkingBlockProps = {
    part: ThinkingPart
    class?: string
}

const ChatThinkingBlock: Component<ChatThinkingBlockProps> = props => {
    const [open, setOpen] = createSignal(false)
    return (
        <Disclosure
            class={props.class}
            open={open()}
            onToggle={() => setOpen(!open())}
            summary={
                <>
                    <Icon value="Brain" />
                    <Text as="span" inherit>
                        Thinking
                    </Text>
                </>
            }
        >
            <Text
                as="div"
                register="prose"
                tone="muted"
                class={styles['chat-thinking-body']}
            >
                {props.part.text}
            </Text>
        </Disclosure>
    )
}

export default ChatThinkingBlock
