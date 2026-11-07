// app/src/ui/BlockCopyButton.tsx — BlockCopyButton.module.css is the ONLY importer of its module.
//
// The copy glyph a block of a note wears: a fenced code block (inside CodeHeader) and a quote
// (livePreview.ts's quote widget). Both are CodeMirror widgets in the note view, which a chat
// message renders through too (ui/NoteProse), so this is one control in notes and in chat.
// It never moves the editor selection or reveals raw markup: the mousedown is cancelled and the
// click stops at the button.
import type { Component } from 'solid-js'
import { IconButton } from './IconButton'
import { copyText } from './copyText'
import styles from './BlockCopyButton.module.css'

export type BlockCopyButtonProps = {
    /** What the button writes to the clipboard. */
    text: string
    /** Accessible name and hover name ("Copy code", "Copy quote"). */
    label: string
    class?: string
}

const BlockCopyButton: Component<BlockCopyButtonProps> = props => {
    const copy = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        copyText(props.text)
    }

    return (
        <IconButton
            class={`${styles.copy} ${props.class ?? ''}`}
            type="button"
            label={props.label}
            icon="Copy"
            size="sm"
            onMouseDown={e => e.preventDefault()}
            onClick={copy}
        />
    )
}

export default BlockCopyButton
