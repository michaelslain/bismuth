import { For, Index, createMemo } from 'solid-js'
import { CalendarEvent, Category } from '../../types'
import { EventChip } from '../EventChip'
import { toDateStr, formatGutterHour, formatTime } from '../../dates'
import { resolveCategoryColor } from '../../categoryColor'
import { showEventModal, dragState, settings, recurrenceAction } from '../../state'
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
  // Default to start+1h, clamped to 23:59 so a late start (e.g. 23:30) never
  // yields an earlier end (negative duration).
  const [eh, em] = (e.endTime || minutesToStr(Math.min(startMin + 60, 23 * 60 + 59))).split(':').map(Number)
  const endMin = eh * 60 + em
  return { startMin, endMin }
}

function yToMinutes(y: number, colHeight: number): number {
  return clamp(snap((y / colHeight) * 24 * 60))
}

/**
 * Lay out overlapping events side-by-side. Events that overlap in time are split into
 * vertical lanes (first-fit greedy), so two events in the same slot — e.g. an event and
 * its duplicate — render as distinct columns instead of stacked on top of each other.
 * Returns id → { lane, lanes } where `lanes` is the width of that event's overlap group.
 */
function computeLanes(items: { id: string; startMin: number; endMin: number }[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const out = new Map<string, { lane: number; lanes: number }>()
  let cluster: typeof sorted = []
  let clusterEnd = -Infinity
  const flush = (): void => {
    if (!cluster.length) return
    const laneEnds: number[] = [] // end minute of the last event placed in each lane
    const placed: Array<[string, number]> = []
    for (const it of cluster) {
      let lane = laneEnds.findIndex(end => end <= it.startMin)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMin) }
      else laneEnds[lane] = it.endMin
      placed.push([it.id, lane])
    }
    const lanes = laneEnds.length
    for (const [id, lane] of placed) out.set(id, { lane, lanes })
    cluster = []
    clusterEnd = -Infinity
  }
  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush() // no overlap with the open cluster
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  flush()
  return out
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

  /** The day column under a horizontal screen position (for dragging across days). */
  function columnAt(clientX: number): { ds: string; rect: DOMRect } | null {
    for (const ds of Object.keys(colRefs)) {
      const el = colRefs[ds]
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right) return { ds, rect }
    }
    return null
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
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    function onMouseMove(ev: MouseEvent): void {
      if (!dragging) {
        // Start once the pointer moves enough in EITHER axis (vertical = retime,
        // horizontal = move to another day).
        if (Math.abs(ev.clientY - startY) < 4 && Math.abs(ev.clientX - startX) < 4) return
        dragging = true
      }
      // Drop target follows the cursor across day columns; fall back to the original
      // column when the pointer is outside the grid. Read the time from the target
      // column so a cross-day drag lands at the right slot.
      const target = columnAt(ev.clientX) ?? { ds, rect }
      const cur = yToMinutes(ev.clientY - target.rect.top, target.rect.height)
      const newStart = clamp(snap(cur - offsetMinutes))
      dragState.value = { type: 'move', event, masterId, date: target.ds, startMinutes: newStart, currentMinutes: newStart + durationMinutes, offsetMinutes }
    }

    async function onMouseUp(): Promise<void> {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (!dragging) return
      const state = dragState.value
      // Clear the drag state FIRST, before the awaited persist below. If updateEvent /
      // refreshEvents throws, an end-of-function reset would be skipped and the dragged
      // event would stay stuck at 0.3 opacity (renders "faint") until the next interaction.
      dragState.value = null
      if (state?.type === 'move') {
        const newStart = state.startMinutes
        const newEnd = clamp(newStart + durationMinutes)
        // state.date is the column the event was dropped on — include it only when the
        // event actually changed days, so a same-day retime stays a pure time edit.
        const updates = { startTime: minutesToStr(newStart), endTime: minutesToStr(newEnd), ...(state.date !== ds ? { date: state.date } : {}) }
        if (state.masterId) {
          // Recurring: route through the recurrence dialog so the user picks the
          // scope (this/following/all). occurrenceDate is the ORIGINAL day (ds) so the
          // dialog edits the occurrence that was dragged, not the day it landed on.
          recurrenceAction.value = { type: 'edit', masterId: state.masterId, occurrenceDate: ds, updates }
        } else {
          await props.store.updateEvent(event.id, updates)
          await refreshEvents(props.store)
        }
      }
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
      color = resolveCategoryColor(props.categories.find(c => c.name === state.event.category)?.color)
    }

    if (endMin <= startMin) endMin = startMin + 15

    const top = (startMin / (24 * 60)) * GRID_PX
    const height = Math.max(((endMin - startMin) / (24 * 60)) * GRID_PX, 10)

    return (
      <div class="cal-drag-ghost" style={{ top: `${top}px`, height: `${height}px`, background: color }}>
        {formatTime(minutesToStr(startMin), settings.value.militaryTime)} — {formatTime(minutesToStr(endMin), settings.value.militaryTime)}
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
                    <span class="time-grid-day-date">{month}/<b class={ds === today ? 'cal-today-circle' : undefined}>{dayNum}</b></span>
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
              // Start minutes of every timed event in this column, kept reactive so
              // the per-event padding cap below tracks adds/moves/deletes.
              const dayStartMins = createMemo(() =>
                props.events.filter(e => e.date === ds && e.startTime).map(e => eventMinutes(e).startMin))
              // Side-by-side lanes for events that overlap in time (so a duplicate sits
              // next to its original instead of hidden behind it).
              const dayLanes = createMemo(() => computeLanes(
                props.events.filter(e => e.date === ds && e.startTime).map(e => {
                  const { startMin, endMin } = eventMinutes(e)
                  return { id: e.id, startMin, endMin }
                })))
              return (
                <div
                  class={`time-grid-day-col${ds === today ? ' today' : ''}`}
                  ref={el => (colRefs[ds] = el)}
                  onMouseDown={e => onColMouseDown(e, ds)}
                >
                  <Index each={HOURS}>{() => (
                    <div class="time-grid-hour-block"><div class="time-grid-hour-cell" /><div class="time-grid-half-cell" /></div>
                  )}</Index>
                  <For each={props.events.filter(e => e.date === ds && e.startTime)}>{e => {
                    const { startMin, endMin: evEndMin } = eventMinutes(e)
                    const top = (startMin / (24 * 60)) * GRID_PX
                    const duration = evEndMin - startMin
                    // Short events get +15min of visual height so the title stays
                    // readable, but cap it at the next event's start so the padding
                    // never spills into a back-to-back event below (e.g. 8:00–8:30
                    // followed by 8:30–10:00).
                    const nextStart = Math.min(...dayStartMins().filter(s => s > startMin), Infinity)
                    const visualDuration = duration <= 30
                      ? Math.min(duration + 15, Math.max(duration, nextStart - startMin))
                      : duration
                    const height = Math.max((visualDuration / (24 * 60)) * GRID_PX - 3, 8)
                    // Only genuinely tiny blocks (a back-to-back 30-min slot, ~34px) lay out
                    // on a single line; 1h+ blocks keep the stacked time-over-title layout so
                    // they use their vertical space. Long titles in the stacked layout
                    // ellipsize via the 2-line clamp in Calendar.css.
                    const compact = height < 42
                    const drag = dragState.value
                    const isBeingMoved = drag?.type === 'move' && drag.event.id === e.id
                    // Split the column into lanes when this event overlaps others.
                    const li = dayLanes().get(e.id)
                    const lanes = li?.lanes ?? 1
                    const lane = li?.lane ?? 0
                    const left = `calc(3px + (100% - 6px) * ${lane} / ${lanes})`
                    const width = lanes > 1 ? `calc((100% - 6px) / ${lanes} - 2px)` : 'calc(100% - 6px)'
                    return (
                      <div class="time-grid-event" style={{ top: `${top}px`, height: `${height}px`, left, width, opacity: isBeingMoved ? 0.3 : 1 }}
                        onMouseDown={ev => onChipMouseDown(ev, e, ds, e.recurrence ? e.id : undefined)}>
                        <EventChip event={e} compact={compact} masterId={e.recurrence ? e.id : undefined} occurrenceDate={e.recurrence ? ds : undefined} categories={props.categories} store={props.store} />
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
