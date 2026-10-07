import { createSignal, Show } from 'solid-js'
import { createStore, unwrap } from 'solid-js/store'
import { showEventModal, recurrenceAction } from '../state'
import { EventStore, uuid } from '../EventStore'
import { prettyDate } from '../dates'
import { todayISO } from '../../../../core/src/dates'
import { refreshEvents } from '../refresh'
import { deleteEventWithUndo, duplicateEvent } from '../eventActions'
import {
    buildEventData,
    formDirty,
    initialEventForm,
    type EventFormState,
} from '../eventForm'
import { pushToast } from '../../ui/toastStore'
import FormModal from '../../ui/FormModal'
import ModalBody from '../../ui/ModalBody'
import ToggleRow from '../../ui/ToggleRow'
import { TextInput } from '../../ui/TextInput'
import { TextButton } from '../../ui/TextButton'
import Text from '../../ui/Text'
import MarkdownField from '../../ui/MarkdownField'
import ModalHeader from '../../ui/ModalHeader'
import ModalFooter from '../../ui/ModalFooter'
import SettingsGrid from '../../ui/SettingsGrid'
import SettingsField from '../../ui/SettingsField'
import { isConfirmKey } from '../../ui/widgetKeys'
import DateFieldEditor from '../../bases/DateFieldEditor'
import CategoryPicker from './CategoryPicker'
import RecurrenceField from './RecurrenceField'
import styles from './EventModal.module.css'

export function EventModal(props: { store: EventStore }) {
    const modal = showEventModal.value
    if (!modal) return null
    const editing = modal.event

    const opened = initialEventForm(editing, modal, todayISO(new Date()))
    const [form, setForm] = createStore<EventFormState>(structuredClone(opened))
    const [busy, setBusy] = createSignal(false)
    const snapshot = (): EventFormState =>
        structuredClone(unwrap(form)) as EventFormState

    const close = () => (showEventModal.value = null)

    // An occurrence of a recurring series is edited/deleted through the scope dialog, which owns
    // the this-event / following / all choice.
    const isOccurrence = () =>
        !!(editing?.recurrence && modal.masterId && modal.occurrenceDate)

    // One busy guard for every write: a second click or Enter while one runs is ignored, and a
    // failure toasts instead of vanishing into an unhandled rejection with the modal still open.
    async function run(failure: string, fn: () => Promise<void>): Promise<void> {
        if (busy()) return
        setBusy(true)
        try {
            await fn()
        } catch (e) {
            pushToast(`${failure}: ${(e as Error).message}`)
        } finally {
            setBusy(false)
        }
    }

    const handleDelete = () =>
        run('Could not delete the event', async () => {
            if (!editing) return
            if (isOccurrence()) {
                recurrenceAction.value = {
                    type: 'delete',
                    masterId: modal.masterId!,
                    occurrenceDate: modal.occurrenceDate!,
                }
                close()
                return
            }
            await deleteEventWithUndo(props.store, editing)
            close()
        })

    // Duplicate an untouched event straight through duplicateEvent; once the form has unsaved
    // edits the copy is built from the FORM values (a fresh id + series), so what the user typed
    // is what gets copied.
    const handleDuplicate = () =>
        run('Could not duplicate the event', async () => {
            if (!editing) return
            if (!formDirty(snapshot(), opened))
                await duplicateEvent(props.store, editing)
            else {
                await props.store.addEvent(buildEventData(snapshot(), uuid()))
                await refreshEvents(props.store)
            }
            close()
        })

    const handleSave = () =>
        run('Could not save the event', async () => {
            const data = buildEventData(
                snapshot(),
                editing?.recurrence?.seriesId ?? uuid(),
            )
            if (editing && isOccurrence()) {
                recurrenceAction.value = {
                    type: 'edit',
                    masterId: modal.masterId!,
                    occurrenceDate: modal.occurrenceDate!,
                    updates: data,
                }
                close()
                return
            }
            if (editing) await props.store.updateEvent(editing.id, data)
            else await props.store.addEvent(data)
            await refreshEvents(props.store)
            close()
        })

    // Enter saves, unless it belongs to something inside the form: a toggle or button (their own
    // activation), a select, or the description editor (a newline). Escape is <Modal>'s.
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.defaultPrevented || !isConfirmKey(e)) return
        const el = e.target as HTMLElement | null
        if (el?.closest('button, [role="switch"], select, textarea, .cm-editor'))
            return
        e.preventDefault()
        void handleSave()
    }

    return (
        <FormModal
            onClose={close}
            label={editing ? 'edit event' : 'new event'}
            class={styles.panel}
        >
            <ModalHeader
                title={editing ? 'edit event' : 'new event'}
                subtitle={prettyDate(form.date).toLowerCase()}
                onClose={close}
            />

            <ModalBody>
                <div onKeyDown={onKeyDown}>
                    <SettingsGrid>
                        <SettingsField label="title">
                            <TextInput
                                data-testid="event-modal-title"
                                type="text"
                                placeholder="untitled event"
                                autofocus
                                value={form.title}
                                onInput={v => setForm('title', v)}
                            />
                        </SettingsField>

                        <SettingsField label="date">
                            <div class={styles.row}>
                                <DateFieldEditor
                                    value={form.date}
                                    onCommit={v => {
                                        if (v) setForm('date', String(v))
                                    }}
                                />
                                <ToggleRow
                                    label="all day"
                                    checked={form.allDay}
                                    onToggle={() =>
                                        setForm('allDay', v => !v)
                                    }
                                />
                            </div>
                        </SettingsField>

                        {/* start → end, only when not all-day. No time-only primitive exists
                            (DateFieldEditor stores a date or a datetime), so these stay native. */}
                        <Show when={!form.allDay}>
                            <SettingsField label="time">
                                <div
                                    class={styles.row}
                                    data-testid="event-modal-times"
                                >
                                    <TextInput
                                        type="time"
                                        value={form.startTime}
                                        onInput={v => setForm('startTime', v)}
                                    />
                                    <Text
                                        as="span"
                                        inherit
                                        class={styles.dash}
                                    >
                                        →
                                    </Text>
                                    <TextInput
                                        type="time"
                                        value={form.endTime}
                                        onInput={v => setForm('endTime', v)}
                                    />
                                </div>
                            </SettingsField>
                        </Show>

                        <SettingsField label="location">
                            <TextInput
                                placeholder="add a place"
                                value={form.location}
                                onInput={v => setForm('location', v)}
                            />
                        </SettingsField>

                        <SettingsField label="link">
                            <TextInput
                                placeholder="meet.example.com/…"
                                value={form.link}
                                onInput={v => setForm('link', v)}
                            />
                        </SettingsField>

                        {/* live-preview markdown, editable exactly like the note editor */}
                        <SettingsField label="description">
                            <MarkdownField
                                class={styles.mdedit}
                                value={form.description}
                                onInput={v => setForm('description', v)}
                                placeholder="markdown"
                            />
                        </SettingsField>

                        <SettingsField label="category">
                            <CategoryPicker
                                selected={form.cats}
                                onChange={names => setForm('cats', names)}
                            />
                        </SettingsField>

                        <RecurrenceField
                            type={form.recType}
                            days={form.recDays}
                            end={form.recEnd}
                            onType={t => setForm('recType', t)}
                            onDays={d => setForm('recDays', d)}
                            onEnd={d => setForm('recEnd', d)}
                        />
                    </SettingsGrid>
                </div>
            </ModalBody>

            <ModalFooter
                leading={
                    <Show when={editing}>
                        <TextButton
                            danger
                            disabled={busy()}
                            onClick={handleDelete}
                        >
                            delete
                        </TextButton>
                        <TextButton
                            disabled={busy()}
                            onClick={handleDuplicate}
                        >
                            duplicate
                        </TextButton>
                    </Show>
                }
            >
                <TextButton onClick={close}>cancel</TextButton>
                <TextButton primary disabled={busy()} onClick={handleSave}>
                    {editing ? 'save' : 'create event'}
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}
