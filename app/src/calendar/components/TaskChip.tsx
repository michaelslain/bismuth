// One task chip in the tasks-register calendar. Carried-or-not is the whole drawing: a task
// whose `late` (from taskPlacement.ts's placeRows) is > 0 has rolled onto today from a day that
// passed, and gets the danger wash + hairline + "Nd late" register chosen from rendered mockups
// (see the design doc, Part 2 — the tasks calendar). A task placed on today itself has
// `late === 0` — it is NOT carried — and reads as ordinary text, same as any chip not yet due.
//
// Keyboard access: the root is a focusable `role="button"` whose keydown is entirely decided by
// `taskChipKeys.ts`'s pure `chipKeyAction` (Enter/Space/Shift+F10/ContextMenu/Alt+arrows) — see
// that module for the key map. A reschedule or toggle rewrites the row, which re-renders this
// chip as a NEW element (often in another cell), so `state.ts`'s `focusTaskKey`/`requestTaskFocus`
// carry focus across that remount instead of it falling back to <body>.
import type { Component } from 'solid-js'
import { onMount, Show } from 'solid-js'
import type { PlacedTask } from '../taskPlacement'
import { isWritableTask, taskRowRef } from '../taskPlacement'
import { TASK_DRAG_MIME, encodeTaskDrag } from '../taskDrag'
import { openTaskStatusMenu } from '../../taskStatusMenu'
import { chipKeyAction, taskKey } from '../taskChipKeys'
import { focusTaskKey, requestTaskFocus } from '../state'
import Text from '../../ui/Text'
import TaskCheck from '../../bases/TaskCheck'
import type { TaskCheckStatus } from '../../bases/TaskCheck'
import TaskText from '../../bases/TaskText'
import CalendarChip from './CalendarChip'
import styles from './TaskChip.module.css'

export type TaskChipProps = {
    task: PlacedTask
    onToggle: () => void
    onOpen: () => void
    onSetStatus: (char: string) => void
    onReschedule?: (days: number) => void
    /** Resolved CSS colour of this task's category, painted on the `[ ]` marker. Undefined →
     *  the marker's default --text-muted. */
    color?: string
    class?: string
}

// The literal checkbox char, read from the ROW rather than derived from `resolved` alone:
// `resolved` collapses done AND cancelled to `true` (taskRow.ts, via isResolvedStatus), so a
// cancelled task would render `[x]` — indistinguishable from done — if this used that boolean.
// `note.statusChar` is the raw character between the brackets on the source line ("x", "-",
// "/", " ") and is what every real task row carries (taskToRow always sets it); the
// `resolved`-derived fallback only covers a fixture/story that built a bare `note` object
// without it.
function markerChar(row: PlacedTask['row']): string {
    const raw = row.note.statusChar
    if (typeof raw === 'string' && raw.length === 1) return raw
    return row.note.resolved ? 'x' : ' '
}

// The a11y status word, from the same marker char the checkbox glyph renders — NOT `resolved`
// alone, which collapses done AND cancelled to `true` (see markerChar's own note above). A
// screen reader announcing "done" for a cancelled task would be telling it something false.
function statusWord(char: string): string {
    if (char === 'x') return 'done'
    if (char === '-') return 'cancelled'
    if (char === '/') return 'in progress'
    return ''
}

function checkStatus(char: string): TaskCheckStatus {
    if (char === 'x' || char === 'X') return 'done'
    if (char === '-') return 'cancelled'
    if (char === '/') return 'doing'
    return 'todo'
}

// A focusable element that still holds focus (or contains the thing that does) means the user
// deliberately went there — e.g. clicked into the EventModal that a reschedule opened — while
// the refetch that will remount this chip was still in flight. Only <null>/<body>/anything NOT
// sitting inside a real focusable element counts as "focus was lost" and is fair game to reclaim.
const FOCUSABLE_SELECTOR =
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function focusWasLost(): boolean {
    const active = document.activeElement
    if (!active || active === document.body) return true
    return !active.closest(FOCUSABLE_SELECTOR)
}

// NOTE: props are read whole, never destructured. Destructuring here would read
// `task` once at setup and never see a later reschedule or completion.
const TaskChip: Component<TaskChipProps> = props => {
    // isWritableTask (taskPlacement.ts) is the ONE predicate for "can this row be written to" —
    // dragging, ticking, and the right-click status menu all read it, so none of the three can
    // silently disagree about which rows are writable. Covers both a markdown checkbox line
    // AND a row a base owns (an own-rows base's rows are writable too — see taskWrite.ts).
    const writable = () => isWritableTask(props.task)

    let root: HTMLDivElement | undefined
    const key = () => taskKey(props.task.row)
    onMount(() => {
        if (focusTaskKey.value !== key()) return
        if (focusWasLost()) root?.focus()
        focusTaskKey.value = null
    })
    const label = () =>
        [
            String(props.task.row.note.description ?? ''),
            props.task.late > 0 ? `${props.task.late} days late` : '',
            statusWord(markerChar(props.task.row)),
        ]
            .filter(Boolean)
            .join(', ')

    return (
        <CalendarChip
            ref={el => (root = el)}
            label={label()}
            onOpen={() => props.onOpen()}
            class={[styles.chip, props.task.late > 0 ? styles.carried : '', props.class ?? '']
                .filter(Boolean)
                .join(' ')}
            draggable={writable()}
            aria-keyshortcuts={
                writable()
                    ? 'Enter Space Shift+F10 Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown'
                    : 'Enter'
            }
            onKeyDown={e => {
                const action = chipKeyAction(e)
                if (!action) return
                e.preventDefault()
                e.stopPropagation()
                if (action.kind === 'open') return props.onOpen()
                if (!writable()) return
                if (action.kind === 'toggle') {
                    requestTaskFocus(key())
                    return props.onToggle()
                }
                if (action.kind === 'menu') {
                    const r = root!.getBoundingClientRect()
                    return openTaskStatusMenu(r.left, r.bottom, markerChar(props.task.row), char => {
                        requestTaskFocus(key())
                        props.onSetStatus(char)
                    })
                }
                requestTaskFocus(key())
                props.onReschedule?.(action.days)
            }}
            onDragStart={e => {
                const ref = taskRowRef(props.task)
                if (!ref || !e.dataTransfer) return
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(TASK_DRAG_MIME, encodeTaskDrag(ref))
            }}
        >
            <TaskCheck
                class={styles.marker}
                status={checkStatus(markerChar(props.task.row))}
                color={props.color}
                readOnly={!writable()}
                label={String(props.task.row.note.description ?? '')}
                onToggle={e => {
                    // The day cell opens the composer on click and starts a drag on mousedown;
                    // the mark toggles, it does not also open the note.
                    e.stopPropagation()
                    requestTaskFocus(key())
                    props.onToggle()
                }}
                onSetStatus={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    openTaskStatusMenu(
                        e.clientX,
                        e.clientY,
                        markerChar(props.task.row),
                        char => props.onSetStatus(char),
                    )
                }}
            />
            <Text
                as="span"
                inherit
                class={[
                    styles.title,
                    props.task.row.note.resolved ? styles.resolved : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                data-testid="task-chip-title"
            >
                <TaskText text={String(props.task.row.note.description ?? '')} />
            </Text>
            <Show when={props.task.late > 0}>
                <Text
                    as="span"
                    inherit
                    class={styles.late}
                >
                    {props.task.late}d late
                </Text>
            </Show>
        </CalendarChip>
    )
}

export default TaskChip
