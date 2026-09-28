import { createMemo } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import type { MetricResult } from '../../../core/src/bases/metrics'
import { metricResults } from '../../../core/src/bases/metrics'
import { exprToLatex } from '../../../core/src/bases/chartLatex'
import { parseExpr } from '../../../core/src/bases/parser'
import { formatValue } from '../../../core/src/bases/chartText'
import { todayISO } from '../../../core/src/dates'
import ChartFrame from './ChartFrame'
import StatTiles, { type StatTile } from './StatTiles'
import { sparkline } from './sparkline'
import type { ChartViewProps } from './chartViewProps'

// `3 this week // 1 last week` — day bins read as `today`/`yesterday` instead of the generic
// `this day`/`last day` phrasing (bases-stat.card.html).
function periodLine(m: MetricResult): string | undefined {
    if (!m.hasTime || m.current === null || m.previous === null) return undefined
    const curWord = m.bin === 'day' ? 'today' : `this ${m.bin}`
    const prevWord = m.bin === 'day' ? 'yesterday' : `last ${m.bin}`
    return `${formatValue(m.current)} ${curWord} // ${formatValue(m.previous)} ${prevWord}`
}

// A metric that failed to parse/evaluate already carries `error`; re-deriving its LaTeX would
// just throw the same failure again, so skip it and let the tile show the error line instead.
function metricTex(m: MetricResult): string | undefined {
    if (m.error) return undefined
    try {
        return exprToLatex(parseExpr(m.source))
    } catch {
        return undefined
    }
}

/** One tile per declared (or synthesized) stat metric — value, label, period split, sparkline,
 *  KaTeX (bases-stat.card.html: the largest type in the system, and the one view with no ASCII
 *  chart at all). */
export function StatView(props: ChartViewProps) {
    const rows = createMemo<Row[]>(() =>
        props.result.groups.flatMap(g => g.rows),
    )
    const metrics = createMemo(() =>
        metricResults(rows(), props.result.view, todayISO()),
    )

    const tiles = createMemo<StatTile[]>(() =>
        metrics().map((m, i) => {
            const spark = m.hasTime ? sparkline(m.series) : ''
            return {
                label: m.label,
                value: m.value === null ? '—' : formatValue(m.value),
                tone: i === 0 ? 'accent' : undefined,
                period: periodLine(m),
                spark: spark || undefined,
                tex: metricTex(m),
                error: m.error,
            }
        }),
    )

    return (
        <ChartFrame
            empty={rows().length === 0}
            emptyMessage="No data to chart."
        >
            <StatTiles tiles={tiles()} />
        </ChartFrame>
    )
}
