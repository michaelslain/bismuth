import { Show } from 'solid-js'
import { currentDate, events, categories } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import type { PlacedTask } from '../../taskPlacement'
import type { TaskComposeProps } from '../../taskCompose'

export function DayView(props: {
    store: EventStore
    placed?: Map<string, PlacedTask[]>
    onToggleTask?: (row: PlacedTask['row']) => void
    onOpenTask?: (row: PlacedTask['row']) => void
    onSetTaskStatus?: (row: PlacedTask['row'], char: string) => void
    onRescheduleTask?: (path: string, line: number, field: string, date: string) => void
    compose?: TaskComposeProps
    colorFor?: (task: PlacedTask) => string | undefined
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
                    compose={props.compose}
                    colorFor={props.colorFor}
                />
            )}
        </Show>
    )
}
