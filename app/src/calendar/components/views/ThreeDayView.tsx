import { Show } from 'solid-js'
import { currentDate, events, categories } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import type { PlacedTask } from '../../taskPlacement'
import type { TaskComposeProps } from '../../taskCompose'
import { addDays } from '../../dates'

export function ThreeDayView(props: {
    store: EventStore
    placed?: Map<string, PlacedTask[]>
    onToggleTask?: (row: PlacedTask['row']) => void
    onOpenTask?: (row: PlacedTask['row']) => void
    onSetTaskStatus?: (row: PlacedTask['row'], char: string) => void
    onRescheduleTask?: (path: string, line: number, field: string, date: string) => void
    compose?: TaskComposeProps
    colorFor?: (task: PlacedTask) => string | undefined
}) {
    const dates = () => {
        const d = currentDate.value
        return Array.from({ length: 3 }, (_, i) => addDays(d, i))
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
                    onSetTaskStatus={props.onSetTaskStatus}
                    onRescheduleTask={props.onRescheduleTask}
                    compose={props.compose}
                    colorFor={props.colorFor}
                />
            )}
        </Show>
    )
}
