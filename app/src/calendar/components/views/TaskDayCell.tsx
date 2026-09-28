import { For, Show, type Component } from 'solid-js'
import { addDaysISO } from '../../../../../core/src/dates'
import IconButton from '../../../ui/IconButton'
import { taskRowRef } from '../../taskPlacement'
import type { PlacedTask } from '../../taskPlacement'
import TaskChip from '../TaskChip'
import TaskCellComposer from '../TaskCellComposer'
import type { TaskViewProps } from './MonthView'
import styles from './TaskDayCell.module.css'

export type TaskDayCellProps = {
    /** `YYYY-MM-DD` */
    date: string
    tasks: PlacedTask[]
} & Omit<TaskViewProps, 'placed'>

/** What one day of the tasks register holds — shared by the month grid's cell and the
 *  week/3-day/day strip's cell, so the two never disagree about a chip's wiring. Quiet by
 *  default: the add button is opacity 0, revealed by its cell's hover/focus-within, and it is
 *  still a real focusable element so a keyboard user tabbing through finds it. */
const TaskDayCell: Component<TaskDayCellProps> = props => (
    <>
        <For each={props.tasks}>
            {t => (
                <TaskChip
                    task={t}
                    color={props.colorFor?.(t)}
                    onToggle={() => props.onToggleTask?.(t.row)}
                    onOpen={() => props.onOpenTask?.(t.row)}
                    onSetStatus={char => props.onSetTaskStatus?.(t.row, char)}
                    onReschedule={days => {
                        const ref = taskRowRef(t)
                        if (!ref) return
                        // from the day the chip is DRAWN on (a carried task sits on today),
                        // matching drag-and-drop
                        props.onRescheduleTask?.(ref, addDaysISO(props.date, days))
                    }}
                />
            )}
        </For>
        <Show when={props.compose?.date !== props.date}>
            <IconButton
                icon="Plus"
                label="Add task"
                size="sm"
                class={styles.add}
                data-add-task=""
                onClick={e => {
                    e.stopPropagation()
                    props.compose?.open(props.date)
                }}
            />
        </Show>
        <Show when={props.compose?.date === props.date}>
            <TaskCellComposer
                destination={props.compose!.destination}
                color={props.compose!.color}
                targets={props.compose!.targets}
                target={props.compose!.target}
                onTargetChange={props.compose!.setTarget}
                onCommit={text => props.compose!.commit(props.date, text)}
                onCancel={() => props.compose!.cancel()}
            />
        </Show>
    </>
)

export default TaskDayCell
