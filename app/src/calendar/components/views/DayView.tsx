import { currentDate, events, categories } from '../../state'
import { EventStore } from '../../EventStore'
import { TimeGrid } from './TimeGrid'

export function DayView(props: { store: EventStore }) {
  return <TimeGrid dates={[currentDate.value]} events={events.value} categories={categories.value} store={props.store} />
}
