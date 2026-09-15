// app/src/chat/ChatCopyButton.tsx — ChatCopyButton.module.css is the ONLY importer of its module.
// Hover-revealed copy control on every prose bubble (ChatTextBubble) — copies the RAW markdown
// source (what you'd paste into a note), never the rendered HTML. Extracted verbatim from
// ChatView.tsx's local `CopyButton` closure.
import { IconButton } from '../ui/IconButton'
import { pushToast } from '../Toast'
import styles from './ChatCopyButton.module.css'

export type ChatCopyButtonProps = {
    /** Raw markdown source to copy. */
    text: string
    class?: string
}

export default function ChatCopyButton(props: ChatCopyButtonProps) {
    const copy = () => {
        navigator.clipboard
            .writeText(props.text)
            .then(() => pushToast('Copied'))
            .catch(() => pushToast("Couldn't copy"))
    }
    return (
        <IconButton
            icon="Copy"
            label="Copy message"
            iconSize={13}
            class={`${styles['chat-copy-btn']} ${props.class ?? ''}`}
            onClick={copy}
        />
    )
}
