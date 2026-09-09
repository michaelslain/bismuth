import { Show } from 'solid-js'
import { currentDate, events, categories, settings } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import type { PlacedTask } from '../../taskPlacement'
import { addDays, startOfWeek } from '../../dates'

export function WeekView(props: {
    store: EventStore
    placed?: Map<string, PlacedTask[]>
    onToggleTask?: (row: PlacedTask['row']) => void
    onOpenTask?: (row: PlacedTask['row']) => void
}) {
    const dates = () => {
        const d = currentDate.value
        const weekStart = startOfWeek(d, settings.value.weekStartsOnMonday)
        return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    }
    return (
        <Show
            when={props.placed}
            fallback={
                <TimeGrid
                    dates={dates()}
                    events={events.value}
                    categories={categories.value}
                    store={props.store}
                />
            }
        >
            {placed => (
                <TaskAllDayStrip
                    dates={dates()}
                    placed={placed()}
                    onToggleTask={props.onToggleTask}
                    onOpenTask={props.onOpenTask}
                />
            )}
        </Show>
    )
}
