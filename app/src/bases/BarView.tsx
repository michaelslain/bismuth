import { createMemo } from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { buildChartData } from '../../../core/src/bases/chart'
import { AsciiChart } from '../ui/ascii/AsciiMeter'
import ChartFrame from './ChartFrame'
import styles from './BarView.module.css'

// Per-bar palette cycles through the graph color ramp (--graph-0..--graph-4),
// sourced from the theme tokens so bars re-tint when the user switches themes.
const BAR_PALETTE = [
    'var(--graph-0, var(--teal))',
    'var(--graph-1, var(--blue))',
    'var(--graph-2, var(--violet))',
    'var(--graph-3, var(--green))',
    'var(--graph-4, var(--gold))',
]

export function BarView(props: { result: ViewResult; config: BaseConfig }) {
    const rows = createMemo<Row[]>(() =>
        props.result.groups.flatMap(g => g.rows),
    )
    const data = createMemo(() => buildChartData(rows(), props.result.view))

    const series = createMemo(() =>
        data().points.map((p, i) => ({
            label: p.label,
            value: p.value,
            color: BAR_PALETTE[i % BAR_PALETTE.length],
        })),
    )

    return (
        <ChartFrame
            empty={data().points.length === 0}
            emptyMessage="No data to chart."
        >
            <div class={styles.barChart}>
                <AsciiChart series={series()} width={32} />
            </div>
        </ChartFrame>
    )
}
