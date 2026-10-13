import { EventStore } from './EventStore'
import { events, categories, settings, type CalendarNav } from './state'
import { addDays, weekRange } from './dates'
import { todayISO } from '../../../core/src/dates'

export async function refreshEvents(
    store: EventStore,
    nav: CalendarNav,
): Promise<void> {
    const d = nav.date.value
    const v = nav.view.value
    const mondayFirst = settings.value.weekStartsOnMonday
    let start: string, end: string
    if (v === 'month') {
        start = todayISO(new Date(d.getFullYear(), d.getMonth(), 1))
        end = todayISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))
    } else if (v === 'week') {
        ;[start, end] = weekRange(d, mondayFirst)
    } else if (v === '3day') {
        start = todayISO(d)
        end = todayISO(addDays(d, 2))
    } else {
        start = todayISO(d)
        end = todayISO(d)
    }
    events.value = store.getEventsForRange(start, end)
    categories.value = store.getCategories()
}
