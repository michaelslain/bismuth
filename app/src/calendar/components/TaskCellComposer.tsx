// The in-cell "add a task" composer — presentational only, no fetch, no store access. It owns
// nothing but its own draft text; every write (commit/cancel) is handed back to the caller via
// props, which is what TaskComposeProps.commit/cancel are for at the view level (see
// taskCompose.ts). It must look like the task it will become, because it renders directly under
// real TaskChip rows — padding/gap/font values are copied from TaskChip.module.css on purpose,
// not reinvented.
import type { Component } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { TextInput } from '../../ui/TextInput'
import styles from './TaskCellComposer.module.css'

export type TaskCellComposerProps = {
    /** Shown under the input as `→ {destination}`, or an explicit hint when no destination is
     *  configured — see the destination line below. */
    destination: string
    /** Resolved CSS colour of the destination's default category. Undefined → no band, the
     *  same contract as TaskChip's own `color` prop. */
    color?: string
    onCommit: (text: string) => void
    onCancel: () => void
    class?: string
}

// NOTE: props are read whole, never destructured — see TaskChip.tsx's own note on this. Reading
// `props.onCommit`/`props.onCancel` at the point of use (rather than destructuring them in the
// signature) means a later prop change is always seen, not frozen at mount.
const TaskCellComposer: Component<TaskCellComposerProps> = props => {
    const [text, setText] = createSignal('')
    // Guards against WebKit's inconsistent behaviour of dispatching `blur` on an element removed
    // from the DOM while focused: the caller unmounts this composer in response to onCancel, and
    // if blur then fires anyway, onBlur below must NOT also commit the very text Escape (or an
    // empty Enter) just discarded.
    let done = false

    return (
        <div
            class={[styles.composer, props.class ?? ''].filter(Boolean).join(' ')}
            // Stop all four so the day cell this sits inside (which wires its own click to open
            // the "create event" modal, and mousedown to start a drag — see TaskChip.tsx's own
            // comment on the same trap) cannot re-open itself or start a drag out from under the
            // composer. `stopPropagation` on click does NOT also stop pointerdown/dblclick, so
            // each is stopped in its own handler rather than assumed to ride along.
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onDblClick={e => e.stopPropagation()}
        >
            <Show when={props.color}>
                <span class={styles.band} style={{ background: props.color }} />
            </Show>
            <div class={styles.row}>
                <span class={styles.marker} data-testid="task-cell-composer-marker">
                    [ ]
                </span>
                <TextInput
                    plain
                    class={styles.input}
                    value={text()}
                    onInput={setText}
                    data-testid="task-cell-composer-input"
                    // The pattern CategoryPanel.tsx's rename field already uses: focus has to be
                    // deferred a tick past mount, or the element isn't attached yet to focus.
                    ref={el =>
                        queueMicrotask(() => {
                            el.focus()
                        })
                    }
                    onKeyDown={e => {
                        if (e.key === 'Escape') {
                            e.preventDefault()
                            done = true
                            props.onCancel()
                            return
                        }
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        const trimmed = text().trim()
                        if (!trimmed) {
                            done = true
                            props.onCancel()
                            return
                        }
                        props.onCommit(trimmed)
                        // The caller keeps the composer mounted after a commit — clearing here
                        // (rather than waiting for the caller to remount it) is what makes a
                        // second task one keystroke away.
                        setText('')
                    }}
                    onBlur={() => {
                        if (done) return
                        const trimmed = text().trim()
                        if (trimmed) props.onCommit(trimmed)
                        else props.onCancel()
                    }}
                />
            </div>
            <div class={styles.destination} data-testid="task-cell-composer-destination">
                <Show
                    when={props.destination}
                    fallback={
                        <span class={styles.unset}>
                            → no destination note // set one in settings
                        </span>
                    }
                >
                    → {props.destination}
                </Show>
            </div>
        </div>
    )
}

export default TaskCellComposer
