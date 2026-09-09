import { Show } from 'solid-js'
import { currentDate, events, categories } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import type { PlacedTask } from '../../taskPlacement'

export function DayView(props: {
    store: EventStore
    placed?: Map<string, PlacedTask[]>
    onToggleTask?: (row: PlacedTask['row']) => void
    onOpenTask?: (row: PlacedTask['row']) => void
    onSetTaskStatus?: (row: PlacedTask['row'], char: string) => void
    onRescheduleTask?: (path: string, line: number, field: string, date: string) => void
}) {
    return (
        <Show
            when={props.placed}
            fallback={
                <TimeGrid
                    dates={[currentDate.value]}
                    events={events.value}
                    categories={categories.value}
                    store={props.store}
                />
            }
        >
            {placed => (
                <TaskAllDayStrip
                    dates={[currentDate.value]}
                    placed={placed()}
                    onToggleTask={props.onToggleTask}
                    onOpenTask={props.onOpenTask}
                    onSetTaskStatus={props.onSetTaskStatus}
                    onRescheduleTask={props.onRescheduleTask}
                />
            )}
        </Show>
    )
}
