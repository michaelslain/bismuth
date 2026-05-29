import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { CalendarEvent, RecurrenceType } from '../types'
import { categories, showEventModal, recurrenceAction, events } from '../state'
import { EventStore } from '../EventStore'
import { toDateStr } from '../dates'
import { refreshEvents } from '../refresh'

const uuid = () => crypto.randomUUID()
const RECURRENCE_TYPES: RecurrenceType[] = ['daily', 'weekly', 'biweekly', 'monthly']
const DOW: [string, number][] = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]]

export function EventModal(props: { store: EventStore }) {
  const modal = showEventModal.value
  if (!modal) return null
  const editing = modal.event

  const defaultDate = editing?.date ?? modal.date ?? toDateStr(new Date())

  function getDefaultDaysOfWeek(): number[] {
    const [y, m, d] = defaultDate.split('-').map(Number)
    return [new Date(y, m - 1, d).getDay()]
  }

  const [title, setTitle] = createSignal(editing?.title ?? '')
  const [date, setDate] = createSignal(editing?.date ?? modal.date ?? toDateStr(new Date()))
  const [startTime, setStartTime] = createSignal(editing?.startTime ?? modal.startTime ?? '')
  const [endTime, setEndTime] = createSignal(editing?.endTime ?? modal.endTime ?? '')
  const [allDay, setAllDay] = createSignal(!editing?.startTime && !modal.startTime)
  const [location, setLocation] = createSignal(editing?.location ?? '')
  const [link, setLink] = createSignal(editing?.link ?? '')
  const [description, setDescription] = createSignal(editing?.description ?? '')
  const [category, setCategory] = createSignal(editing?.category ?? '')
  const [recType, setRecType] = createSignal<RecurrenceType | ''>(editing?.recurrence?.type ?? '')
  const [recDays, setRecDays] = createSignal<number[]>(editing?.recurrence?.daysOfWeek ?? getDefaultDaysOfWeek())
  const [recStart, setRecStart] = createSignal(editing?.recurrence?.startDate ?? defaultDate)
  const [recEnd, setRecEnd] = createSignal(editing?.recurrence?.endDate ?? '')

  async function handleDelete(): Promise<void> {
    if (!editing) return

    if (editing.recurrence && modal!.masterId && modal!.occurrenceDate) {
      recurrenceAction.value = { type: 'delete', masterId: modal!.masterId, occurrenceDate: modal!.occurrenceDate }
      showEventModal.value = null
    } else {
      await props.store.deleteEvent(editing.id)
      events.value = events.value.filter(e => e.id !== editing.id)
      showEventModal.value = null
    }
  }

  async function handleSave(): Promise<void> {
    const eventData: Omit<CalendarEvent, 'id'> = {
      title: title(),
      date: date(),
      ...(allDay() || !startTime() ? {} : { startTime: startTime(), ...(endTime() ? { endTime: endTime() } : {}) }),
      ...(location() ? { location: location() } : {}),
      ...(link() ? { link: link() } : {}),
      ...(description() ? { description: description() } : {}),
      ...(category() ? { category: category() } : {}),
      ...(recType() ? { recurrence: { type: recType() as RecurrenceType, daysOfWeek: recDays().length ? recDays() : undefined, startDate: recStart() || date(), endDate: recEnd() || undefined, seriesId: editing?.recurrence?.seriesId ?? uuid() } } : {}),
    }

    if (editing && editing.recurrence && modal!.masterId && modal!.occurrenceDate) {
      recurrenceAction.value = { type: 'edit', masterId: modal!.masterId, occurrenceDate: modal!.occurrenceDate, updates: eventData }
      showEventModal.value = null
      return
    }

    if (editing) {
      await props.store.updateEvent(editing.id, eventData)
    } else {
      await props.store.addEvent(eventData)
    }

    await refreshEvents(props.store)
    showEventModal.value = null
  }

  onMount(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 'Escape') {
        showEventModal.value = null
      } else if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        handleSave()
      } else if (e.key === 'Backspace' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        handleDelete()
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  return (
    <div class="modal-overlay" onClick={() => (showEventModal.value = null)}>
      <div class="event-modal" onClick={e => e.stopPropagation()}>
        <h3>{editing ? 'Edit Event' : 'New Event'}</h3>
        <label>Title<input value={title()} onInput={e => setTitle(e.currentTarget.value)} /></label>
        <label>Date<input type="date" value={date()} onInput={e => setDate(e.currentTarget.value)} /></label>
        <label><input type="checkbox" checked={allDay()} onChange={e => setAllDay(e.currentTarget.checked)} /> All day</label>
        <Show when={!allDay()}>
          <label>Start<input type="time" value={startTime()} onInput={e => setStartTime(e.currentTarget.value)} /></label>
          <label>End<input type="time" value={endTime()} onInput={e => setEndTime(e.currentTarget.value)} /></label>
        </Show>
        <label>Location<input value={location()} onInput={e => setLocation(e.currentTarget.value)} /></label>
        <label>Link<input value={link()} onInput={e => setLink(e.currentTarget.value)} /></label>
        <label>Description<textarea value={description()} onInput={e => setDescription(e.currentTarget.value)} /></label>
        <label>Category
          <select value={category()} onChange={e => setCategory(e.currentTarget.value)}>
            <option value="">None</option>
            <For each={categories.value}>{c => <option value={c.name}>{c.name}</option>}</For>
          </select>
        </label>
        <label>Recurrence
          <select value={recType()} onChange={e => setRecType(e.currentTarget.value as RecurrenceType | '')}>
            <option value="">None</option>
            <For each={RECURRENCE_TYPES}>{t => <option value={t}>{t}</option>}</For>
          </select>
        </label>
        <Show when={recType()}>
          <Show when={recType() === 'weekly' || recType() === 'biweekly'}>
            <div class="day-picker">
              <For each={DOW}>{([label, i]) => (
                <button type="button" class={recDays().includes(i) ? 'active' : ''}
                  onClick={() => setRecDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}>{label}</button>
              )}</For>
            </div>
          </Show>
          <label>Start date<input type="date" value={recStart()} onInput={e => setRecStart(e.currentTarget.value)} /></label>
          <label>End date (optional)<input type="date" value={recEnd()} onInput={e => setRecEnd(e.currentTarget.value)} /></label>
        </Show>
        <div class="modal-actions">
          <Show when={editing}>
            <button onClick={handleDelete} style={{ 'margin-right': 'auto', color: 'var(--text-error)' }}>Delete</button>
          </Show>
          <button onClick={handleSave}>Save</button>
          <button onClick={() => (showEventModal.value = null)}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
