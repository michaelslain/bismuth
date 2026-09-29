import { Show } from 'solid-js'
import { currentDate, events, categories } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import type { TaskViewProps } from './MonthView'

export function DayView(props: { store: EventStore } & TaskViewProps) {
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
                    {...props}
                    placed={placed()}
                />
            )}
        </Show>
    )
}
