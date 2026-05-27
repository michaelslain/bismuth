import { For, Index } from 'solid-js'
import { CalendarEvent, Category } from '../../types'
import { EventChip } from '../EventChip'
import { toDateStr, formatGutterHour, formatTime } from '../../dates'
import { showEventModal, dragState, categories as categoriesSignal, settings } from '../../state'
import { EventStore } from '../../EventStore'
import { refreshEvents } from '../../refresh'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const GRID_PX = 1200
const minutesToStr = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const snap = (m: number) => Math.round(m / 30) * 30
const clamp = (m: number) => Math.max(0, Math.min(23 * 60 + 45, m))
const yToMinutes = (y: number, colHeight: number) => clamp(snap((y / colHeight) * 24 * 60))

interface Props { dates: Date[]; events: CalendarEvent[]; categories: Category[]; store: EventStore }

export function TimeGrid(props: Props) {
  const today = toDateStr(new Date())
  const colRefs: Record<string, HTMLDivElement | undefined> = {}

  function getMinutesFromEvent(e: MouseEvent, ds: string): number {
    const col = colRefs[ds]; if (!col) return 0
    const rect = col.getBoundingClientRect()
    return yToMinutes(e.clientY - rect.top, rect.height)
  }

  function onColMouseDown(e: MouseEvent, ds: string) {
    if (e.button !== 0) return
    e.preventDefault()
    const minutes = getMinutesFromEvent(e, ds)
    dragState.value = { type: 'create', date: ds, startMinutes: minutes, currentMinutes: minutes }
    function onMouseMove(ev: MouseEvent) {
      const cur = getMinutesFromEvent(ev, ds)
      const s = dragState.value
      if (s?.type === 'create') dragState.value = { type: 'create', date: ds, startMinutes: s.startMinutes, currentMinutes: cur }
    }
    function onMouseUp() {
      const ds2 = dragState.value
      if (ds2?.type === 'create') {
        const start = Math.min(ds2.startMinutes, ds2.currentMinutes)
        const end = Math.max(ds2.startMinutes, ds2.currentMinutes)
        showEventModal.value = { date: ds2.date, startTime: minutesToStr(start), ...(end - start >= 15 ? { endTime: minutesToStr(end) } : {}) }
      }
      dragState.value = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function onChipMouseDown(e: MouseEvent, event: CalendarEvent, ds: string, masterId?: string) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    const col = colRefs[ds]; if (!col) return
    const rect = col.getBoundingClientRect()
    const [sh, sm] = (event.startTime ?? '00:00').split(':').map(Number)
    const eventStartMinutes = sh * 60 + sm
    const clickMinutes = yToMinutes(e.clientY - rect.top, rect.height)
    const offsetMinutes = clickMinutes - eventStartMinutes
    const [eh, em] = (event.endTime || `${Math.min(sh + 1, 23)}:00`).split(':').map(Number)
    const durationMinutes = (eh * 60 + em) - eventStartMinutes
    // Only begin a drag once the mouse actually moves past a small threshold.
    // A stationary click must NOT start a drag: it should fall through to
    // EventChip's onClick (which opens the modal). Committing an update on a
    // plain click would also replace the chip's DOM and swallow that click.
    const startY = e.clientY
    let dragging = false
    function onMouseMove(ev: MouseEvent) {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 4) return
        dragging = true
      }
      const cur = yToMinutes(ev.clientY - rect.top, rect.height)
      const newStart = clamp(snap(cur - offsetMinutes))
      dragState.value = { type: 'move', event, masterId, date: ds, startMinutes: newStart, currentMinutes: newStart + durationMinutes, offsetMinutes }
    }
    async function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (!dragging) return // it was a click, not a drag — let EventChip's onClick open the modal
      const ds2 = dragState.value
      if (ds2?.type === 'move') {
        const newStart = ds2.startMinutes
        const newEnd = clamp(newStart + durationMinutes)
        await props.store.updateEvent(event.id, { startTime: minutesToStr(newStart), endTime: minutesToStr(newEnd) })
        await refreshEvents(props.store)
      }
      dragState.value = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function ghost(ds: string) {
    const ds2 = dragState.value
    if (!ds2 || ds2.date !== ds) return null
    let startMin: number, endMin: number, color: string
    if (ds2.type === 'create') {
      startMin = Math.min(ds2.startMinutes, ds2.currentMinutes)
      endMin = Math.max(ds2.startMinutes, ds2.currentMinutes)
      color = 'var(--interactive-accent)'
    } else {
      startMin = ds2.startMinutes
      const [sh, sm] = (ds2.event.startTime ?? '00:00').split(':').map(Number)
      const [eh, em] = (ds2.event.endTime || `${Math.min(sh + 1, 23)}:00`).split(':').map(Number)
      const duration = (eh * 60 + em) - (sh * 60 + sm)
      endMin = clamp(startMin + duration)
      color = categoriesSignal.value.find(c => c.name === ds2.event.category)?.color ?? 'var(--interactive-accent)'
    }
    if (endMin <= startMin) endMin = startMin + 15
    const top = (startMin / (24 * 60)) * GRID_PX
    const height = Math.max(((endMin - startMin) / (24 * 60)) * GRID_PX, 10)
    return (
      <div class="drag-ghost" style={{ top: `${top}px`, height: `${height}px`, background: color }}>
        {formatTime(minutesToStr(startMin), settings.value.militaryTime)} – {formatTime(minutesToStr(endMin), settings.value.militaryTime)}
      </div>
    )
  }

  return (
    <div class="time-grid">
      <div class="time-grid-body">
        <div class="time-grid-columns">
          <div class="time-grid-sticky-top">
            <div class="time-grid-sticky-header">
              <div class="time-gutter" />
              <For each={props.dates}>{d => {
                const ds = toDateStr(d)
                const label = d.toLocaleString('default', { weekday: 'short', month: 'numeric', day: 'numeric' })
                return <div class={`time-grid-day-header${ds === today ? ' today' : ''}`}>{label}</div>
              }}</For>
            </div>
            <div class="time-grid-allday-row">
              <div class="time-gutter" />
              <For each={props.dates}>{d => {
                const ds = toDateStr(d)
                return (
                  <div class="time-grid-allday-cell">
                    <For each={props.events.filter(e => e.date === ds && !e.startTime)}>{e => (
                      <EventChip event={e} masterId={e.recurrence ? e.id : undefined} occurrenceDate={e.recurrence ? ds : undefined} categories={props.categories} store={props.store} />
                    )}</For>
                  </div>
                )
              }}</For>
            </div>
          </div>
          <div class="time-grid-time-rows">
            <div class="time-gutter-col">
              <Index each={HOURS}>{h => (
                <div class="time-gutter-hour-block">
                  <div class="time-gutter-hour">{formatGutterHour(h(), settings.value.militaryTime)}</div>
                  <div class="time-gutter-half" />
                </div>
              )}</Index>
            </div>
            <For each={props.dates}>{d => {
              const ds = toDateStr(d)
              return (
                <div
                  class={`time-grid-day-col${ds === today ? ' today' : ''}`}
                  ref={el => (colRefs[ds] = el)}
                  onMouseDown={e => onColMouseDown(e, ds)}
                  style={{ 'user-select': 'none' }}
                >
                  <Index each={HOURS}>{() => (
                    <div class="time-grid-hour-block"><div class="time-grid-hour-cell" /><div class="time-grid-half-cell" /></div>
                  )}</Index>
                  <For each={props.events.filter(e => e.date === ds && e.startTime)}>{e => {
                    const [sh, sm] = (e.startTime ?? '00:00').split(':').map(Number)
                    const [eh, em] = (e.endTime || `${Math.min(sh + 1, 23)}:00`).split(':').map(Number)
                    const top = ((sh * 60 + sm) / (24 * 60)) * GRID_PX
                    const duration = eh * 60 + em - (sh * 60 + sm)
                    const visualDuration = duration <= 30 ? duration + 15 : duration
                    const height = Math.max((visualDuration / (24 * 60)) * GRID_PX - 3, 8)
                    const drag = dragState.value
                    const isBeingMoved = drag?.type === 'move' && drag.event.id === e.id
                    return (
                      <div class="time-grid-event" style={{ top: `${top}px`, height: `${height}px`, opacity: isBeingMoved ? 0.3 : 1 }}
                        onMouseDown={ev => onChipMouseDown(ev, e, ds, e.recurrence ? e.id : undefined)}>
                        <EventChip event={e} masterId={e.recurrence ? e.id : undefined} occurrenceDate={e.recurrence ? ds : undefined} categories={props.categories} store={props.store} />
                      </div>
                    )
                  }}</For>
                  {ghost(ds)}
                </div>
              )
            }}</For>
          </div>
        </div>
      </div>
    </div>
  )
}
