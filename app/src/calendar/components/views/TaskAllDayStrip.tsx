import { For } from 'solid-js'
import { toDateStr } from '../../dates'
import TaskChip from '../TaskChip'
import type { PlacedTask } from '../../taskPlacement'
import { TASK_DRAG_MIME, decodeTaskDrag } from '../../taskDrag'
import styles from '../../Calendar.module.css'

/**
 * Week/3day/day layout for the tasks register — shared by WeekView, ThreeDayView and
 * DayView. Tasks are all-day, so this register never touches TimeGrid's hourly grid at
 * all: it is just TimeGrid's own day-header row + all-day gutter row (same CSS classes,
 * so the two registers line up pixel-for-pixel where they share a shape), with TaskChip
 * in place of EventChip and no time-grid body underneath.
 */
export function TaskAllDayStrip(props: {
    dates: Date[]
    placed: Map<string, PlacedTask[]>
    onToggleTask?: (row: PlacedTask['row']) => void
    onOpenTask?: (row: PlacedTask['row']) => void
    onSetTaskStatus?: (row: PlacedTask['row'], char: string) => void
    onRescheduleTask?: (path: string, line: number, field: string, date: string) => void
}) {
    const today = toDateStr(new Date())
    return (
        <div class={styles['time-grid']}>
            <div class={styles['time-grid-columns']}>
                <div class={styles['time-grid-sticky-header']}>
                    <div class={styles['time-gutter']} />
                    <For each={props.dates}>
                        {d => {
                            const ds = toDateStr(d)
                            const weekday = d.toLocaleString('default', {
                                weekday: 'short',
                            })
                            const month = d.toLocaleString('default', {
                                month: 'numeric',
                            })
                            const dayNum = d.getDate()
                            return (
                                <div
                                    class={`${styles['time-grid-day-header']}${ds === today ? ` ${styles['today']}` : ''}`}
                                >
                                    <span class={styles['time-grid-day-weekday']}>
                                        {weekday}
                                    </span>{' '}
                                    <span class={styles['time-grid-day-date']}>
                                        {month}/
                                        <b
                                            class={
                                                ds === today
                                                    ? styles['cal-today-circle']
                                                    : undefined
                                            }
                                        >
                                            {dayNum}
                                        </b>
                                    </span>
                                </div>
                            )
                        }}
                    </For>
                </div>
                <div class={styles['time-grid-allday-row']}>
                    <div class={styles['time-gutter']} />
                    <For each={props.dates}>
                        {d => {
                            const ds = toDateStr(d)
                            const tasks = () => props.placed.get(ds) ?? []
                            return (
                                <div
                                    class={styles['time-grid-allday-cell']}
                                    onDragOver={e => {
                                        e.preventDefault()
                                        if (e.dataTransfer)
                                            e.dataTransfer.dropEffect = 'move'
                                    }}
                                    onDrop={e => {
                                        e.preventDefault()
                                        const raw =
                                            e.dataTransfer?.getData(TASK_DRAG_MIME)
                                        const payload = raw
                                            ? decodeTaskDrag(raw)
                                            : null
                                        if (!payload) return
                                        props.onRescheduleTask?.(
                                            payload.path,
                                            payload.line,
                                            payload.field,
                                            ds,
                                        )
                                    }}
                                >
                                    <For each={tasks()}>
                                        {t => (
                                            <TaskChip
                                                task={t}
                                                onToggle={() =>
                                                    props.onToggleTask?.(t.row)
                                                }
                                                onOpen={() =>
                                                    props.onOpenTask?.(t.row)
                                                }
                                                onSetStatus={char =>
                                                    props.onSetTaskStatus?.(
                                                        t.row,
                                                        char,
                                                    )
                                                }
                                            />
                                        )}
                                    </For>
                                </div>
                            )
                        }}
                    </For>
                </div>
            </div>
        </div>
    )
}
