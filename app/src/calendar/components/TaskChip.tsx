// One task chip in the tasks-register calendar. Carried-or-not is the whole drawing: a task
// whose `late` (from taskPlacement.ts's placeRows) is > 0 has rolled onto today from a day that
// passed, and gets the danger wash + hairline + "Nd late" register chosen from rendered mockups
// (see the design doc, Part 2 — the tasks calendar). A task placed on today itself has
// `late === 0` — it is NOT carried — and reads as ordinary text, same as any chip not yet due.
import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import type { PlacedTask } from '../taskPlacement'
import { isTaskLine } from '../taskPlacement'
import { TASK_DRAG_MIME, encodeTaskDrag } from '../taskDrag'
import { openTaskStatusMenu } from '../../taskStatusMenu'
import styles from './TaskChip.module.css'

export type TaskChipProps = {
    task: PlacedTask
    onToggle: () => void
    onOpen: () => void
    onSetStatus: (char: string) => void
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

const READ_ONLY_TITLE =
    "Can't toggle — this task was created from a base that owns its rows, not a markdown line"

// NOTE: props are read whole, never destructured. Destructuring here would read
// `task` once at setup and never see a later reschedule or completion.
const TaskChip: Component<TaskChipProps> = props => {
    // isTaskLine (taskPlacement.ts) is the ONE predicate for "can this row be written to" —
    // dragging, ticking, and the right-click status menu all read it, so none of the three can
    // silently disagree about which rows are writable. A self-owned base's row (no `source:`)
    // fails it: it is a YAML row, not a markdown checkbox line, so there is nowhere for a
    // toggle/status/reschedule write to land.
    const writable = () => isTaskLine(props.task)

    return (
        <div
            class={[styles.chip, props.task.late > 0 ? styles.carried : '', props.class ?? '']
                .filter(Boolean)
                .join(' ')}
            draggable={writable()}
            onDragStart={e => {
                if (!writable() || !e.dataTransfer) return
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(
                    TASK_DRAG_MIME,
                    encodeTaskDrag({
                        path: props.task.row.file.path,
                        line: props.task.row.note.line as number,
                        field: props.task.field!,
                    }),
                )
            }}
            onClick={e => {
                // The day cell this chip renders inside wires its OWN onClick to open the
                // "create event" modal (MonthView.tsx). Without this stop, opening a task's
                // note also pops that modal over it.
                e.stopPropagation()
                props.onOpen()
            }}
        >
            <span
                class={[styles.marker, writable() ? '' : styles.readOnly]
                    .filter(Boolean)
                    .join(' ')}
                title={
                    writable()
                        ? 'Toggle task — right-click to set status'
                        : READ_ONLY_TITLE
                }
                aria-disabled={writable() ? undefined : 'true'}
                data-testid="task-chip-marker"
                // Stop all four. The day cell opens the create-event modal on `click` (see the
                // root div above) and starts a drag on `mousedown` — NOT `pointerdown`, which
                // this calendar does not use anywhere today (TimeGrid.tsx's drag handlers are
                // mousedown-based). `pointerdown` is stopped anyway, at zero cost, because a
                // future gutter (Task 14) may add pointer-based drag — do not trim this back to
                // "the obvious two". Stopped unconditionally, whether or not the marker is
                // writable: this is drag-source hygiene, not a toggle action.
                onClick={e => {
                    // NOT writable: do nothing special, and — critically — do NOT
                    // stopPropagation either. The click falls through to the root div's own
                    // onClick above and opens the note, exactly like clicking the title would.
                    // A dimmed marker that swallows its click into nothing is a dead zone that
                    // LOOKS clickable and silently isn't — the thing this is built to avoid.
                    if (!writable()) return
                    e.stopPropagation()
                    props.onToggle()
                }}
                onMouseDown={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                onDblClick={e => e.stopPropagation()}
                onContextMenu={e => {
                    // Same non-interception as onClick above: no custom menu, and no
                    // preventDefault/stopPropagation either, so the browser's own context menu
                    // (or nothing) behaves exactly as it would over any other plain text.
                    if (!writable()) return
                    e.preventDefault()
                    e.stopPropagation()
                    const cur = markerChar(props.task.row)
                    openTaskStatusMenu(e.clientX, e.clientY, cur, char =>
                        props.onSetStatus(char),
                    )
                }}
            >
                [{markerChar(props.task.row)}]
            </span>
            <span class={styles.title} data-testid="task-chip-title">
                {String(props.task.row.note.description ?? '')}
            </span>
            <Show when={props.task.late > 0}>
                <span class={styles.late}>{props.task.late}d late</span>
            </Show>
        </div>
    )
}

export default TaskChip
