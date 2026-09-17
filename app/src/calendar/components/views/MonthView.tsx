import { For, Index, Show } from 'solid-js'
import {
    currentDate,
    events,
    categories,
    showEventModal,
    settings,
} from '../../state'
import { EventStore } from '../../EventStore'
import { EventChip } from '../EventChip'
import TaskChip from '../TaskChip'
import TaskCellComposer from '../TaskCellComposer'
import DayNumber from '../DayNumber'
import type { PlacedTask } from '../../taskPlacement'
import type { TaskComposeProps } from '../../taskCompose'
import { TASK_DRAG_MIME, decodeTaskDrag } from '../../taskDrag'
import { toDateStr, startOfWeek } from '../../dates'
import { addDaysISO } from '../../../../../core/src/dates'
import styles from './MonthView.module.css'

const DAYS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// A grid cell now always carries a real calendar date; `inMonth=false` marks the
// leading/trailing days that spill in from the previous / next month (dimmed).
interface Cell {
    date: Date
    inMonth: boolean
}

export function MonthView(props: {
    store: EventStore
    placed?: Map<string, PlacedTask[]>
    onToggleTask?: (row: PlacedTask['row']) => void
    onOpenTask?: (row: PlacedTask['row']) => void
    onSetTaskStatus?: (row: PlacedTask['row'], char: string) => void
    onRescheduleTask?: (path: string, line: number, field: string, date: string) => void
    compose?: TaskComposeProps
    colorFor?: (task: PlacedTask) => string | undefined
}) {
    const year = () => currentDate.value.getFullYear()
    const month = () => currentDate.value.getMonth()
    const mondayFirst = () => settings.value.weekStartsOnMonday
    const dayNames = () => (mondayFirst() ? DAYS_MON : DAYS_SUN)
    const today = toDateStr(new Date())

    const cells = (): Cell[] => {
        const firstOfMonth = new Date(year(), month(), 1)
        const weekStart = startOfWeek(firstOfMonth, mondayFirst())
        const firstDay = Math.round(
            (firstOfMonth.getTime() - weekStart.getTime()) / 86400000,
        )
        const daysInMonth = new Date(year(), month() + 1, 0).getDate()
        const total = Math.ceil((firstDay + daysInMonth) / 7) * 7
        const c: Cell[] = []
        for (let i = 0; i < total; i++) {
            const dayOffset = i - firstDay
            const date = new Date(year(), month(), 1 + dayOffset)
            c.push({ date, inMonth: dayOffset >= 0 && dayOffset < daysInMonth })
        }
        return c
    }

    return (
        <div class={styles['month-view']}>
            <div class={styles.scroller} data-testid="month-scroller">
                <div class={styles['month-grid-header']}>
                    <For each={dayNames()}>
                        {d => (
                            <div
                                class={styles['month-day-name']}
                                data-testid="month-day-name"
                            >
                                {d}
                            </div>
                        )}
                    </For>
                </div>
                <div class={styles['month-grid']}>
                    <Index each={cells()}>
                        {cell => {
                            const dateStr = () => toDateStr(cell().date)
                            const dayNum = () => cell().date.getDate()
                            const inMonth = () => cell().inMonth
                            const isToday = () => dateStr() === today
                            const dayEvents = () =>
                                events.value.filter(e => e.date === dateStr())
                            const dayTasks = () =>
                                props.placed?.get(dateStr()) ?? []
                            return (
                                <div
                                    class={styles['month-cell']}
                                    data-testid="month-cell"
                                    onClick={() => {
                                        // Tasks register: a bare cell click opens the inline
                                        // composer for THIS day (props.compose) rather than the
                                        // "create event" modal — tasks and events are different
                                        // files/writes, and the composer knows which one to write
                                        // to. The events register's create-event click below is
                                        // untouched.
                                        if (props.placed) {
                                            props.compose?.open(dateStr())
                                            return
                                        }
                                        showEventModal.value = { date: dateStr() }
                                    }}
                                    onDragOver={e => {
                                        // Only a cell in the TASKS register accepts a task drop —
                                        // must preventDefault for `drop` to fire at all (browsers
                                        // reject a drop on any element that never opts in).
                                        if (!props.placed) return
                                        e.preventDefault()
                                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                                    }}
                                    onDrop={e => {
                                        if (!props.placed) return
                                        e.preventDefault()
                                        const raw = e.dataTransfer?.getData(TASK_DRAG_MIME)
                                        const payload = raw ? decodeTaskDrag(raw) : null
                                        if (!payload) return
                                        props.onRescheduleTask?.(
                                            payload.path,
                                            payload.line,
                                            payload.field,
                                            dateStr(),
                                        )
                                    }}
                                >
                                    <DayNumber
                                        day={dayNum()}
                                        today={isToday()}
                                        class={`${styles['month-cell-number']}${inMonth() ? '' : ` ${styles['dim']}`}`}
                                    />
                                    <div
                                        class={styles['month-cell-events']}
                                        data-testid="month-cell-events"
                                    >
                                        <Show
                                            when={props.placed}
                                            fallback={
                                                <For each={dayEvents()}>
                                                    {e => (
                                                        <EventChip
                                                            event={e}
                                                            masterId={
                                                                e.recurrence
                                                                    ? e.id
                                                                    : undefined
                                                            }
                                                            occurrenceDate={
                                                                e.recurrence
                                                                    ? dateStr()
                                                                    : undefined
                                                            }
                                                            categories={
                                                                categories.value
                                                            }
                                                            store={props.store}
                                                        />
                                                    )}
                                                </For>
                                            }
                                        >
                                            <For each={dayTasks()}>
                                                {t => (
                                                    <TaskChip
                                                        task={t}
                                                        color={props.colorFor?.(t)}
                                                        onToggle={() =>
                                                            props.onToggleTask?.(
                                                                t.row,
                                                            )
                                                        }
                                                        onOpen={() =>
                                                            props.onOpenTask?.(
                                                                t.row,
                                                            )
                                                        }
                                                        onSetStatus={char =>
                                                            props.onSetTaskStatus?.(
                                                                t.row,
                                                                char,
                                                            )
                                                        }
                                                        onReschedule={days => {
                                                            const line = t.row.note.line
                                                            if (
                                                                t.field === undefined ||
                                                                typeof line !== 'number'
                                                            )
                                                                return
                                                            // from the day the chip is DRAWN on (a carried task sits on
                                                            // today), matching drag-and-drop
                                                            props.onRescheduleTask?.(
                                                                t.row.file.path,
                                                                line,
                                                                t.field,
                                                                addDaysISO(dateStr(), days),
                                                            )
                                                        }}
                                                    />
                                                )}
                                            </For>
                                            <Show when={props.compose?.date === dateStr()}>
                                                <TaskCellComposer
                                                    destination={props.compose!.destination}
                                                    onCommit={text =>
                                                        props.compose!.commit(dateStr(), text)
                                                    }
                                                    onCancel={() => props.compose!.cancel()}
                                                />
                                            </Show>
                                        </Show>
                                    </div>
                                </div>
                            )
                        }}
                    </Index>
                </div>
            </div>
        </div>
    )
}
