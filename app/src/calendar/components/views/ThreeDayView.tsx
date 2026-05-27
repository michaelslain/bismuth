import { currentDate, events, categories } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'
import { addDays } from '../../dates'

export function ThreeDayView(props: { store: EventStore }) {
  const dates = () => { const d = currentDate.value; return Array.from({ length: 3 }, (_, i) => addDays(d, i)) }
  return <TimeGrid dates={dates()} events={events.value} categories={categories.value} store={props.store} />
}
