// app/src/ui/InlineTextInput.tsx
// The inline-rename input: swapped in where a label sits, auto-focused with its text selected,
// the confirm key (Enter by default) or blur commits, the dismiss key (Escape by default) cancels
// — exactly once either way, via widgetKeys.ts's isConfirmKey/isDismissKey. Extracted from EditableLabel
// (the file tree's rename, which composes it and keeps its own move/flush logic) so a second
// caller — the PDF bookmarks panel's row rename — reuses the behaviour and the look instead of
// importing that component's stylesheet.
import styles from './InlineTextInput.module.css'
import { isConfirmKey, isDismissKey } from './widgetKeys'

export type InlineTextInputProps = {
    /** The starting text. Read once — the input owns the value while it is being edited. */
    value: string
    /** Confirm key or blur: the trimmed text. Called at most once, and never after `onCancel`. */
    onCommit: (value: string) => void
    /** Dismiss key. Called at most once, and never after `onCommit`. */
    onCancel: () => void
    /** Accessible name, when no visible label names the input. */
    label?: string
    class?: string
}

function InlineTextInput(props: InlineTextInputProps) {
    let inputRef: HTMLInputElement | undefined
    const initial = props.value
    // Committing usually unmounts the input, which fires blur → a second commit. `settled` makes
    // the commit (or cancel) run exactly once.
    let settled = false
    const commit = () => {
        if (settled) return
        settled = true
        props.onCommit(inputRef?.value.trim() ?? '')
    }
    const cancel = () => {
        if (settled) return
        settled = true
        props.onCancel()
    }

    return (
        <input
            ref={el => {
                inputRef = el
                queueMicrotask(() => {
                    el.focus()
                    el.select()
                })
            }}
            value={initial}
            aria-label={props.label}
            class={[styles['inline-input'], props.class]
                .filter(Boolean)
                .join(' ')}
            onClick={e => e.stopPropagation()}
            // A row that starts a drag on POINTERDOWN is not stopped by stopPropagation on onClick
            // alone. Stop it here so a press placing the caret is never read as a row gesture.
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => {
                if (isConfirmKey(e)) commit()
                else if (isDismissKey(e)) cancel()
            }}
            onBlur={commit}
        />
    )
}

export default InlineTextInput
