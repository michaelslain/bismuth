import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { CalendarEvent, RecurrenceType } from '../types'
import { categories, showEventModal, recurrenceAction, events } from '../state'
import { EventStore } from '../EventStore'
import { toDateStr } from '../dates'
import { refreshEvents } from '../refresh'
import { Modal } from '../../ui/Modal'
import { Field } from '../../ui/Field'
import { TextButton } from '../../ui/TextButton'

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
  const [date, setDate] = createSignal(defaultDate)
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
      ...(recType() ? { recurrence: { type: recType() as RecurrenceType, ...(recType() === 'weekly' || recType() === 'biweekly' ? { daysOfWeek: recDays().length ? recDays() : undefined } : {}), startDate: recStart() || date(), endDate: recEnd() || undefined, seriesId: editing?.recurrence?.seriesId ?? uuid() } } : {}),
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
    // Escape-to-close is handled by <Modal>; this keeps the calendar-specific
    // Enter-to-submit / Backspace-to-delete shortcuts.
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
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
    <Modal onClose={() => (showEventModal.value = null)} class="event-modal">
      <h3>{editing ? 'Edit Event' : 'New Event'}</h3>
      <Field label="Title"><input value={title()} onInput={e => setTitle(e.currentTarget.value)} /></Field>
      <Field label="Date"><input type="date" value={date()} onInput={e => setDate(e.currentTarget.value)} /></Field>
      <label><input type="checkbox" checked={allDay()} onChange={e => setAllDay(e.currentTarget.checked)} /> All day</label>
      <Show when={!allDay()}>
        <Field label="Start"><input type="time" value={startTime()} onInput={e => setStartTime(e.currentTarget.value)} /></Field>
        <Field label="End"><input type="time" value={endTime()} onInput={e => setEndTime(e.currentTarget.value)} /></Field>
      </Show>
      <Field label="Location"><input value={location()} onInput={e => setLocation(e.currentTarget.value)} /></Field>
      <Field label="Link"><input value={link()} onInput={e => setLink(e.currentTarget.value)} /></Field>
      <Field label="Description"><textarea value={description()} onInput={e => setDescription(e.currentTarget.value)} /></Field>
      <Field label="Category">
        <select value={category()} onChange={e => setCategory(e.currentTarget.value)}>
          <option value="">None</option>
          <For each={categories.value}>{c => <option value={c.name}>{c.name}</option>}</For>
        </select>
      </Field>
      <Field label="Recurrence">
        <select value={recType()} onChange={e => setRecType(e.currentTarget.value as RecurrenceType | '')}>
          <option value="">None</option>
          <For each={RECURRENCE_TYPES}>{t => <option value={t}>{t}</option>}</For>
        </select>
      </Field>
      <Show when={recType()}>
        <Show when={recType() === 'weekly' || recType() === 'biweekly'}>
          <div class="day-picker">
            <For each={DOW}>{([label, i]) => (
              <TextButton variant="plain" type="button" class={recDays().includes(i) ? 'active' : ''}
                onClick={() => setRecDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}>{label}</TextButton>
            )}</For>
          </div>
        </Show>
        <Field label="Start date"><input type="date" value={recStart()} onInput={e => setRecStart(e.currentTarget.value)} /></Field>
        <Field label="End date (optional)"><input type="date" value={recEnd()} onInput={e => setRecEnd(e.currentTarget.value)} /></Field>
      </Show>
      <div class="modal-actions">
        <Show when={editing}>
          <TextButton variant="plain" onClick={handleDelete} style={{ 'margin-right': 'auto', color: 'var(--text-error)' }}>Delete</TextButton>
        </Show>
        <TextButton variant="plain" onClick={handleSave}>Save</TextButton>
        <TextButton variant="plain" onClick={() => (showEventModal.value = null)}>Cancel</TextButton>
      </div>
    </Modal>
  )
}
