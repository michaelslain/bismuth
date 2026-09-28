// Visual spec for <LineView> — the ASCII line-plot renderer (`asciiLine.ts`'s `buildLinePlot`
// over `buildChartData`'s points). Same auto-detected `due`/`priority` axes as BarView's
// default: the curated dataset's `due` column is >=50% ISO dates, so it wins the x-axis without
// an explicit `x:`. `whenMathReady()` is the deterministic seam `play()` awaits before asserting
// on any KaTeX output (see ui/Tex.stories.tsx) — the very first story to mount races the lazy
// ~280KB KaTeX chunk.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import type { Row } from '../../../core/src/bases/types'
import { whenMathReady } from '../editor/katexLoader'
import { LineView } from './LineView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/LineView',
    component: LineView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof LineView>

export default meta
type Story = StoryObj<typeof meta>

/** Auto-detected date x-axis (`due`) + numeric y-axis (`priority`, summed). */
export const Default: Story = {
    render: () => {
        const views = [{ type: 'line' as const, name: 'Chart' }]
        return (
            <LineView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** `bin: "week"` collapses the 6 distinct due-dates into fewer week buckets, and `aggregate:
 *  "avg"` averages `priority` per bucket instead of summing it. Fewer than 3 buckets survive the
 *  weekly bin here, so no trend line/math — see `TwoPoints` for that case made explicit. */
export const WeeklyAverage: Story = {
    render: () => {
        const views = [
            {
                type: 'line' as const,
                name: 'Weekly avg priority',
                bin: 'week' as const,
                aggregate: 'avg' as const,
            },
        ]
        return (
            <LineView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

// A `formula.*` y needs rows carrying the formula's own inputs (`price`/`units`) — the sample
// fixture's curated rows don't have those, so this story supplies its own via `sampleViewResult`'s
// `rows` override. `sampleViewResult` runs the REAL query engine (`runView`), which computes
// `row.formula.ppu` from `config.formulas` itself — no manual formula computation needed here.
const FORMULA_ROWS: Partial<Row>[] = [
    { note: { due: '2026-08-01', price: 10, units: 2 } },
    { note: { due: '2026-08-08', price: 30, units: 5 } },
    { note: { due: '2026-08-15', price: 20, units: 4 } },
    { note: { due: '2026-08-22', price: 48, units: 8 } },
]

/** `y: formula.ppu` over a declared `formulas: { ppu: 'price / units' }` — the KaTeX definition
 *  gains a `\text{ppu} = \frac{\text{price}}{\text{units}}` line after the base definition. */
export const FormulaY: Story = {
    render: () => {
        const views = [
            {
                type: 'line' as const,
                name: 'Price per unit',
                x: 'due',
                y: 'formula.ppu',
            },
        ]
        const config = { views, formulas: { ppu: 'price / units' } }
        return (
            <LineView
                result={sampleViewResult(FORMULA_ROWS, config)}
                config={sampleBaseConfig(config)}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await whenMathReady()
        const katexBlocks = canvasElement.querySelectorAll('.katex')
        expect(katexBlocks.length).toBeGreaterThan(0)
        const text = canvasElement.textContent ?? ''
        expect(text).toContain('ppu')
    },
}

/** Hovering the plot moves the readout to the hovered bucket's date/value/count; clicking opens
 *  the drill list (with `[ clear ]`), clicking the same column again closes it. */
export const HoverAndDrill: Story = {
    render: () => {
        const views = [{ type: 'line' as const, name: 'Chart' }]
        return (
            <LineView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // ChartFrame's onGrid can fire a fresh (but value-equal) object per resize callback,
        // which can re-render the plot's DOM — re-query the <pre> right before each dispatch
        // rather than reusing an element captured earlier, which may already be detached.
        const clickPlot = () => {
            const pre = canvasElement.querySelector('pre')!
            const rect = pre.getBoundingClientRect()
            const x = rect.left + rect.width * 0.6
            const y = rect.top + rect.height * 0.5
            pre.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }))
        }
        const movePlot = () => {
            const pre = canvasElement.querySelector('pre')!
            const rect = pre.getBoundingClientRect()
            const x = rect.left + rect.width * 0.6
            const y = rect.top + rect.height * 0.5
            pre.dispatchEvent(
                new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }),
            )
        }

        movePlot()
        await waitFor(() => {
            const readout = canvasElement.querySelector('[class*="active"]')
            expect(readout).not.toBeNull()
        })

        clickPlot()
        await waitFor(() => expect(canvas.getByText('clear')).toBeInTheDocument())

        clickPlot()
        await waitFor(() => expect(canvas.queryByText('clear')).toBeNull())
    },
}

/** Exactly 2 points — `fitTrend` requires >=3, so no trend line and no trend math (only the
 *  definition line renders). */
export const TwoPoints: Story = {
    render: () => {
        const views = [{ type: 'line' as const, name: 'Chart', x: 'due', y: 'priority' }]
        const rows: Partial<Row>[] = [
            { note: { due: '2026-08-01', priority: 2 } },
            { note: { due: '2026-08-08', priority: 5 } },
        ]
        return (
            <LineView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** 400 daily points in a normal-width pane — only the last K fit, and the readout appends
 *  `// last K of 400`. */
export const FourHundredDays: Story = {
    render: () => {
        const views = [{ type: 'line' as const, name: 'Chart', x: 'due', y: 'priority' }]
        const rows: Partial<Row>[] = Array.from({ length: 400 }, (_, i) => {
            const d = new Date(2025, 0, 1 + i)
            const iso = d.toISOString().slice(0, 10)
            return { note: { due: iso, priority: (i % 7) + 1 } }
        })
        return (
            <LineView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            const text = canvasElement.textContent ?? ''
            expect(text).toMatch(/last \d+ of 400/)
        })
    },
}

/** Negative values — the y-axis scale spans `[min(0, min), max]`, so `0` sits mid-grid rather
 *  than at the bottom row. */
export const NegativeValues: Story = {
    render: () => {
        const views = [{ type: 'line' as const, name: 'Chart', x: 'due', y: 'delta' }]
        const rows: Partial<Row>[] = [
            { note: { due: '2026-08-01', delta: -10 } },
            { note: { due: '2026-08-08', delta: 8 } },
            { note: { due: '2026-08-15', delta: -4 } },
            { note: { due: '2026-08-22', delta: 6 } },
        ]
        return (
            <LineView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** A ~300px pane — columns floor at 20; the plot still renders with no horizontal overflow. */
export const Narrow: Story = {
    render: () => {
        const views = [{ type: 'line' as const, name: 'Chart' }]
        return (
            <div style={{ width: '300px' }}>
                <LineView
                    result={sampleViewResult(undefined, { views })}
                    config={sampleBaseConfig({ views })}
                />
            </div>
        )
    },
}
