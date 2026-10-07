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
    { value: 'any', label: 'any priority' },
    { value: 'highest', label: 'highest' },
    { value: 'high', label: 'high' },
    { value: 'medium', label: 'medium' },
    { value: 'low', label: 'low' },
    { value: 'lowest', label: 'lowest' },
    { value: 'none', label: 'none' },
]
const DUE_OPTS: SelectOption[] = [
    { value: 'any', label: 'any' },
    { value: 'overdue', label: 'overdue' },
    { value: 'today', label: 'due today' },
    { value: 'week', label: 'due this week' },
    { value: 'has', label: 'has a due date' },
]
const SORT_OPTS: SelectOption[] = [
    { value: '', label: 'none' },
    { value: 'priority', label: 'priority' },
    { value: 'due', label: 'due date' },
    { value: 'scheduled', label: 'scheduled' },
    { value: 'start', label: 'start' },
    { value: 'done', label: 'done date' },
    { value: 'created', label: 'created' },
    { value: 'cancelled', label: 'cancelled' },
    { value: 'description', label: 'description' },
]
const DIR_OPTS: SelectOption[] = [
    { value: 'ASC', label: 'ascending' },
    { value: 'DESC', label: 'descending' },
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
                    placeholder="none"
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
                        { value: '', label: 'whole vault' },
                        ...props.bases,
                    ]}
                    placeholder="whole vault"
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
