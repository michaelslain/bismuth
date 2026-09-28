// Visual spec for <StatView> — one tile per declared (or synthesized) stat metric, over the
// same `metricResults` pipeline as the other chart views. Rows carry due dates RELATIVE to
// today (todayISO/addDaysISO) so the period-split line and sparkline show real, non-zero
// numbers whenever the story is opened, rather than freezing on whatever date it was written.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { BasePropertyDef, Row } from '../../../core/src/bases/types'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { StatView } from './StatView'
import { sampleBaseConfig, sampleViewResult, SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/StatView',
    component: StatView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof StatView>

export default meta
type Story = StoryObj<typeof meta>

const TODAY = todayISO()
const back = (n: number) => addDaysISO(TODAY, -n)

const METRIC_PROPERTIES: Record<string, BasePropertyDef> = {
    price: { type: { kind: 'number', number: 'plain' } },
    units: { type: { kind: 'number', number: 'plain' } },
}

/** 14 sales spread across this week, last week and further back, so `sum(price)`'s
 *  `current`/`previous` bins and 12-week sparkline all land on real numbers. */
const METRIC_ROWS: Partial<Row>[] = [
    ...[0, 1, 2].map(i => ({ note: { due: back(i), price: 20 + i * 5, units: 2 } })),
    ...[8, 9].map(i => ({ note: { due: back(i), price: 15, units: 1 } })),
    ...[16, 30, 45, 60, 75, 90].map(i => ({
        note: { due: back(i), price: 10 + i, units: 1 + Math.floor(i / 30) },
    })),
]

/** Three declared metrics — two plain sums and one ratio expression (`sum(price) /
 *  sum(units)`) — each rendering its own value/period/sparkline/KaTeX tile. */
export const DeclaredMetrics: Story = {
    render: () => {
        const views = [
            {
                type: 'stat' as const,
                name: 'Stats',
                x: 'due',
                bin: 'week' as const,
                stats: [
                    { label: 'total price', value: 'sum(price)' },
                    { label: 'units sold', value: 'sum(units)' },
                    { label: 'price per unit', value: 'sum(price) / sum(units)' },
                ],
            },
        ]
        const config = sampleBaseConfig({ views, properties: METRIC_PROPERTIES })
        return (
            <StatView
                result={sampleViewResult(METRIC_ROWS, { views, properties: METRIC_PROPERTIES })}
                config={config}
            />
        )
    },
}

/** No `stats:` declared — one tile for the view's own synthesized metric
 *  (`defaultMetric` in metrics.ts), still period-split and sparklined off the same rows. */
export const DefaultMetric: Story = {
    render: () => {
        const views = [
            { type: 'stat' as const, name: 'Stats', x: 'due', y: 'price', aggregate: 'sum' as const, bin: 'week' as const },
        ]
        const config = sampleBaseConfig({ views, properties: METRIC_PROPERTIES })
        return (
            <StatView
                result={sampleViewResult(METRIC_ROWS, { views, properties: METRIC_PROPERTIES })}
                config={config}
            />
        )
    },
}

/** One bad expression (a bare `priority`, illegal outside an aggregate) beside a good one —
 *  the bad tile shows `—` and `cannot read: …` in `--danger`; the good tile is unaffected. */
export const MetricError: Story = {
    render: () => {
        const views = [
            {
                type: 'stat' as const,
                name: 'Stats',
                x: 'due',
                bin: 'week' as const,
                stats: [
                    { label: 'total priority', value: 'sum(priority)' },
                    { label: 'bad metric', value: 'priority' },
                ],
            },
        ]
        const rows = SAMPLE_ROWS.map((r, i) => ({
            ...r,
            note: { ...r.note, due: back(i * 3) },
        }))
        const config = sampleBaseConfig({ views })
        return <StatView result={sampleViewResult(rows, { views })} config={config} />
    },
}

/** The view's x axis is explicitly a non-date property (`status`, a select enum) — every tile
 *  omits the period line and sparkline, showing just value/label/KaTeX. */
export const NoDateAxis: Story = {
    render: () => {
        const views = [
            {
                type: 'stat' as const,
                name: 'Stats',
                x: 'status',
                stats: [
                    { label: 'total priority', value: 'sum(priority)' },
                    { label: 'done notes', value: 'count(status == "Done")' },
                ],
            },
        ]
        const config = sampleBaseConfig({ views })
        return <StatView result={sampleViewResult(undefined, { views })} config={config} />
    },
}
