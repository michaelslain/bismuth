import { createMemo } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import type { MetricResult } from '../../../core/src/bases/metrics'
import { metricResults } from '../../../core/src/bases/metrics'
import { formatValue } from '../../../core/src/bases/chartText'
import { todayISO } from '../../../core/src/dates'
import ChartFrame from './ChartFrame'
import { trimSpark } from './sparkline'
import StatTiles from './StatTiles'
import type { StatTileProps } from './StatTile'
import type { ChartViewProps } from './chartViewProps'

// `3 this week // 1 last week` — day bins read as `today`/`yesterday` instead of the generic
// `this day`/`last day` phrasing (bases-stat.card.html).
function periodLine(m: MetricResult): string[] | undefined {
    if (!m.hasTime || m.current === null || m.previous === null) return undefined
    const curWord = m.bin === 'day' ? 'today' : `this ${m.bin}`
    const prevWord = m.bin === 'day' ? 'yesterday' : `last ${m.bin}`
    return [`${formatValue(m.current)} ${curWord}`, `${formatValue(m.previous)} ${prevWord}`]
}

// The history from the first bin with rows; none when that leaves a single bar.
function sparkFor(m: MetricResult): StatTileProps['spark'] {
    if (!m.hasTime) return undefined
    const trimmed = trimSpark({ values: m.series, keys: m.seriesKeys, labels: m.seriesLabels })
    return trimmed && { ...trimmed, bin: m.bin }
}

/** One tile per declared (or synthesized) stat metric — value, label, period split, sparkline,
 *  and the metric as written (bases-stat.card.html: the largest type in the system). */
export function StatView(props: ChartViewProps) {
    const rows = createMemo<Row[]>(() =>
        props.result.groups.flatMap(g => g.rows),
    )
    const metrics = createMemo(() =>
        metricResults(rows(), props.result.view, todayISO()),
    )

    const tiles = createMemo<StatTileProps[]>(() =>
        metrics().map((m, i) => ({
            label: m.label,
            value: m.value === null ? '—' : formatValue(m.value),
            tone: i === 0 ? 'accent' : undefined,
            period: periodLine(m),
            spark: sparkFor(m),
            // The expression as written (`avg(score)`): a failed one shows its error instead.
            formula: m.error ? undefined : m.source,
            error: m.error,
        })),
    )

    return (
        <ChartFrame empty={rows().length === 0}>
            <StatTiles tiles={tiles()} />
        </ChartFrame>
    )
}
