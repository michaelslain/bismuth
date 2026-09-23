// app/src/calendar/components/TaskCalendarSettings.tsx
// The settings modal a `mode: tasks` calendar's gear should have opened. `CalendarSettings` (the
// events-register modal) is mounted only inside the events register, so in the tasks register the
// gear toggled a signal nothing was listening to. This is that missing modal — built from the
// same primitives, in the same order, so the two read as one family — but a different shape:
// tasks have no start/end time or recurrence, and (when the base owns its rows) a category is a
// value already present in the data, not a bound column.
//
// Presentational and stateless about persistence: every change goes straight out through
// `onSetField` / `onPickColor`, and the component never touches `api` — that's what makes every
// one of its states a story. It only holds local UI state for which colour popover is open.
import { type Component, createSignal, For, Show } from 'solid-js'
import { baseOf, linkTargetFor } from '../../../../core/src/linkTarget'
import FormModal from '../../ui/FormModal'
import ModalHeader from '../../ui/ModalHeader'
import ModalBody from '../../ui/ModalBody'
import ModalFooter from '../../ui/ModalFooter'
import SettingsSection from '../../ui/SettingsSection'
import SettingsGrid from '../../ui/SettingsGrid'
import SettingsField from '../../ui/SettingsField'
import Select, { type SelectOption } from '../../ui/Select'
import TextInput from '../../ui/TextInput'
import SettingsHint from '../../ui/SettingsHint'
import { TextButton } from '../../ui/TextButton'
import Label from '../../ui/Label'
import ColorChip from '../../ui/ColorChip'
import styles from './TaskCalendarSettings.module.css'

export type TaskCalendarSettingsProps = {
    /** True when the base owns its rows (no `source:`) — picks which "New tasks" field shows. */
    ownsRows: boolean
    /** Column names offered in the Placement / Category selects. */
    columns: string[]
    /** Every vault note path (`folder/Note.md`), for the destination picker. */
    notes: string[]
    /** Current values, as the view config holds them. */
    dateField?: string
    categoryField?: string
    taskFile?: string
    defaultCategory?: string
    /** Category names actually in play, in first-seen order, and their resolved colours. */
    names: string[]
    colors: Map<string, string>
    /** name → a PALETTE token to store. Caller persists. */
    onPickColor: (name: string, token: string) => void
    /** One view-config key. Caller persists into views[viewIndex]. */
    onSetField: (
        key: 'dateField' | 'categoryField' | 'taskFile' | 'defaultCategory',
        value: string,
    ) => void
    onClose: () => void
}

/** `props.columns` as Select options, with a leading "Not set" entry whose `detail` explains
 *  where a task lands when no column is bound. */
function dateOptions(columns: string[]): SelectOption[] {
    return [
        {
            value: '',
            label: 'Not set',
            detail: 'falls back to scheduled, then due',
        },
        ...columns.map(c => ({ value: c, label: c })),
    ]
}

function columnOptions(columns: string[]): SelectOption[] {
    return [{ value: '', label: 'Not set' }, ...columns.map(c => ({ value: c, label: c }))]
}

/** `props.notes` (vault-relative paths) as Select options: the basename as the label, the full
 *  path as the detail, and a value that is already the wikilink text to store — the bare
 *  basename when it's unambiguous, else `linkTargetFor`'s path-qualified form. */
function noteOptions(notes: string[]): SelectOption[] {
    const ids = notes.map(n => n.replace(/\.md$/, ''))
    return [
        { value: '', label: 'Not set' },
        ...ids.map((id, i) => ({
            value: `[[${linkTargetFor(id, ids)}]]`,
            label: baseOf(id),
            detail: notes[i],
        })),
    ]
}

const TaskCalendarSettings: Component<TaskCalendarSettingsProps> = props => {
    const [openPicker, setOpenPicker] = createSignal<string | null>(null)

    return (
        <FormModal onClose={props.onClose} label="Task calendar settings">
            <ModalHeader
                icon="settings-2"
                title="Task calendar settings"
                compact
                onClose={props.onClose}
            />

            <ModalBody>
                <SettingsSection>Placement</SettingsSection>
                <SettingsGrid>
                    <SettingsField
                        icon="calendar"
                        label="Date column"
                        span
                        hint={
                            props.dateField
                                ? undefined
                                : 'Tasks fall back to scheduled, then due, until this is set.'
                        }
                    >
                        <Select
                            value={props.dateField ?? ''}
                            options={dateOptions(props.columns)}
                            placeholder="Not set"
                            onChange={v => props.onSetField('dateField', v)}
                        />
                    </SettingsField>
                </SettingsGrid>

                <SettingsSection>New tasks</SettingsSection>
                <SettingsGrid>
                    <Show
                        when={!props.ownsRows}
                        fallback={
                            <SettingsField
                                icon="Tag"
                                label="Default category"
                                span
                            >
                                <TextInput
                                    value={props.defaultCategory ?? ''}
                                    placeholder="Not set"
                                    list="task-calendar-settings-category-names"
                                    class={styles['category-input']}
                                    onInput={v =>
                                        props.onSetField('defaultCategory', v)
                                    }
                                />
                                <datalist id="task-calendar-settings-category-names">
                                    <For each={props.names}>
                                        {name => <option value={name} />}
                                    </For>
                                </datalist>
                            </SettingsField>
                        }
                    >
                        <SettingsField
                            icon="FileText"
                            label="Destination note"
                            span
                            hint={
                                props.taskFile
                                    ? undefined
                                    : 'New tasks have nowhere to go until this is set.'
                            }
                        >
                            <Select
                                value={props.taskFile ?? ''}
                                options={noteOptions(props.notes)}
                                placeholder="Not set"
                                onChange={v =>
                                    props.onSetField('taskFile', v)
                                }
                            />
                        </SettingsField>
                    </Show>
                </SettingsGrid>

                <SettingsSection>Categories</SettingsSection>
                <Show when={!props.names.length}>
                    <SettingsHint>
                        Categories appear here once tasks have a source note
                        or a category value.
                    </SettingsHint>
                </Show>
                <Show when={props.ownsRows}>
                    <SettingsGrid>
                        <SettingsField
                            icon="Tag"
                            label="Category column"
                            span
                            hint={
                                props.categoryField
                                    ? undefined
                                    : "Without this, a task's category comes from a `category` column, if it has one."
                            }
                        >
                            <Select
                                value={props.categoryField ?? ''}
                                options={columnOptions(props.columns)}
                                placeholder="Not set"
                                onChange={v =>
                                    props.onSetField('categoryField', v)
                                }
                            />
                        </SettingsField>
                    </SettingsGrid>
                </Show>
                <Show when={props.names.length}>
                    <div class={styles['catgroup']}>
                        <For each={props.names}>
                            {name => (
                                <div class={styles['catrow']}>
                                    <ColorChip
                                        color={props.colors.get(name) ?? ''}
                                        open={openPicker() === name}
                                        onToggle={() =>
                                            setOpenPicker(p =>
                                                p === name ? null : name,
                                            )
                                        }
                                        onPick={token => {
                                            props.onPickColor(name, token)
                                            setOpenPicker(null)
                                        }}
                                    />
                                    <Label fill>{name}</Label>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </ModalBody>

            <ModalFooter hint="to close">
                <TextButton
                    primary
                    onClick={props.onClose}
                >
                    done
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}

export default TaskCalendarSettings
