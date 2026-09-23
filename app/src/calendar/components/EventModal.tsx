import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { CalendarEvent, RecurrenceType } from '../types'
import { categories, showEventModal, recurrenceAction, events } from '../state'
import { EventStore, uuid } from '../EventStore'
import { toDateStr, prettyDate } from '../dates'
import { refreshEvents } from '../refresh'
import { resolveCategoryColor, eventCategoryNames } from '../categoryColor'
import FormModal from '../../ui/FormModal'
import ModalBody from '../../ui/ModalBody'
import BracketToggle from '../../ui/BracketToggle'
import { TextInput } from '../../ui/TextInput'
import { TextButton } from '../../ui/TextButton'
import PlainButton from '../../ui/PlainButton'
import StatusDot from '../../ui/StatusDot'
import Text from '../../ui/Text'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
import MarkdownField from '../../ui/MarkdownField'
import ModalHeader from '../../ui/ModalHeader'
import ModalFooter from '../../ui/ModalFooter'
import SettingsGrid from '../../ui/SettingsGrid'
import SettingsField from '../../ui/SettingsField'
import styles from './EventModal.module.css'

// Segmented repeat control: label shown to the user → stored RecurrenceType ('' = none).
const RECUR: [string, RecurrenceType | ''][] = [
    ['none', ''],
    ['daily', 'daily'],
    ['weekly', 'weekly'],
    ['biweekly', 'biweekly'],
    ['monthly', 'monthly'],
]
const DOW: [string, number][] = [
    ['mon', 1],
    ['tue', 2],
    ['wed', 3],
    ['thu', 4],
    ['fri', 5],
    ['sat', 6],
    ['sun', 0],
]

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
    const [startTime, setStartTime] = createSignal(
        editing?.startTime ?? modal.startTime ?? '',
    )
    const [endTime, setEndTime] = createSignal(
        editing?.endTime ?? modal.endTime ?? '',
    )
    const [allDay, setAllDay] = createSignal(
        !editing?.startTime && !modal.startTime,
    )
    const [location, setLocation] = createSignal(editing?.location ?? '')
    const [link, setLink] = createSignal(editing?.link ?? '')
    const [description, setDescription] = createSignal(
        editing?.description ?? '',
    )
    // An event can belong to multiple categories; the first is mirrored back into the
    // legacy `category` field on save so single-category events round-trip unchanged.
    const [selCats, setSelCats] = createSignal<string[]>(
        editing ? eventCategoryNames(editing) : [],
    )
    const toggleCat = (name: string) =>
        setSelCats(prev =>
            prev.includes(name)
                ? prev.filter(n => n !== name)
                : [...prev, name],
        )
    const [recType, setRecType] = createSignal<RecurrenceType | ''>(
        editing?.recurrence?.type ?? '',
    )
    const [recDays, setRecDays] = createSignal<number[]>(
        editing?.recurrence?.daysOfWeek ?? getDefaultDaysOfWeek(),
    )
    const [recStart] = createSignal(
        editing?.recurrence?.startDate ?? defaultDate,
    )
    const [recEnd, setRecEnd] = createSignal(editing?.recurrence?.endDate ?? '')

    const close = () => (showEventModal.value = null)

    async function handleDelete(): Promise<void> {
        if (!editing) return

        if (editing.recurrence && modal!.masterId && modal!.occurrenceDate) {
            recurrenceAction.value = {
                type: 'delete',
                masterId: modal!.masterId,
                occurrenceDate: modal!.occurrenceDate,
            }
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
            ...(allDay() || !startTime()
                ? {}
                : {
                      startTime: startTime(),
                      ...(endTime() && endTime() > startTime()
                          ? { endTime: endTime() }
                          : {}),
                  }),
            ...(location() ? { location: location() } : {}),
            ...(link() ? { link: link() } : {}),
            ...(description() ? { description: description() } : {}),
            // Explicitly include both keys (even when undefined) so clearing categories on an
            // edit actually clears them — updateEvent merges, so an omitted key would persist.
            category: selCats()[0],
            categories: selCats().length > 1 ? [...selCats()] : undefined,
            ...(recType()
                ? {
                      recurrence: {
                          type: recType() as RecurrenceType,
                          ...(recType() === 'weekly' || recType() === 'biweekly'
                              ? {
                                    daysOfWeek: recDays().length
                                        ? recDays()
                                        : undefined,
                                }
                              : {}),
                          startDate: recStart() || date(),
                          endDate: recEnd() || undefined,
                          seriesId: freshSeries
                              ? uuid()
                              : (editing?.recurrence?.seriesId ?? uuid()),
                      },
                  }
                : {}),
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

        if (
            editing &&
            editing.recurrence &&
            modal!.masterId &&
            modal!.occurrenceDate
        ) {
            recurrenceAction.value = {
                type: 'edit',
                masterId: modal!.masterId,
                occurrenceDate: modal!.occurrenceDate,
                updates: eventData,
            }
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
            if (el?.closest?.('button')) return
            if (
                e.key === 'Enter' &&
                tag !== 'TEXTAREA' &&
                tag !== 'SELECT' &&
                !inEditor
            ) {
                e.preventDefault()
                handleSave()
            } else if (
                e.key === 'Backspace' &&
                tag !== 'INPUT' &&
                tag !== 'TEXTAREA' &&
                tag !== 'SELECT' &&
                !inEditor
            ) {
                e.preventDefault()
                handleDelete()
            }
        }
        window.addEventListener('keydown', onKey)
        onCleanup(() => window.removeEventListener('keydown', onKey))
    })

    return (
        <FormModal
            onClose={close}
            label={editing ? 'edit event' : 'new event'}
            class={styles.panel}
        >
            <ModalHeader
                title={editing ? 'edit event' : 'new event'}
                subtitle={prettyDate(date()).toLowerCase()}
                onClose={close}
            />

            <ModalBody>
                <SettingsGrid>
                    {/* title */}
                    <SettingsField label="title">
                        <TextInput
                            data-testid="event-modal-title"
                            type="text"
                            placeholder="untitled event"
                            autofocus
                            value={title()}
                            onInput={setTitle}
                        />
                    </SettingsField>

                    {/* date + all-day */}
                    <SettingsField label="date">
                        <div class={styles.row}>
                            <TextInput
                                type="date"
                                value={date()}
                                onInput={setDate}
                            />
                            <PlainButton
                                class={styles.allday}
                                aria-pressed={allDay()}
                                onClick={() => setAllDay(v => !v)}
                            >
                                <BracketToggle checked={allDay()} />
                                all day
                            </PlainButton>
                        </div>
                    </SettingsField>

                    {/* time — start → end, only when not all-day */}
                    <Show when={!allDay()}>
                        <SettingsField label="time">
                            <div
                                class={styles.row}
                                data-testid="event-modal-times"
                            >
                                <TextInput
                                    type="time"
                                    value={startTime()}
                                    onInput={setStartTime}
                                />
                                <Text
                                    as="span"
                                    size="inherit"
                                    tone="inherit"
                                    weight="inherit"
                                    class={styles.dash}
                                >
                                    →
                                </Text>
                                <TextInput
                                    type="time"
                                    value={endTime()}
                                    onInput={setEndTime}
                                />
                            </div>
                        </SettingsField>
                    </Show>

                    {/* location */}
                    <SettingsField label="location">
                        <TextInput
                            placeholder="add a place"
                            value={location()}
                            onInput={setLocation}
                        />
                    </SettingsField>

                    {/* link */}
                    <SettingsField label="link">
                        <TextInput
                            placeholder="meet.example.com/…"
                            value={link()}
                            onInput={setLink}
                        />
                    </SettingsField>

                    {/* description — live-preview markdown, editable exactly like the note editor */}
                    <SettingsField label="description">
                        <MarkdownField
                            class={styles.mdedit}
                            value={description()}
                            onInput={setDescription}
                            placeholder="markdown"
                        />
                    </SettingsField>

                    {/* category */}
                    <SettingsField label="category" hint="pick one or more">
                        <div class={styles.cats}>
                            <TextButton
                                variant={
                                    selCats().length === 0
                                        ? 'selected'
                                        : 'unselected'
                                }
                                aria-pressed={selCats().length === 0}
                                onClick={() => setSelCats([])}
                            >
                                <StatusDot color="var(--faint)" /> none
                            </TextButton>
                            <For each={categories.value}>
                                {c => {
                                    const color = () =>
                                        resolveCategoryColor(c.color)
                                    const picked = () =>
                                        selCats().includes(c.name)
                                    return (
                                        <TextButton
                                            variant={
                                                picked()
                                                    ? 'selected'
                                                    : 'unselected'
                                            }
                                            accent={color()}
                                            aria-pressed={picked()}
                                            onClick={() => toggleCat(c.name)}
                                        >
                                            <StatusDot color={color()} />{' '}
                                            {c.name}
                                        </TextButton>
                                    )
                                }}
                            </For>
                        </div>
                    </SettingsField>

                    {/* repeat */}
                    <SettingsField label="repeat">
                        <SegmentedToggle
                            value={recType()}
                            onChange={v => setRecType(v)}
                            options={RECUR.map(([label, val]) => ({
                                id: val,
                                label,
                            }))}
                        />
                        <Show
                            when={
                                recType() === 'weekly' ||
                                recType() === 'biweekly'
                            }
                        >
                            <div class={styles.dows}>
                                <For each={DOW}>
                                    {([label, i]) => (
                                        <TextButton
                                            variant={
                                                recDays().includes(i)
                                                    ? 'selected'
                                                    : 'unselected'
                                            }
                                            aria-pressed={recDays().includes(
                                                i,
                                            )}
                                            onClick={() =>
                                                setRecDays(prev =>
                                                    prev.includes(i)
                                                        ? prev.filter(
                                                              x => x !== i,
                                                          )
                                                        : [...prev, i],
                                                )
                                            }
                                        >
                                            {label}
                                        </TextButton>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </SettingsField>

                    {/* ends — only while a repeat is chosen */}
                    <Show when={recType()}>
                        <SettingsField label="ends" badge="optional">
                            <TextInput
                                type="date"
                                value={recEnd()}
                                onInput={setRecEnd}
                            />
                        </SettingsField>
                    </Show>
                </SettingsGrid>
            </ModalBody>

            <ModalFooter
                hint="cancel"
                leading={
                    <Show when={editing}>
                        <TextButton danger onClick={handleDelete}>
                            delete
                        </TextButton>
                        <TextButton onClick={handleDuplicate}>
                            duplicate
                        </TextButton>
                    </Show>
                }
            >
                <TextButton onClick={close}>cancel</TextButton>
                <TextButton primary onClick={handleSave}>
                    {editing ? 'save' : 'create event'}
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}
