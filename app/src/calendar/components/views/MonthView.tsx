import { For, Index, Show } from 'solid-js'
import { currentDate, events, categories, showEventModal, settings } from '../../state'
import { EventStore } from '../../EventStore'
import { EventChip } from '../EventChip'
import { toDateStr } from '../../dates'

const DAYS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function MonthView(props: { store: EventStore }) {
  const year = () => currentDate.value.getFullYear()
  const month = () => currentDate.value.getMonth()
  const mondayFirst = () => settings.value.weekStartsOnMonday
  const dayNames = () => (mondayFirst() ? DAYS_MON : DAYS_SUN)
  const today = toDateStr(new Date())

  const cells = () => {
    const rawFirstDay = new Date(year(), month(), 1).getDay()
    const firstDay = mondayFirst() ? (rawFirstDay + 6) % 7 : rawFirstDay
    const daysInMonth = new Date(year(), month() + 1, 0).getDate()
    const c: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
    while (c.length % 7 !== 0) c.push(null)
    return c
  }

  return (
    <div class="month-view">
      <div class="month-grid-header">
        <For each={dayNames()}>{d => <div class="month-day-name">{d}</div>}</For>
      </div>
      <div class="month-grid">
        <Index each={cells()}>{cell => (
          <Show when={cell() !== null} fallback={<div class="month-cell empty" />}>
            {(() => {
              const day = cell() as number
              const dateStr = `${year()}-${String(month() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const dayEvents = () => events.value.filter(e => e.date === dateStr)
              return (
                <div class={`month-cell${dateStr === today ? ' today' : ''}`} onClick={() => (showEventModal.value = { date: dateStr })}>
                  <div class="month-cell-number">{day}</div>
                  <div class="month-cell-events">
                    <For each={dayEvents()}>{e => (
                      <EventChip event={e} masterId={e.recurrence ? e.id : undefined} occurrenceDate={e.recurrence ? dateStr : undefined} categories={categories.value} store={props.store} />
                    )}</For>
                  </div>
                </div>
              )
            })()}
          </Show>
        )}</Index>
      </div>
    </div>
  )
}
