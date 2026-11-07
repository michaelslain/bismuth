import { createSignal, type Component } from 'solid-js'
import MarkdownField from '../ui/MarkdownField'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import { isDismissKey } from '../ui/widgetKeys'
import styles from './TranscriptEditor.module.css'

export type TranscriptEditorProps = {
    /** What is being edited, as the head says it: `page 4`. */
    title: string
    /** The page's transcript as stored: markdown, `$math$`, `==marks==`. */
    text: string
    busy?: boolean
    onSave: (text: string) => void
    onCancel: () => void
    className?: string
}

/** One notebook page's transcript as editable markdown, over the book: fix what the reader got
 *  wrong and save it back to the page's companion note. The dismiss key (Escape) cancels. */
const TranscriptEditor: Component<TranscriptEditorProps> = props => {
    const [value, setValue] = createSignal(props.text)
    const dirty = () => value() !== props.text
    const onKeyDown = (e: KeyboardEvent) => {
        if (!isDismissKey(e)) return
        e.preventDefault()
        e.stopPropagation()
        props.onCancel()
    }
    return (
        <div class={`${styles.editor} ${props.className ?? ''}`} data-transcript-editor onKeyDown={onKeyDown}>
            <div class={styles.head}>
                <Text tone="muted">{`edit text // ${props.title}`}</Text>
                <div class={styles.actions}>
                    <TextButton disabled={props.busy} onClick={() => props.onCancel()}>
                        cancel
                    </TextButton>
                    <TextButton primary disabled={props.busy || !dirty()} onClick={() => props.onSave(value())}>
                        {props.busy ? 'saving' : 'save'}
                    </TextButton>
                </div>
            </div>
            <div class={styles.body}>
                <MarkdownField value={value()} onInput={setValue} autofocus bare />
            </div>
        </div>
    )
}

export default TranscriptEditor
