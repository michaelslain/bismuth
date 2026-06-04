import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { CalendarEvent, RecurrenceType } from '../types'
import { categories, showEventModal, recurrenceAction, events } from '../state'
import { EventStore } from '../EventStore'
import { toDateStr } from '../dates'
import { refreshEvents } from '../refresh'
import { Modal } from '../../ui/Modal'
import { Field } from '../../ui/Field'
import { TextButton } from '../../ui/TextButton'
import { TextInput } from '../../ui/TextInput'
import { Select } from '../../ui/Select'

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
      <Field label="Title"><TextInput value={title()} onInput={setTitle} /></Field>
      <Field label="Date"><TextInput type="date" value={date()} onInput={setDate} /></Field>
      <label class="event-modal-check"><input type="checkbox" checked={allDay()} onChange={e => setAllDay(e.currentTarget.checked)} /> All day</label>
      <Show when={!allDay()}>
        <div class="event-modal-row">
          <Field label="Start"><TextInput type="time" value={startTime()} onInput={setStartTime} /></Field>
          <Field label="End"><TextInput type="time" value={endTime()} onInput={setEndTime} /></Field>
        </div>
      </Show>
      <Field label="Location"><TextInput value={location()} onInput={setLocation} /></Field>
      <Field label="Link"><TextInput value={link()} onInput={setLink} /></Field>
      <Field label="Description"><TextInput multiline value={description()} onInput={setDescription} /></Field>
      <Field label="Category">
        <Select
          value={category()}
          onChange={setCategory}
          placeholder="None"
          options={[{ value: '', label: 'None' }, ...categories.value.map(c => ({ value: c.name, label: c.name }))]}
        />
      </Field>
      <Field label="Recurrence">
        <Select
          value={recType()}
          onChange={v => setRecType(v as RecurrenceType | '')}
          placeholder="None"
          options={[{ value: '', label: 'None' }, ...RECURRENCE_TYPES.map(t => ({ value: t, label: t }))]}
        />
      </Field>
      <Show when={recType()}>
        <Show when={recType() === 'weekly' || recType() === 'biweekly'}>
          <div class="day-picker">
            <For each={DOW}>{([label, i]) => (
              <TextButton size="sm" variant={recDays().includes(i) ? 'selected' : 'unselected'} type="button"
                onClick={() => setRecDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}>{(label as string).toUpperCase()}</TextButton>
            )}</For>
          </div>
        </Show>
        <Field label="Start date"><TextInput type="date" value={recStart()} onInput={setRecStart} /></Field>
        <Field label="End date (optional)"><TextInput type="date" value={recEnd()} onInput={setRecEnd} /></Field>
      </Show>
      <div class="modal-actions">
        <Show when={editing}>
          <TextButton size="sm" danger onClick={handleDelete} style={{ 'margin-right': 'auto' }}>DELETE</TextButton>
        </Show>
        <TextButton size="sm" onClick={() => (showEventModal.value = null)}>CANCEL</TextButton>
        <TextButton size="sm" variant="selected" onClick={handleSave}>SAVE</TextButton>
      </div>
    </Modal>
  )
}
