// app/src/bases/MarkdownArea.tsx
// The multiline plain-text editor for a declared `markdown` property where the rich Milkdown
// surface is not wanted (a kanban chip, a table cell): a textarea that grows to fit its content.
// Enter inserts a newline — only Escape or blur leave it. The caller owns the draft and the
// commit (PropertyValueEditor).
import type { Component } from 'solid-js'
import TextInput from '../ui/TextInput'
import { isDismissKey } from '../ui/widgetKeys'
import styles from './MarkdownArea.module.css'

export type MarkdownAreaProps = {
    value: string
    autofocus?: boolean
    onInput: (value: string) => void
    /** Blur: commit the draft. */
    onBlur: () => void
    /** Escape: revert the draft; the component then blurs, and the keydown bubbles so a modal's
     *  own Escape listener sees it too. */
    onRevert: () => void
    class?: string
}

/** Grow a textarea to fit its content (no scrollbar). */
function autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
}

const MarkdownArea: Component<MarkdownAreaProps> = props => {
    // TextInput's onInput only hands back the string, so the ref is how autoGrow reaches the element.
    let el: HTMLTextAreaElement | undefined
    return (
        <TextInput
            multiline
            class={`${styles.area} ${props.class ?? ''}`}
            value={props.value}
            autofocus={props.autofocus}
            ref={node => {
                el = node
                queueMicrotask(() => {
                    if (props.autofocus) node.focus()
                    autoGrow(node)
                })
            }}
            onInput={v => {
                props.onInput(v)
                if (el) autoGrow(el)
            }}
            onBlur={props.onBlur}
            onKeyDown={e => {
                if (isDismissKey(e)) {
                    props.onRevert()
                    e.currentTarget.blur()
                }
            }}
        />
    )
}

export default MarkdownArea
