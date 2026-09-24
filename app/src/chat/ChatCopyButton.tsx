// app/src/chat/ChatCopyButton.tsx — ChatCopyButton.module.css is the ONLY importer of its module.
// Hover-revealed copy control on every prose bubble (ChatTextBubble) — copies the RAW markdown
// source (what you'd paste into a note), never the rendered HTML. Extracted verbatim from
// ChatView.tsx's local `CopyButton` closure.
import { IconButton } from '../ui/IconButton'
import { copyChatText } from './copyChatText'
import styles from './ChatCopyButton.module.css'

export type ChatCopyButtonProps = {
    /** Raw markdown source to copy. */
    text: string
    class?: string
}

export default function ChatCopyButton(props: ChatCopyButtonProps) {
    return (
        <IconButton
            icon="Copy"
            label="Copy message"
            class={`${styles['chat-copy-btn']} ${props.class ?? ''}`}
            onClick={() => copyChatText(props.text)}
        />
    )
}
