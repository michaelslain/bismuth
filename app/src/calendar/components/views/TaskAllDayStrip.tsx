import { For, Show } from 'solid-js'
import { toDateStr } from '../../dates'
import { addDaysISO } from '../../../../../core/src/dates'
import TaskChip from '../TaskChip'
import TaskCellComposer from '../TaskCellComposer'
import type { PlacedTask } from '../../taskPlacement'
import type { TaskComposeProps } from '../../taskCompose'
import { TASK_DRAG_MIME, decodeTaskDrag } from '../../taskDrag'
import DayHeaderRow from './DayHeaderRow'
import AllDayRow from './AllDayRow'
import styles from './TaskAllDayStrip.module.css'

/**
 * Week/3day/day layout for the tasks register — shared by WeekView, ThreeDayView and
 * DayView. Tasks are all-day, so this register never touches TimeGrid's hourly grid at
 * all: it composes the same DayHeaderRow/AllDayRow components TimeGrid does, so the two
 * registers can never disagree about column geometry, with TaskChip in place of EventChip
 * and no time-grid body underneath.
 *
 * `gutter={false}` on both rows: there is no TimeGrid under this register to align hour
 * labels with, so the empty gutter spacer column TimeGrid needs is just dead space here.
 */
export function TaskAllDayStrip(props: {
    dates: Date[]
    placed: Map<string, PlacedTask[]>
    onToggleTask?: (row: PlacedTask['row']) => void
    onOpenTask?: (row: PlacedTask['row']) => void
    onSetTaskStatus?: (row: PlacedTask['row'], char: string) => void
    onRescheduleTask?: (path: string, line: number, field: string, date: string) => void
    compose?: TaskComposeProps
    colorFor?: (task: PlacedTask) => string | undefined
}) {
    const today = toDateStr(new Date())
    return (
        <div class={styles.strip}>
            <DayHeaderRow class={styles.head} dates={props.dates} today={today} gutter={false} />
            <AllDayRow
                fill
                gutter={false}
                dates={props.dates}
                onCellDragOver={e => {
                    e.preventDefault()
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                }}
                onCellDrop={(e, ds) => {
                    e.preventDefault()
                    const raw = e.dataTransfer?.getData(TASK_DRAG_MIME)
                    const payload = raw ? decodeTaskDrag(raw) : null
                    if (!payload) return
                    props.onRescheduleTask?.(payload.path, payload.line, payload.field, ds)
                }}
                cell={ds => (
                    // AllDayRow owns the outer `.cell` box (its own module, not ours) and only
                    // forwards drag/drop callbacks — a plain click has nowhere to land there, so
                    // this wrapper carries the click that opens the composer for its own date.
                    <div
                        class={styles.cellInner}
                        data-testid="task-day-cell"
                        onClick={() => props.compose?.open(ds)}
                    >
                        <For each={props.placed.get(ds) ?? []}>
                            {t => (
                                <TaskChip
                                    task={t}
                                    color={props.colorFor?.(t)}
                                    onToggle={() => props.onToggleTask?.(t.row)}
                                    onOpen={() => props.onOpenTask?.(t.row)}
                                    onSetStatus={char => props.onSetTaskStatus?.(t.row, char)}
                                    onReschedule={days => {
                                        const line = t.row.note.line
                                        if (t.field === undefined || typeof line !== 'number') return
                                        // from the day the chip is DRAWN on (a carried task sits on
                                        // today), matching drag-and-drop
                                        props.onRescheduleTask?.(
                                            t.row.file.path,
                                            line,
                                            t.field,
                                            addDaysISO(ds, days),
                                        )
                                    }}
                                />
                            )}
                        </For>
                        <Show when={props.compose?.date === ds}>
                            <TaskCellComposer
                                destination={props.compose!.destination}
                                onCommit={text => props.compose!.commit(ds, text)}
                                onCancel={() => props.compose!.cancel()}
                            />
                        </Show>
                    </div>
                )}
            />
        </div>
    )
}
