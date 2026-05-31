import { currentDate, events, categories, settings } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { addDays, startOfWeek } from '../../dates'

export function WeekView(props: { store: EventStore }) {
  const dates = () => {
    const d = currentDate.value
    const weekStart = startOfWeek(d, settings.value.weekStartsOnMonday)
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }
  return <TimeGrid dates={dates()} events={events.value} categories={categories.value} store={props.store} />
}
