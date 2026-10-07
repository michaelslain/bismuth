// The in-cell "add a task" composer — presentational only, no fetch, no store access. It owns
// nothing but its own draft text; every write (commit/cancel) is handed back to the caller via
// props, which is what TaskComposeProps.commit/cancel are for at the view level (see
// taskCompose.ts). It must look like the task it will become, because it renders directly under
// real TaskChip rows — padding/gap/font values are copied from TaskChip.module.css on purpose,
// not reinvented.
import type { Component } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { TextInput } from '../../ui/TextInput'
import Select from '../../ui/Select'
import Text from '../../ui/Text'
import TaskCheck from '../../bases/TaskCheck'
import { isDismissKey, isConfirmKey } from '../../ui/widgetKeys'
import { gestureStops } from '../../ui/stopGestures'
import type { TaskComposeTarget } from '../taskCompose'
import styles from './TaskCellComposer.module.css'

export type TaskCellComposerProps = {
    /** Shown under the input as `→ {destination}`, or an explicit hint when no destination is
     *  configured — see the destination line below. Ignored (in favour of the picked target's
     *  own label) once `targets` carries more than one option. */
    destination: string
    /** Resolved CSS colour of the destination's default category, painted on the `[ ]` marker.
     *  Undefined → TaskCheck's default read-only ink — the same contract as TaskChip's own
     *  `color` prop. Ignored once `targets` is non-empty — the picked target's own colour wins. */
    color?: string
    /** Every destination a commit could land in — one per source note (sourced base) or one
     *  per category (own-rows base). Fewer than 2 entries renders the plain `→ destination`
     *  text as before (nothing to pick between); 2+ renders a picker in its place. */
    targets?: TaskComposeTarget[]
    /** The currently-picked target's `id` — required together with `onTargetChange` whenever
     *  `targets` has 2+ entries. */
    target?: string
    onTargetChange?: (id: string) => void
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
    let root: HTMLDivElement | undefined
    let input: HTMLInputElement | undefined
    // Set on mousedown anywhere in the destination row, which fires BEFORE the input's blur.
    // `relatedTarget` alone cannot tell "reaching for the picker" from "leaving": WebKit (the
    // Tauri window) does not focus a button on click, so relatedTarget is null and the blur
    // looked like leaving — closing the composer (empty draft) or committing to the OLD target
    // (typed draft) before the picker ever opened.
    let picking = false
    const backToInput = () => {
        picking = false
        queueMicrotask(() => input?.focus())
    }
    const targets = () => props.targets ?? []
    const markerColor = () =>
        targets().length > 0
            ? targets().find(t => t.id === props.target)?.color
            : props.color

    return (
        <div
            ref={root}
            data-testid="task-cell-composer"
            class={[styles.composer, props.class ?? '']
                .filter(Boolean)
                .join(' ')}
            // Stops click, mousedown, pointerdown and dblclick so the day cell this sits inside
            // (which opens the "create event" modal on click and starts a drag on mousedown) cannot
            // re-open itself or start a drag out from under the composer.
            {...gestureStops}
        >
            <div class={styles.row}>
                {/* The `[ ]` is the same mark a TaskChip draws — display only (readOnly): the
                    composer owns the click, and the mark is a preview of the task to come. */}
                <TaskCheck
                    readOnly
                    status="todo"
                    color={markerColor()}
                    label="new task"
                    onToggle={() => {}}
                    onSetStatus={() => {}}
                />
                <TextInput
                    plain
                    class={styles.input}
                    value={text()}
                    onInput={setText}
                    data-testid="task-cell-composer-input"
                    // The same pattern InlineTextInput uses for the category rename field: focus has to be
                    // deferred a tick past mount, or the element isn't attached yet to focus.
                    ref={el => {
                        input = el
                        queueMicrotask(() => {
                            el.focus()
                        })
                    }}
                    onKeyDown={e => {
                        if (isDismissKey(e)) {
                            e.preventDefault()
                            done = true
                            props.onCancel()
                            return
                        }
                        if (!isConfirmKey(e)) return
                        e.preventDefault()
                        const trimmed = text().trim()
                        if (!trimmed) {
                            done = true
                            props.onCancel()
                            return
                        }
                        props.onCommit(trimmed)
                        // Keep the draft when there is nowhere to write it: an empty
                        // `destination` is the no-taskFile state (see the hint below), where
                        // the caller opens settings instead of writing. Clearing there would
                        // throw the typed task away. `done` stops the settings modal stealing
                        // focus from re-firing this text through onBlur.
                        if (props.destination) setText('')
                        else done = true
                    }}
                    onBlur={e => {
                        if (done || picking) return
                        // Tab/click moving focus to the target picker below is not "leaving the
                        // composer" — it must not cancel a not-yet-typed draft nor commit an
                        // empty one out from under the user reaching for the picker.
                        const related = e.relatedTarget as Node | null
                        if (related && root?.contains(related)) return
                        const trimmed = text().trim()
                        // Same as the Enter path: commit, then clear. The caller keeps the
                        // composer mounted, so leaving the committed text in the input would
                        // invite a second Enter writing the same task again.
                        if (trimmed) {
                            props.onCommit(trimmed)
                            setText('')
                        } else props.onCancel()
                    }}
                />
            </div>
            <div
                class={styles.destination}
                data-testid="task-cell-composer-destination"
                onMouseDown={() => {
                    if (targets().length > 1) picking = true
                }}
            >
                <Show
                    when={targets().length > 1}
                    fallback={
                        <Show
                            when={props.destination}
                            fallback={
                                <Text
                                    as="span"
                                    inherit
                                    class={`${styles.destinationText} ${styles.unset}`}
                                    data-testid="task-cell-composer-destination-text"
                                >
                                    → no destination note // set one in settings
                                </Text>
                            }
                        >
                            <Text
                                as="span"
                                inherit
                                class={styles.destinationText}
                                title={props.destination}
                                data-testid="task-cell-composer-destination-text"
                            >
                                → {props.destination}
                            </Text>
                        </Show>
                    }
                >
                    <Text as="span" inherit class={styles.destinationLabel}>
                        →
                    </Text>
                    <Select
                        value={props.target ?? ''}
                        options={targets().map(t => ({
                            value: t.id,
                            label: t.label,
                        }))}
                        onChange={id => {
                            props.onTargetChange?.(id)
                            backToInput()
                        }}
                        onDismiss={backToInput}
                        class={styles.targetSelect}
                        triggerClass={styles.targetTrigger}
                        caretClass={styles.targetCaret}
                    />
                </Show>
            </div>
        </div>
    )
}

export default TaskCellComposer
