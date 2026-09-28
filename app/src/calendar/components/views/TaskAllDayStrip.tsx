import type { Component } from 'solid-js'
import { toDateStr } from '../../dates'
import { readTaskDrop } from '../../taskDrag'
import DayHeaderRow from './DayHeaderRow'
import AllDayRow from './AllDayRow'
import TaskDayCell from './TaskDayCell'
import type { TaskViewProps } from './MonthView'
import styles from './TaskAllDayStrip.module.css'

export type TaskAllDayStripProps = {
    dates: Date[]
    placed: NonNullable<TaskViewProps['placed']>
} & Omit<TaskViewProps, 'placed'>

/**
 * Week/3day/day layout for the tasks register — shared by WeekView, ThreeDayView and
 * DayView. Tasks are all-day, so this register never touches TimeGrid's hourly grid at
 * all: it composes the same DayHeaderRow/AllDayRow components TimeGrid does, so the two
 * registers can never disagree about column geometry, with TaskDayCell in place of EventChip
 * and no time-grid body underneath.
 *
 * `gutter={false}` on both rows: there is no TimeGrid under this register to align hour
 * labels with, so the empty gutter spacer column TimeGrid needs is just dead space here.
 */
export const TaskAllDayStrip: Component<TaskAllDayStripProps> = props => {
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
                    const ref = readTaskDrop(e)
                    if (ref) props.onRescheduleTask?.(ref, ds)
                }}
                cell={ds => (
                    // AllDayRow owns the outer `.cell` box and only forwards drag/drop
                    // callbacks — a plain click has nowhere to land there, so this wrapper
                    // carries the click that opens the composer for its own date.
                    <div
                        class={styles.cellInner}
                        data-testid="task-day-cell"
                        onClick={() => props.compose?.open(ds)}
                    >
                        <TaskDayCell
                            date={ds}
                            tasks={props.placed.get(ds) ?? []}
                            onToggleTask={props.onToggleTask}
                            onOpenTask={props.onOpenTask}
                            onSetTaskStatus={props.onSetTaskStatus}
                            onRescheduleTask={props.onRescheduleTask}
                            compose={props.compose}
                            colorFor={props.colorFor}
                        />
                    </div>
                )}
            />
        </div>
    )
}
