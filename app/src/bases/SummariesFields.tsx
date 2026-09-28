import { For, Show, type Component } from 'solid-js'
import type { BaseConfig } from '../../../core/src/bases/types'
import Select from '../ui/Select'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import SettingsHint from '../ui/SettingsHint'
import { columnLabel } from './columnLabel'
import { SUMMARY_NAMES } from './summariesForm'

export type SummariesFieldsProps = {
    /** The table's visible column ids — one summary picker each. */
    columns: string[]
    /** column id -> summary name ('' = none). */
    choices: Record<string, string>
    onChange: (choices: Record<string, string>) => void
    config?: BaseConfig
    class?: string
}

const OPTIONS = [
    { value: '', label: 'none' },
    ...SUMMARY_NAMES.map(n => ({ value: n, label: n.toLowerCase() })),
]

/** The table footer: one aggregation (sum, average, count, …) per visible column. */
const SummariesFields: Component<SummariesFieldsProps> = props => (
    <Show
        when={props.columns.length > 0}
        fallback={<SettingsHint>show a column to summarise it.</SettingsHint>}
    >
        <SettingsGrid class={props.class}>
            <For each={props.columns}>
                {col => (
                    <SettingsField
                        label={columnLabel(col, props.config ?? { views: [] })}
                    >
                        <Select
                            value={props.choices[col] ?? ''}
                            options={OPTIONS}
                            placeholder="none"
                            onChange={v =>
                                props.onChange({ ...props.choices, [col]: v })
                            }
                        />
                    </SettingsField>
                )}
            </For>
        </SettingsGrid>
    </Show>
)

export default SummariesFields
