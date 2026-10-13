import { Show } from 'solid-js'
import { useCalendarNav, events, categories } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import type { TaskViewProps } from './MonthView'

export function DayView(props: { store: EventStore } & TaskViewProps) {
    const nav = useCalendarNav()
    return (
        <Show
            when={props.placed}
            fallback={
                <TimeGrid
                    dates={[nav.date.value]}
                    events={events.value}
                    categories={categories.value}
                    store={props.store}
                />
            }
        >
            {placed => (
                <TaskAllDayStrip
                    dates={[nav.date.value]}
                    {...props}
                    placed={placed()}
                />
            )}
        </Show>
    )
}
