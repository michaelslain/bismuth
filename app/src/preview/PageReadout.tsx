// app/src/preview/PageReadout.tsx
// The PDF's reading position in the ViewBar's `readouts` slot: `p. N / M`. Clicking it edits the
// page number in place — Enter (or blur) goes there, Escape leaves the position alone — so the
// readout doubles as go-to-page without a separate control taking bar width.
//
// The rest state is a ui/Button (kind="text") rather than a Label, because it IS a control: it has
// to be focusable, announce itself, and take a click. `.readout` restores the readout look over the
// Button's own chrome (lowercase "p.", muted ink, tabular digits) — see PageReadout.module.css.
// The edit state composes ui/InlineTextInput, the app's one inline-edit input (Enter/blur commits
// exactly once, Escape cancels).
import { createSignal, Show } from 'solid-js'
import Button from '../ui/Button'
import InlineTextInput from '../ui/InlineTextInput'
import Label from '../ui/Label'
import styles from './PageReadout.module.css'

export type PageReadoutProps = {
    /** The page the reader is on, 0-based. */
    current: () => number
    /** Pages in the document. */
    count: () => number
    /** Go to a page, 0-based and already clamped into range. */
    onGo: (index: number) => void
    class?: string
}

/** A typed page number (1-based text) → a clamped 0-based index, or null when it is not a number. */
export function parsePageInput(text: string, count: number): number | null {
    const n = Number.parseInt(text.trim(), 10)
    if (!Number.isFinite(n) || count <= 0) return null
    return Math.min(count, Math.max(1, n)) - 1
}

function PageReadout(props: PageReadoutProps) {
    const [editing, setEditing] = createSignal(false)
    // The input unmounts on commit/cancel, dropping focus to `body` — PreviewView's capture-phase
    // keydown lives on the preview root, so Cmd+F/draw/undo would stop working until the user
    // clicked something. Refocusing this button (which the Show's fallback branch re-renders in
    // the same tick) keeps focus inside the preview instead.
    let buttonRef: HTMLButtonElement | undefined
    const refocus = () => queueMicrotask(() => buttonRef?.focus())
    const commit = (text: string) => {
        setEditing(false)
        const index = parsePageInput(text, props.count())
        if (index !== null) props.onGo(index)
        refocus()
    }
    const cancel = () => {
        setEditing(false)
        refocus()
    }

    return (
        <div
            class={`${styles['page-readout']} ${props.class ?? ''}`}
            data-testid="page-readout"
        >
            <Show
                when={editing()}
                fallback={
                    <Button
                        ref={el => (buttonRef = el)}
                        kind="text"
                        class={styles.readout}
                        title="Go to page"
                        aria-label={`Page ${props.current() + 1} of ${props.count()}, go to page`}
                        onClick={() => setEditing(true)}
                    >
                        {`p. ${props.current() + 1} / ${props.count()}`}
                    </Button>
                }
            >
                <Label tone="muted" class={styles.prefix}>
                    p.
                </Label>
                <InlineTextInput
                    value={String(props.current() + 1)}
                    label={`Go to page (1–${props.count()})`}
                    class={styles.input}
                    onCommit={commit}
                    onCancel={cancel}
                />
                <Label tone="muted" class={styles.suffix}>
                    {`/ ${props.count()}`}
                </Label>
            </Show>
        </div>
    )
}

export default PageReadout
