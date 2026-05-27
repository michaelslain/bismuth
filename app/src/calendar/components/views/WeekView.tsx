import { currentDate, events, categories, settings } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { addDays } from '../../dates'

export function WeekView(props: { store: EventStore }) {
  const dates = () => {
    const d = currentDate.value
    const startOffset = settings.value.weekStartsOnMonday ? -((d.getDay() + 6) % 7) : -d.getDay()
    const startOfWeek = addDays(d, startOffset)
    return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i))
  }
  return <TimeGrid dates={dates()} events={events.value} categories={categories.value} store={props.store} />
}
