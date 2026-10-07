import { Show, type Component } from 'solid-js'
import Select from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import type { ViewType } from '../../../core/src/bases/types'

export type ChartAggregate = 'sum' | 'avg' | 'count' | 'min' | 'max'
export type ChartBin = 'day' | 'week' | 'month'

export type ChartFieldsProps = {
    /** The chart kind — a heatmap has no date bucket. */
    kind: ViewType
    aggregate: ChartAggregate
    bin: ChartBin
    /** Row-limit text as typed; '' = no limit. */
    limitText: string
    onAggregate: (v: ChartAggregate) => void
    onBin: (v: ChartBin) => void
    onLimit: (text: string) => void
    class?: string
}

const AGG_OPTS = [
    { value: 'sum', label: 'sum' },
    { value: 'avg', label: 'average' },
    { value: 'count', label: 'count' },
    { value: 'min', label: 'min' },
    { value: 'max', label: 'max' },
]
const BIN_OPTS = [
    { value: 'day', label: 'day' },
    { value: 'week', label: 'week' },
    { value: 'month', label: 'month' },
]

/** A chart view's aggregation: how values combine, the date bucket (not for a heatmap) and the
 *  row limit. */
const ChartFields: Component<ChartFieldsProps> = props => (
    <SettingsGrid class={props.class}>
        <SettingsField
            label="aggregate"
            hint="how values are combined per x-axis bucket."
        >
            <Select
                value={props.aggregate}
                options={AGG_OPTS}
                onChange={v => props.onAggregate(v as ChartAggregate)}
            />
        </SettingsField>
        <Show when={props.kind !== 'heatmap'}>
            <SettingsField
                label="date bucket"
                hint="group date values by day, week, or month."
            >
                <Select
                    value={props.bin}
                    options={BIN_OPTS}
                    onChange={v => props.onBin(v as ChartBin)}
                />
            </SettingsField>
        </Show>
        <SettingsField
            label="row limit"
            badge="optional"
            hint="only the first N rows are charted."
        >
            <TextInput
                type="number"
                min="1"
                value={props.limitText}
                placeholder="no limit"
                onInput={props.onLimit}
            />
        </SettingsField>
    </SettingsGrid>
)

export default ChartFields
