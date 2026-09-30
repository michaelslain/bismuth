import { For, Index, Show } from 'solid-js'
import {
    currentDate,
    events as eventsSignal,
    categories,
    showEventModal,
    settings,
} from '../../state'
import type { CalendarEvent } from '../../types'
import { EventStore } from '../../EventStore'
import { EventChip } from '../EventChip'
import type { PlacedTask } from '../../taskPlacement'
import type { TaskComposeProps } from '../../taskCompose'
import type { TaskRowRef } from '../../taskDrag'
import { monthGrid, weekdayNames } from '../../dates'
import { todayISO } from '../../../../../core/src/dates'
import Text from '../../../ui/Text'
import AsciiCellEdges from '../../../ui/ascii/AsciiCellEdges'
import MonthCell from './MonthCell'
import TaskDayCell from './TaskDayCell'
import styles from './MonthView.module.css'

/** The tasks register's wiring, shared by every view that can show it (month, week, 3-day, day,
 *  and the all-day strip). Passing `placed` is what selects the tasks register. */
export type TaskViewProps = {
    placed?: Map<string, PlacedTask[]>
    onToggleTask?: (row: PlacedTask['row']) => void
    onOpenTask?: (row: PlacedTask['row']) => void
    onSetTaskStatus?: (row: PlacedTask['row'], char: string) => void
    onRescheduleTask?: (ref: TaskRowRef, date: string) => void
    compose?: TaskComposeProps
    colorFor?: (task: PlacedTask) => string | undefined
}

export type MonthViewProps = {
    store: EventStore
    /** Events to draw. Defaults to the calendar's shared `events` signal. */
    events?: CalendarEvent[]
} & TaskViewProps

export function MonthView(props: MonthViewProps) {
    const mondayFirst = () => settings.value.weekStartsOnMonday
    const today = todayISO(new Date())
    const cells = () =>
        monthGrid(
            currentDate.value.getFullYear(),
            currentDate.value.getMonth(),
            mondayFirst(),
        )
    const allEvents = () => props.events ?? eventsSignal.value

    return (
        <div class={styles['month-view']}>
            <div class={styles.scroller} data-testid="month-scroller">
                <div class={styles['month-grid-header']}>
                    <For each={weekdayNames(mondayFirst())}>
                        {(d, col) => (
                            <div class={styles['month-day']}>
                                <Text
                                    as="div"
                                    size="micro"
                                    tone="faint"
                                    weight="inherit"
                                    eyebrow
                                    class={styles['month-day-name']}
                                    data-testid="month-day-name"
                                >
                                    {d}
                                </Text>
                                {/* the header types its top + left (the last also its right) and its bottom
                                    HEAVY — the `=` under the labels; the first body row omits its top.
                                    A sibling of the label, not a child: the eyebrow's letter-spacing is
                                    inherited and would break the one-glyph-one-ch rule. */}
                                <AsciiCellEdges
                                    edges={[
                                        'top',
                                        'left',
                                        ...(col() === 6 ? (['right'] as const) : []),
                                        'bottom',
                                    ]}
                                    edgeWeight={{ bottom: 'heavy' }}
                                />
                            </div>
                        )}
                    </For>
                </div>
                <div class={styles['month-grid']}>
                    <Index each={cells()}>
                        {(cell, i) => {
                            const dateStr = () => todayISO(cell().date)
                            return (
                                <MonthCell
                                    date={dateStr()}
                                    day={cell().date.getDate()}
                                    inMonth={cell().inMonth}
                                    today={dateStr() === today}
                                    isFirstRow={i < 7}
                                    isLastCol={i % 7 === 6}
                                    isLastRow={i >= cells().length - 7}
                                    // Tasks register: a bare click opens the inline composer for THIS
                                    // day rather than the create-event modal — tasks and events are
                                    // different files, and the composer knows which to write to.
                                    onOpen={() => {
                                        if (props.placed) props.compose?.open(dateStr())
                                        else showEventModal.value = { date: dateStr() }
                                    }}
                                    onDropTask={
                                        props.placed
                                            ? (ref, date) => props.onRescheduleTask?.(ref, date)
                                            : undefined
                                    }
                                >
                                    <Show
                                        when={props.placed}
                                        fallback={
                                            <For each={allEvents().filter(e => e.date === dateStr())}>
                                                {e => (
                                                    <EventChip
                                                        event={e}
                                                        masterId={e.recurrence ? e.id : undefined}
                                                        occurrenceDate={
                                                            e.recurrence ? dateStr() : undefined
                                                        }
                                                        categories={categories.value}
                                                        store={props.store}
                                                    />
                                                )}
                                            </For>
                                        }
                                    >
                                        {placed => (
                                            <TaskDayCell
                                                date={dateStr()}
                                                tasks={placed().get(dateStr()) ?? []}
                                                onToggleTask={props.onToggleTask}
                                                onOpenTask={props.onOpenTask}
                                                onSetTaskStatus={props.onSetTaskStatus}
                                                onRescheduleTask={props.onRescheduleTask}
                                                compose={props.compose}
                                                colorFor={props.colorFor}
                                            />
                                        )}
                                    </Show>
                                </MonthCell>
                            )
                        }}
                    </Index>
                </div>
            </div>
        </div>
    )
}
