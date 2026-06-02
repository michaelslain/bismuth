import { For, Index } from 'solid-js'
import { CalendarEvent, Category } from '../../types'
import { EventChip } from '../EventChip'
import { toDateStr, formatGutterHour, formatTime } from '../../dates'
import { showEventModal, dragState, settings } from '../../state'
import { EventStore } from '../../EventStore'
import { refreshEvents } from '../../refresh'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const GRID_PX = 1200
const MAX_MINUTES = 23 * 60 + 45
const SNAP_INTERVAL = 30

function minutesToStr(m: number): string {
  const hours = String(Math.floor(m / 60)).padStart(2, '0')
  const minutes = String(m % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}

function snap(m: number): number {
  return Math.round(m / SNAP_INTERVAL) * SNAP_INTERVAL
}

function clamp(m: number): number {
  return Math.max(0, Math.min(MAX_MINUTES, m))
}

function eventMinutes(e: { startTime?: string; endTime?: string }): { startMin: number; endMin: number } {
  const [sh, sm] = (e.startTime ?? '00:00').split(':').map(Number)
  const startMin = sh * 60 + sm
  const [eh, em] = (e.endTime || `${Math.min(sh + 1, 23)}:00`).split(':').map(Number)
  const endMin = eh * 60 + em
  return { startMin, endMin }
}

function yToMinutes(y: number, colHeight: number): number {
  return clamp(snap((y / colHeight) * 24 * 60))
}

interface Props { dates: Date[]; events: CalendarEvent[]; categories: Category[]; store: EventStore }

export function TimeGrid(props: Props) {
  const today = toDateStr(new Date())
  const colRefs: Record<string, HTMLDivElement | undefined> = {}

  function getMinutesFromEvent(e: MouseEvent, ds: string): number {
    const col = colRefs[ds]
    if (!col) return 0
    const rect = col.getBoundingClientRect()
    return yToMinutes(e.clientY - rect.top, rect.height)
  }

  function onColMouseDown(e: MouseEvent, ds: string): void {
    if (e.button !== 0) return
    e.preventDefault()
    const minutes = getMinutesFromEvent(e, ds)
    dragState.value = { type: 'create', date: ds, startMinutes: minutes, currentMinutes: minutes }

    function onMouseMove(ev: MouseEvent): void {
      const cur = getMinutesFromEvent(ev, ds)
      const state = dragState.value
      if (state?.type === 'create') {
        dragState.value = { type: 'create', date: ds, startMinutes: state.startMinutes, currentMinutes: cur }
      }
    }

    function onMouseUp(): void {
      const state = dragState.value
      if (state?.type === 'create') {
        const start = Math.min(state.startMinutes, state.currentMinutes)
        const end = Math.max(state.startMinutes, state.currentMinutes)
        const duration = end - start
        showEventModal.value = {
          date: state.date,
          startTime: minutesToStr(start),
          ...(duration >= 15 ? { endTime: minutesToStr(end) } : {}),
        }
      }
      dragState.value = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function onChipMouseDown(e: MouseEvent, event: CalendarEvent, ds: string, masterId?: string): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const col = colRefs[ds]
    if (!col) return

    const rect = col.getBoundingClientRect()
    const { startMin: eventStartMinutes, endMin: eventEndMinutes } = eventMinutes(event)
    const clickMinutes = yToMinutes(e.clientY - rect.top, rect.height)
    const offsetMinutes = clickMinutes - eventStartMinutes
    const durationMinutes = eventEndMinutes - eventStartMinutes
    const startY = e.clientY
    let dragging = false

    function onMouseMove(ev: MouseEvent): void {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 4) return
        dragging = true
      }
      const cur = yToMinutes(ev.clientY - rect.top, rect.height)
      const newStart = clamp(snap(cur - offsetMinutes))
      dragState.value = { type: 'move', event, masterId, date: ds, startMinutes: newStart, currentMinutes: newStart + durationMinutes, offsetMinutes }
    }

    async function onMouseUp(): Promise<void> {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (!dragging) return
      const state = dragState.value
      if (state?.type === 'move') {
        const newStart = state.startMinutes
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
    const state = dragState.value
    if (!state || state.date !== ds) return null

    let startMin: number
    let endMin: number
    let color: string

    if (state.type === 'create') {
      startMin = Math.min(state.startMinutes, state.currentMinutes)
      endMin = Math.max(state.startMinutes, state.currentMinutes)
      color = 'var(--interactive-accent)'
    } else {
      startMin = state.startMinutes
      const { startMin: evStart, endMin: evEnd } = eventMinutes(state.event)
      const duration = evEnd - evStart
      endMin = clamp(startMin + duration)
      color = props.categories.find(c => c.name === state.event.category)?.color ?? 'var(--interactive-accent)'
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
                const weekday = d.toLocaleString('default', { weekday: 'short' })
                const month = d.toLocaleString('default', { month: 'numeric' })
                const dayNum = d.getDate()
                return (
                  <div class={`time-grid-day-header${ds === today ? ' today' : ''}`}>
                    <span class="time-grid-day-weekday">{weekday}</span>{' '}
                    <span class="time-grid-day-date">{month}/<b>{dayNum}</b></span>
                  </div>
                )
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
                    const { startMin, endMin: evEndMin } = eventMinutes(e)
                    const top = (startMin / (24 * 60)) * GRID_PX
                    const duration = evEndMin - startMin
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
