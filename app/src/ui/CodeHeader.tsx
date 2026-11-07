// app/src/ui/CodeHeader.tsx — CodeHeader.module.css is the ONLY importer of its module.
//
// The one header a fenced code block wears, wherever it is read: the dim ```lang fence text on the
// left and an icon-only copy button on the right. Mounted by the note editor's live preview (as a
// CodeMirror widget in place of the opening fence, livePreview.ts), which a chat message renders
// through too (ui/NoteProse), so the copy control is one control everywhere. The font size is
// inherited from the host, the fence row.
import type { Component } from 'solid-js'
import { IconButton } from './IconButton'
import Text from './Text'
import { copyText } from './copyText'
import styles from './CodeHeader.module.css'

export type CodeHeaderProps = {
    /** The fence's info string (`ts`, `sh`); empty for a bare ``` fence. */
    lang: string
    /** The code lines joined with "\n" — what the copy button writes. */
    body: string
    class?: string
}

const CodeHeader: Component<CodeHeaderProps> = props => {
    const copy = (e: MouseEvent) => {
        // Don't let the click move the editor selection or reveal the raw fence.
        e.preventDefault()
        e.stopPropagation()
        copyText(props.body)
    }

    return (
        <div class={`${styles.header} ${props.class ?? ''}`}>
            <Text as="span" inherit class={styles.lang} data-testid="code-lang">
                {'```' + props.lang}
            </Text>
            <IconButton
                class={styles.copy}
                type="button"
                label="Copy code"
                icon="Copy"
                size="sm"
                onMouseDown={e => e.preventDefault()}
                onClick={copy}
            />
        </div>
    )
}

export default CodeHeader
