// A full editor for ONE task — description, status, dates, priority, and either its category
// (a stored row) or the note it lives in (a line task) — plus delete, from a single modal. This
// is the "without LLM editing source code" gap for everything a task's own edit affordance
// (TaskRow's hover pencil) doesn't cover: toggling status only flips done/not-done, and there
// was previously no UI path to rename a task, change its priority, or move it between notes.
//
// Presentational-ish but not pure: unlike TaskCalendarSettings (which never touches `api`),
// this owns its own save/delete because the write shape differs by task origin (line vs
// stored row) in a way the opener shouldn't have to know — `taskEdit.ts`'s isEditableTask/
// updateTask/deleteTask/moveTask already encapsulate that split, the save/delete branching itself lives in taskEditSave.ts.
import { createSignal, onMount, Show, type Component } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { api } from '../api'
import { pushToast } from '../ui/toastStore'
import { pushUndoToast } from '../undoToast'
import { isConfirmKey } from '../ui/widgetKeys'
import { openNote as openNoteEvent } from '../ui/openNote'
import { TASK_STATUS_OPTIONS } from '../taskStatusMenu'
import type { TaskPriority } from './taskEdit'
import {
    initialTaskFields,
    saveTaskEdit,
    deleteTaskUndoable,
    TASK_PRIORITIES,
} from './taskEditSave'
import { destinationOptions } from './selectOptions'
import FormModal from '../ui/FormModal'
import ModalHeader from '../ui/ModalHeader'
import ModalBody from '../ui/ModalBody'
import ModalFooter from '../ui/ModalFooter'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import Select, { type SelectOption } from '../ui/Select'
import SuggestInput from '../ui/SuggestInput'
import TextInput from '../ui/TextInput'
import DateFieldEditor from './DateFieldEditor'
import { TextButton } from '../ui/TextButton'
import { IconTextButton } from '../ui/IconTextButton'
import styles from './TaskEditModal.module.css'

const PRIORITY_OPTIONS: SelectOption[] = [
    { value: '', label: 'none' },
    ...TASK_PRIORITIES.map(p => ({ value: p, label: p })),
]

const STATUS_OPTIONS: SelectOption[] = TASK_STATUS_OPTIONS.map(o => ({
    value: o.char,
    label: o.label,
}))

export type TaskEditModalProps = {
    row: Row
    categoryField?: string
    categories?: string[]
    destinations?: { label: string; path: string }[]
    onChanged?: () => void
    onClose: () => void
}

const TaskEditModal: Component<TaskEditModalProps> = props => {
    const isLine = () => typeof props.row.note.line === 'number'
    const categoryField = () => props.categoryField ?? 'category'
    const initial = initialTaskFields(props.row, categoryField())

    const [description, setDescription] = createSignal(initial.description)
    const [statusChar, setStatusChar] = createSignal(initial.statusChar)
    const [due, setDue] = createSignal<string | null>(initial.due)
    const [scheduled, setScheduled] = createSignal<string | null>(
        initial.scheduled,
    )
    const [priority, setPriority] = createSignal<TaskPriority | null>(
        initial.priority,
    )
    const [category, setCategory] = createSignal(initial.category)
    const [destPath, setDestPath] = createSignal(initial.destPath)
    const [notes, setNotes] = createSignal<string[]>([])
    const [busy, setBusy] = createSignal(false)

    onMount(() => {
        if (isLine() && !props.destinations) {
            void api
                .tree()
                .then(entries =>
                    setNotes(
                        entries
                            .filter(
                                e =>
                                    e.kind === 'file' && e.path.endsWith('.md'),
                            )
                            .map(e => e.path),
                    ),
                )
                .catch(() => {})
        }
    })

    const destOptions = (): SelectOption[] =>
        destinationOptions(
            props.destinations ?? notes().map(path => ({ path })),
        )

    async function save(): Promise<void> {
        if (busy()) return
        setBusy(true)
        try {
            await saveTaskEdit(
                props.row,
                initial,
                {
                    description: description(),
                    statusChar: statusChar(),
                    due: due(),
                    scheduled: scheduled(),
                    priority: priority(),
                    category: category(),
                    destPath: destPath(),
                },
                { categoryField: categoryField() },
            )
            props.onChanged?.()
            props.onClose()
        } catch (err) {
            pushToast(
                `Could not save the task: ${err instanceof Error ? err.message : String(err)}`,
            )
        } finally {
            setBusy(false)
        }
    }

    /** Deletes at once; the toast's undo puts the task back. */
    async function remove(): Promise<void> {
        if (busy()) return
        setBusy(true)
        try {
            const restore = await deleteTaskUndoable(props.row)
            const title = initial.description || props.row.file.name
            pushUndoToast(`deleted ${title}`, async () => {
                await restore()
                props.onChanged?.()
            })
            props.onChanged?.()
            props.onClose()
        } catch (err) {
            pushToast(
                `Could not delete the task: ${err instanceof Error ? err.message : String(err)}`,
            )
            setBusy(false)
        }
    }

    function openNote(): void {
        openNoteEvent(props.row.file.path)
        props.onClose()
    }

    const onKeyDown = (e: KeyboardEvent) => {
        if (isConfirmKey(e)) {
            e.preventDefault()
            void save()
        }
    }

    return (
        <FormModal width={460} label="edit task" onClose={props.onClose}>
            <ModalHeader title="edit task" onClose={props.onClose} />

            <ModalBody>
                <div class={styles.form} onKeyDown={onKeyDown}>
                    <SettingsGrid>
                        <SettingsField label="description" span>
                            <TextInput
                                value={description()}
                                onInput={setDescription}
                            />
                        </SettingsField>
                        <SettingsField label="status">
                            <Select
                                value={statusChar()}
                                options={STATUS_OPTIONS}
                                onChange={setStatusChar}
                            />
                        </SettingsField>
                        <SettingsField label="priority">
                            <Select
                                value={priority() ?? ''}
                                options={PRIORITY_OPTIONS}
                                onChange={v =>
                                    setPriority(v ? (v as TaskPriority) : null)
                                }
                            />
                        </SettingsField>
                        <SettingsField label="scheduled">
                            <DateFieldEditor
                                value={scheduled() ?? ''}
                                placeholder="not set"
                                onCommit={v =>
                                    setScheduled((v as string | null) || null)
                                }
                            />
                        </SettingsField>
                        <SettingsField label="due">
                            <DateFieldEditor
                                value={due() ?? ''}
                                placeholder="not set"
                                onCommit={v =>
                                    setDue((v as string | null) || null)
                                }
                            />
                        </SettingsField>
                        <Show
                            when={!isLine()}
                            fallback={
                                <SettingsField label="note" span>
                                    <Select
                                        value={destPath()}
                                        options={destOptions()}
                                        onChange={setDestPath}
                                    />
                                </SettingsField>
                            }
                        >
                            <SettingsField label="category" span>
                                <SuggestInput
                                    value={category()}
                                    placeholder="not set"
                                    options={(props.categories ?? []).map(
                                        name => ({ value: name }),
                                    )}
                                    onInput={setCategory}
                                />
                            </SettingsField>
                        </Show>
                    </SettingsGrid>
                </div>
            </ModalBody>

            <ModalFooter
                leading={
                    <TextButton
                        danger
                        disabled={busy()}
                        onClick={() => void remove()}
                    >
                        delete
                    </TextButton>
                }
            >
                <IconTextButton icon="ExternalLink" onClick={openNote}>
                    open note
                </IconTextButton>
                <TextButton onClick={props.onClose}>cancel</TextButton>
                <TextButton
                    primary
                    disabled={busy()}
                    onClick={() => void save()}
                >
                    {busy() ? '…' : 'save'}
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}

export default TaskEditModal
