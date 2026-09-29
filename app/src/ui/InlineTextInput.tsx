// app/src/ui/InlineTextInput.tsx
// The inline-rename input: swapped in where a label sits, auto-focused with its text selected,
// the confirm key (Enter by default) or blur commits, the dismiss key (Escape by default) cancels
// — exactly once either way, via widgetKeys.ts's isConfirmKey/isDismissKey. Extracted from EditableLabel
// (the file tree's rename, which composes it and keeps its own move/flush logic) so a second
// caller — the PDF bookmarks panel's row rename — reuses the behaviour and the look instead of
// importing that component's stylesheet.
import styles from './InlineTextInput.module.css'
import { isConfirmKey, isDismissKey } from './widgetKeys'
import { gestureStops } from './stopGestures'

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
            // A row that starts a drag on pointerdown is not stopped by onClick alone; the spread
            // stops click, mousedown, pointerdown and dblclick so a caret press is never a row gesture.
            {...gestureStops}
            onKeyDown={e => {
                // preventDefault marks the key consumed, so a host Modal does not also act on it.
                if (isConfirmKey(e)) {
                    e.preventDefault()
                    commit()
                } else if (isDismissKey(e)) {
                    e.preventDefault()
                    cancel()
                }
            }}
            onBlur={commit}
        />
    )
}

export default InlineTextInput
