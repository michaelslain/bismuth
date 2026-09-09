// One task chip in the tasks-register calendar. Carried-or-not is the whole drawing: a task
// whose `late` (from taskPlacement.ts's placeRows) is > 0 has rolled onto today from a day that
// passed, and gets the danger wash + hairline + "Nd late" register chosen from rendered mockups
// (see the design doc, Part 2 — the tasks calendar). A task placed on today itself has
// `late === 0` — it is NOT carried — and reads as ordinary text, same as any chip not yet due.
import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import type { PlacedTask } from '../taskPlacement'
import styles from './TaskChip.module.css'

export type TaskChipProps = {
    task: PlacedTask
    onToggle: () => void
    onOpen: () => void
    class?: string
}

// NOTE: props are read whole, never destructured. Destructuring here would read
// `task` once at setup and never see a later reschedule or completion.
const TaskChip: Component<TaskChipProps> = props => (
    <div
        class={[styles.chip, props.task.late > 0 ? styles.carried : '', props.class ?? '']
            .filter(Boolean)
            .join(' ')}
        onClick={e => {
            // The day cell this chip renders inside wires its OWN onClick to open the
            // "create event" modal (MonthView.tsx). Without this stop, opening a task's
            // note also pops that modal over it.
            e.stopPropagation()
            props.onOpen()
        }}
    >
        <span
            class={styles.marker}
            title="Toggle task — right-click to set status"
            data-testid="task-chip-marker"
            // Stop all four. The day cell opens the create-event modal on `click` (see the
            // root div above) and starts a drag on `mousedown` — NOT `pointerdown`, which
            // this calendar does not use anywhere today (TimeGrid.tsx's drag handlers are
            // mousedown-based). `pointerdown` is stopped anyway, at zero cost, because a
            // future gutter (Task 14) may add pointer-based drag — do not trim this back to
            // "the obvious two".
            onClick={e => {
                e.stopPropagation()
                props.onToggle()
            }}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onDblClick={e => e.stopPropagation()}
        >
            [ ]
        </span>
        <span class={styles.title} data-testid="task-chip-title">
            {String(props.task.row.note.description ?? '')}
        </span>
        <Show when={props.task.late > 0}>
            <span class={styles.late}>{props.task.late}d late</span>
        </Show>
    </div>
)

export default TaskChip
