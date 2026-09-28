import { createMemo, Show, type Component } from 'solid-js'
import type { BaseConfig, ViewConfig } from '../../../core/src/bases/types'
import type { Aggregate } from '../../../core/src/bases/chart'
import type { Bin } from '../../../core/src/dates'
import { columnLabel } from './columnLabel'
import Label from '../ui/Label'
import Select, { type SelectOption } from '../ui/Select'
import styles from './ChartConfigBar.module.css'

export type ChartConfigBarProps = {
    view: ViewConfig
    columns: string[]
    onSet: (key: 'x' | 'y' | 'aggregate' | 'bin', value: string | undefined) => void
    class?: string
}

const COUNT_ROWS = ''

const AGGREGATE_OPTIONS: SelectOption[] = [
    { value: 'sum', label: 'sum' },
    { value: 'avg', label: 'avg' },
    { value: 'count', label: 'count' },
    { value: 'min', label: 'min' },
    { value: 'max', label: 'max' },
]

const BIN_OPTIONS: SelectOption[] = [
    { value: 'day', label: 'day' },
    { value: 'week', label: 'week' },
    { value: 'month', label: 'month' },
]

/**
 * The ViewBar `config` slot for a chart kind (bar/line/stat/heatmap) — four pickers (x, y,
 * aggregate, bin) written straight back to the base file via `props.onSet`, which the caller
 * (BaseView) turns into `api.setViewProperty`/`deleteViewProperty` + a refetch — the same shape
 * as the table's columnWidths write. Only rendered when the base has a write target
 * (`basePath` — see Review Focus #5 in the chart-views plan): an inline ```query block with no
 * base file gets no pickers at all, decided by the caller, not here.
 */
const ChartConfigBar: Component<ChartConfigBarProps> = props => {
    const isHeatmap = () => props.view.type === 'heatmap'
    const hasStats = () => (props.view.stats?.length ?? 0) > 0

    // No BaseConfig in these props (see the plan's Interfaces) — labels fall back to the bare
    // property id, without a `properties[].displayName` override.
    const NO_CONFIG: BaseConfig = { views: [] }
    const columnOptions = createMemo<SelectOption[]>(() =>
        props.columns.map(c => ({ value: c, label: columnLabel(c, NO_CONFIG) })),
    )

    const xValue = createMemo(() => props.view.x ?? props.columns[0] ?? '')
    const yValue = createMemo(() => props.view.y ?? COUNT_ROWS)
    const yOptions = createMemo<SelectOption[]>(() => [
        { value: COUNT_ROWS, label: '(count rows)' },
        ...columnOptions(),
    ])
    const aggregateValue = createMemo<Aggregate>(
        () => props.view.aggregate ?? (props.view.y ? 'sum' : 'count'),
    )
    const binValue = createMemo<Bin>(() => props.view.bin ?? 'day')

    const setY = (value: string) => {
        if (value === COUNT_ROWS) {
            props.onSet('y', undefined)
            props.onSet('aggregate', 'count')
            return
        }
        props.onSet('y', value)
    }

    return (
        <div class={`${styles.bar} ${props.class ?? ''}`} data-chart-config-bar>
            <div class={styles.field} data-bar-drop="1">
                <Label tone="muted">x</Label>
                <Select
                    value={xValue()}
                    options={columnOptions()}
                    onChange={v => props.onSet('x', v || undefined)}
                    class={styles.select}
                />
            </div>
            <Show when={!hasStats()}>
                <div class={styles.field} data-bar-drop="2">
                    <Label tone="muted">y</Label>
                    <Select
                        value={yValue()}
                        options={yOptions()}
                        onChange={setY}
                        class={styles.select}
                    />
                </div>
                <div class={styles.field} data-bar-drop="3">
                    <Label tone="muted">agg</Label>
                    <Select
                        value={aggregateValue()}
                        options={AGGREGATE_OPTIONS}
                        onChange={v => props.onSet('aggregate', v as Aggregate)}
                        class={styles.select}
                    />
                </div>
            </Show>
            <Show when={!isHeatmap()}>
                <div class={styles.field} data-bar-drop="4">
                    <Label tone="muted">bin</Label>
                    <Select
                        value={binValue()}
                        options={BIN_OPTIONS}
                        onChange={v => props.onSet('bin', v as Bin)}
                        class={styles.select}
                    />
                </div>
            </Show>
        </div>
    )
}

export default ChartConfigBar
