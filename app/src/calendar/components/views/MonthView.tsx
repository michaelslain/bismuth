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
import type { PlacedTask } from '../../taskPlacement'
import { toDateStr, startOfWeek } from '../../dates'
import styles from '../../Calendar.module.css'

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
            <div class={styles['month-grid-header']}>
                <For each={dayNames()}>
                    {d => <div class={styles['month-day-name']}>{d}</div>}
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
                                class={`${styles['month-cell']}${isToday() ? ` ${styles['today']}` : ''}${inMonth() ? '' : ' out'}`}
                                onClick={() => {
                                    // Tasks register: no "create event" affordance on a
                                    // bare cell click — creating a task is the toolbar's
                                    // "[ + task ]" action, which knows which file to write
                                    // to. A grid cell only ever says which DAY.
                                    if (props.placed) return
                                    showEventModal.value = { date: dateStr() }
                                }}
                            >
                                <div
                                    class={`${styles['month-cell-number']}${inMonth() ? '' : ` ${styles['dim']}`}${isToday() ? ` ${styles['cal-today-circle']}` : ''}`}
                                >
                                    {dayNum()}
                                </div>
                                <div class={styles['month-cell-events']}>
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
                                                />
                                            )}
                                        </For>
                                    </Show>
                                </div>
                            </div>
                        )
                    }}
                </Index>
            </div>
        </div>
    )
}
