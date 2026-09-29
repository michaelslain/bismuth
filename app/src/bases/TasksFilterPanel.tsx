import { Show, type Component } from 'solid-js'
import Select, { type SelectOption } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import type { TaskFilters } from './queryGen'

export type TasksFilterPanelProps = {
    value: TaskFilters
    /** The changed fields only — merge them into the state. */
    onChange: (patch: Partial<TaskFilters>) => void
    /** `[[Name]]` options for "scope to a base" (the whole-vault entry is added here). */
    bases: SelectOption[]
    class?: string
}

const PRIORITY_OPTS: SelectOption[] = [
    { value: 'any', label: 'Any priority' },
    { value: 'highest', label: 'Highest' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
    { value: 'lowest', label: 'Lowest' },
    { value: 'none', label: 'None' },
]
const DUE_OPTS: SelectOption[] = [
    { value: 'any', label: 'Any' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'today', label: 'Due today' },
    { value: 'week', label: 'Due this week' },
    { value: 'has', label: 'Has a due date' },
]
const SORT_OPTS: SelectOption[] = [
    { value: '', label: 'None' },
    { value: 'priority', label: 'Priority' },
    { value: 'due', label: 'Due date' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'start', label: 'Start' },
    { value: 'done', label: 'Done date' },
    { value: 'created', label: 'Created' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'description', label: 'Description' },
]
const DIR_OPTS: SelectOption[] = [
    { value: 'ASC', label: 'Ascending' },
    { value: 'DESC', label: 'Descending' },
]

/**
 * The Tasks source's filters: status / priority / due / recurring / sort presets that compile
 * to the Tasks DSL, an optional "scope to a base", and any DSL leaf the presets could not
 * express kept verbatim as an advanced filter.
 */
const TasksFilterPanel: Component<TasksFilterPanelProps> = props => (
    <>
        <SettingsGrid class={props.class}>
            <SettingsField label="status">
                <SegmentedToggle
                    options={[
                        { id: 'open', label: 'open' },
                        { id: 'done', label: 'done' },
                        { id: 'all', label: 'all' },
                    ]}
                    value={props.value.status}
                    onChange={s =>
                        props.onChange({ status: s as TaskFilters['status'] })
                    }
                    size="sm"
                />
            </SettingsField>
            <SettingsField label="priority">
                <Select
                    value={props.value.priority}
                    options={PRIORITY_OPTS}
                    onChange={priority => props.onChange({ priority })}
                />
            </SettingsField>
            <SettingsField label="due">
                <Select
                    value={props.value.due}
                    options={DUE_OPTS}
                    onChange={v =>
                        props.onChange({ due: v as TaskFilters['due'] })
                    }
                />
            </SettingsField>
            <SettingsField label="recurring">
                <SegmentedToggle
                    options={[
                        { id: 'any', label: 'any' },
                        { id: 'yes', label: 'yes' },
                        { id: 'no', label: 'no' },
                    ]}
                    value={props.value.recurring}
                    onChange={r =>
                        props.onChange({
                            recurring: r as TaskFilters['recurring'],
                        })
                    }
                    size="sm"
                />
            </SettingsField>
            <SettingsField label="sort by">
                <Select
                    value={props.value.sortKey}
                    options={SORT_OPTS}
                    placeholder="None"
                    onChange={sortKey => props.onChange({ sortKey })}
                />
            </SettingsField>
            <Show when={props.value.sortKey}>
                <SettingsField label="direction">
                    <Select
                        value={props.value.sortReverse ? 'DESC' : 'ASC'}
                        options={DIR_OPTS}
                        onChange={v => props.onChange({ sortReverse: v === 'DESC' })}
                    />
                </SettingsField>
            </Show>
            <SettingsField
                label="scope to a base"
                badge="optional"
                span
                hint="limit tasks to the notes inside another base."
            >
                <Select
                    value={props.value.from ?? ''}
                    options={[
                        { value: '', label: 'Whole vault' },
                        ...props.bases,
                    ]}
                    placeholder="Whole vault"
                    onChange={v => props.onChange({ from: v || undefined })}
                />
            </SettingsField>
        </SettingsGrid>
        <Show when={props.value.rawWhere}>
            <SettingsField
                label="advanced filter"
                hint="extra Tasks-DSL filters that don't map to a preset, kept verbatim."
            >
                <TextInput
                    value={props.value.rawWhere ?? ''}
                    onInput={rawWhere => props.onChange({ rawWhere })}
                />
            </SettingsField>
        </Show>
    </>
)

export default TasksFilterPanel
