import { Show } from 'solid-js'
import { useCalendarNav, events, categories } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import type { TaskViewProps } from './MonthView'
import { addDays } from '../../dates'

export function ThreeDayView(props: { store: EventStore } & TaskViewProps) {
    const nav = useCalendarNav()
    const dates = () => {
        const d = nav.date.value
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
                    {...props}
                    placed={placed()}
                />
            )}
        </Show>
    )
}
