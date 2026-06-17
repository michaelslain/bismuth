import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { CalendarEvent, RecurrenceType } from '../types'
import { categories, showEventModal, recurrenceAction, events } from '../state'
import { EventStore, uuid } from '../EventStore'
import { toDateStr, prettyDate } from '../dates'
import { refreshEvents } from '../refresh'
import { resolveCategoryColor } from '../categoryColor'
import { Modal } from '../../ui/Modal'
import { Icon } from '../../icons/Icon'
import { TextInput } from '../../ui/TextInput'
import { TextButton } from '../../ui/TextButton'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
import { MarkdownField } from '../../ui/MarkdownField'

// Segmented repeat control: label shown to the user → stored RecurrenceType ('' = none).
const RECUR: [string, RecurrenceType | ''][] = [
  ['None', ''], ['Daily', 'daily'], ['Weekly', 'weekly'], ['Biweekly', 'biweekly'], ['Monthly', 'monthly'],
]
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
  const [recStart] = createSignal(editing?.recurrence?.startDate ?? defaultDate)
  const [recEnd, setRecEnd] = createSignal(editing?.recurrence?.endDate ?? '')

  const close = () => (showEventModal.value = null)

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

  // Build a fresh CalendarEvent payload from the current form state. `freshSeries`
  // forces a new recurrence seriesId — used when duplicating so the copy is its own
  // independent series instead of sharing the original's.
  function buildEventData(freshSeries = false): Omit<CalendarEvent, 'id'> {
    return {
      title: title(),
      date: date(),
      ...(allDay() || !startTime() ? {} : { startTime: startTime(), ...(endTime() ? { endTime: endTime() } : {}) }),
      ...(location() ? { location: location() } : {}),
      ...(link() ? { link: link() } : {}),
      ...(description() ? { description: description() } : {}),
      ...(category() ? { category: category() } : {}),
      ...(recType() ? { recurrence: { type: recType() as RecurrenceType, ...(recType() === 'weekly' || recType() === 'biweekly' ? { daysOfWeek: recDays().length ? recDays() : undefined } : {}), startDate: recStart() || date(), endDate: recEnd() || undefined, seriesId: freshSeries ? uuid() : (editing?.recurrence?.seriesId ?? uuid()) } } : {}),
    }
  }

  // Duplicate: create a NEW event from the current form values (a fresh id + series),
  // leaving the original untouched. Available only when editing an existing event.
  async function handleDuplicate(): Promise<void> {
    await props.store.addEvent(buildEventData(true))
    await refreshEvents(props.store)
    showEventModal.value = null
  }

  async function handleSave(): Promise<void> {
    const eventData = buildEventData()

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
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      // The description editor is CodeMirror, whose editable surface is a contenteditable <div>
      // (tagName 'DIV') — the tag checks below wouldn't spare it, so exclude it explicitly.
      // Otherwise Enter would save and Backspace would delete the event mid-typing.
      const inEditor = !!el?.closest?.('.cm-editor')
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !inEditor) {
        e.preventDefault()
        handleSave()
      } else if (e.key === 'Backspace' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !inEditor) {
        e.preventDefault()
        handleDelete()
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  return (
    <Modal onClose={close} class="event-modal evm-modal">
      <div class="evm-head">
        <div class="evm-mark"><Icon value="calendar-plus" size={18} /></div>
        <div class="evm-htext">
          <div class="evm-title">{editing ? 'Edit Event' : 'New Event'}</div>
          <div class="evm-sub">{prettyDate(date())}</div>
        </div>
        <button type="button" class="evm-x" aria-label="Close" onClick={close}><Icon value="x" size={16} /></button>
      </div>

      <div class="evm-body">
        {/* title */}
        <div class="evm-titlefield">
          <input class="evm-titlein" type="text" placeholder="Untitled event" autofocus
            value={title()} onInput={e => setTitle(e.currentTarget.value)} />
        </div>

        {/* date + all-day */}
        <div class="evm-field">
          <div class="evm-daterow">
            <div>
              <div class="evm-lab"><Icon value="calendar" size={12} strokeWidth={2} />Date</div>
              <TextInput type="date" value={date()} onInput={setDate} />
            </div>
            <div>
              <div class="evm-lab evm-lab-spacer">x</div>
              <div class="evm-allday" role="button" onClick={() => setAllDay(v => !v)}>
                <span class={'evm-toggle' + (allDay() ? ' on' : '')}><i /></span>
                All day
              </div>
            </div>
          </div>
          <Show when={!allDay()}>
            <div class="evm-times">
              <TextInput type="time" value={startTime()} onInput={setStartTime} />
              <span class="dash">→</span>
              <TextInput type="time" value={endTime()} onInput={setEndTime} />
            </div>
          </Show>
        </div>

        {/* location + link */}
        <div class="evm-grid">
          <div class="evm-field">
            <div class="evm-lab"><Icon value="map-pin" size={12} strokeWidth={2} />Location</div>
            <TextInput placeholder="Add a place" value={location()} onInput={setLocation} />
          </div>
          <div class="evm-field">
            <div class="evm-lab"><Icon value="link" size={12} strokeWidth={2} />Link</div>
            <TextInput placeholder="meet.example.com/…" value={link()} onInput={setLink} />
          </div>
        </div>

        {/* description — live-preview markdown, editable exactly like the note editor */}
        <div class="evm-field">
          <div class="evm-lab"><Icon value="text-align-start" size={12} strokeWidth={2} />Description <span class="opt">· markdown</span></div>
          <MarkdownField class="evm-mdedit"
            value={description()}
            onInput={setDescription}
            placeholder="Notes, agenda, links to vault… (markdown)" />
        </div>

        {/* category */}
        <div class="evm-field">
          <div class="evm-lab"><Icon value="tag" size={12} strokeWidth={2} />Category</div>
          <div class="evm-cats">
            <div class={'evm-cat' + (category() === '' ? ' on' : '')} role="button"
              style={{ '--cc': 'var(--faint)' }} onClick={() => setCategory('')}>
              <span class="dot" />None
            </div>
            <For each={categories.value}>{c => (
              <div class={'evm-cat' + (category() === c.name ? ' on' : '')} role="button"
                style={{ '--cc': resolveCategoryColor(c.color) }} onClick={() => setCategory(c.name)}>
                <span class="dot" />{c.name}
              </div>
            )}</For>
          </div>
        </div>

        {/* recurrence */}
        <div class="evm-field">
          <div class="evm-lab"><Icon value="repeat" size={12} strokeWidth={2} />Repeat</div>
          <SegmentedToggle
            value={recType()}
            onChange={v => setRecType(v)}
            size="sm"
            options={RECUR.map(([label, val]) => ({ id: val, label }))}
          />
          <Show when={recType() === 'weekly' || recType() === 'biweekly'}>
            <div class="evm-dows">
              <For each={DOW}>{([label, i]) => (
                <div class={'evm-dow' + (recDays().includes(i) ? ' on' : '')} role="button"
                  onClick={() => setRecDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}>{label}</div>
              )}</For>
            </div>
          </Show>
          <Show when={recType()}>
            <div class="evm-ends">
              <div class="evm-lab"><Icon value="calendar-x" size={12} strokeWidth={2} />Ends <span class="opt">· optional</span></div>
              <TextInput type="date" value={recEnd()} onInput={setRecEnd} />
            </div>
          </Show>
        </div>
      </div>

      <div class="evm-foot">
        <Show when={editing}>
          <TextButton size="sm" danger onClick={handleDelete}>DELETE</TextButton>
          <TextButton size="sm" onClick={handleDuplicate}>DUPLICATE</TextButton>
        </Show>
        <div class="sp" />
        <TextButton size="sm" onClick={close}>CANCEL</TextButton>
        <TextButton size="sm" variant="selected" onClick={handleSave}>{editing ? 'SAVE' : 'CREATE EVENT'}</TextButton>
      </div>
    </Modal>
  )
}
