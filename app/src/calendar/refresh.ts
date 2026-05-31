import { EventStore } from './EventStore'
import { events, categories, currentView, currentDate, settings } from './state'
import { toDateStr, addDays, weekRange } from './dates'

export async function refreshEvents(store: EventStore): Promise<void> {
  const d = currentDate.value
  const v = currentView.value
  const mondayFirst = settings.value.weekStartsOnMonday
  let start: string, end: string
  if (v === 'month') {
    start = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
    end = toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  } else if (v === 'week') {
    ;[start, end] = weekRange(d, mondayFirst)
  } else if (v === '3day') {
    start = toDateStr(d); end = toDateStr(addDays(d, 2))
  } else {
    start = toDateStr(d); end = toDateStr(d)
  }
  events.value = store.getEventsForRange(start, end)
  categories.value = store.getCategories()
}
