// Visual spec for <LineView> — the ASCII line-plot renderer (`asciiLine.ts`'s `buildLinePlot`
// over `buildChartData`'s points). Same auto-detected `due`/`priority` axes as BarView's
// default: the curated dataset's `due` column is >=50% ISO dates, so it wins the x-axis without
// an explicit `x:`. `whenMathReady()` is the deterministic seam `play()` awaits before asserting
// on any KaTeX output (see ui/Tex.stories.tsx) — the very first story to mount races the lazy
// ~280KB KaTeX chunk.
import { createSignal, onCleanup } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
        const view = { type: 'line' as const }
        return (
            <LineView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
}

/** `bin: "week"` collapses the 6 distinct due-dates into fewer week buckets, and `aggregate:
 *  "avg"` averages `priority` per bucket instead of summing it. Fewer than 3 buckets survive the
 *  weekly bin here, so no trend line/math — see `TwoPoints` for that case made explicit. */
export const WeeklyAverage: Story = {
    render: () => {
        const view = {
                type: 'line' as const,
                bin: 'week' as const,
                aggregate: 'avg' as const,
            }
        return (
            <LineView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
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
        const view = {
                type: 'line' as const,
                x: 'due',
                y: 'formula.ppu',
            }
        const config = { view, formulas: { ppu: 'price / units' } }
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
        expect(canvasElement.querySelector('.katex .mfrac')).not.toBeNull()
    },
}

/** Hovering the plot moves the readout to the hovered bucket's date/value/count; clicking opens
 *  the drill list (with `[ clear ]`), clicking the same column again closes it. */
export const HoverAndDrill: Story = {
    render: () => {
        const view = { type: 'line' as const }
        return (
            <LineView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
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
        const view = { type: 'line' as const, x: 'due', y: 'priority' }
        const rows: Partial<Row>[] = [
            { note: { due: '2026-08-01', priority: 2 } },
            { note: { due: '2026-08-08', priority: 5 } },
        ]
        return (
            <LineView
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
}

/** 400 daily points in a normal-width pane — only the last K fit, and the readout appends
 *  `// last K of 400`. */
export const FourHundredDays: Story = {
    render: () => {
        const view = { type: 'line' as const, x: 'due', y: 'priority' }
        const rows: Partial<Row>[] = Array.from({ length: 400 }, (_, i) => {
            const d = new Date(2025, 0, 1 + i)
            const iso = d.toISOString().slice(0, 10)
            return { note: { due: iso, priority: (i % 7) + 1 } }
        })
        return (
            <LineView
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
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
        const view = { type: 'line' as const, x: 'due', y: 'delta' }
        const rows: Partial<Row>[] = [
            { note: { due: '2026-08-01', delta: -10 } },
            { note: { due: '2026-08-08', delta: 8 } },
            { note: { due: '2026-08-15', delta: -4 } },
            { note: { due: '2026-08-22', delta: 6 } },
        ]
        return (
            <LineView
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
}

/** A ~300px pane — columns floor at 20; the plot still renders with no horizontal overflow. */
export const Narrow: Story = {
    render: () => {
        const view = { type: 'line' as const }
        return (
            <div style={{ width: '300px' }}>
                <LineView
                    result={sampleViewResult(undefined, { view })}
                    config={sampleBaseConfig({ view })}
                />
            </div>
        )
    },
}

/** No rows: the one shared empty state, not a blank plot. */
export const Empty: Story = {
    render: () => {
        const view = { type: 'line' as const, x: 'due', y: 'priority' }
        return (
            <LineView
                result={sampleViewResult([], { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('no data to chart'))
        expect(canvasElement.querySelector('pre')).toBeNull()
    },
}

/** `bin: "month"` over dates six months apart — the x labels are months and the points are spaced
 *  by real calendar distance (Jan 1 to Mar 1 is two slots, Mar 1 to Jul 1 four). */
export const MonthBin: Story = {
    render: () => {
        const view = { type: 'line' as const, x: 'due', y: 'amount', bin: 'month' as const }
        const rows: Partial<Row>[] = [
            { note: { due: '2026-01-05', amount: 4 } },
            { note: { due: '2026-01-20', amount: 3 } },
            { note: { due: '2026-03-10', amount: 9 } },
            { note: { due: '2026-07-02', amount: 6 } },
        ]
        return (
            <LineView
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('pre')?.textContent).toMatch(/Jan/))
        expect(canvasElement.querySelector('pre')?.textContent).toMatch(/Jul/)
    },
}

/** `bin: "day"` over a fortnight of daily rows — one point per day, day labels on the axis. */
export const DayBin: Story = {
    render: () => {
        const view = { type: 'line' as const, x: 'due', y: 'amount', bin: 'day' as const }
        const rows: Partial<Row>[] = Array.from({ length: 14 }, (_, i) => ({
            note: { due: `2026-08-${String(i + 1).padStart(2, '0')}`, amount: (i * 5) % 9 },
        }))
        return (
            <LineView
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
}

/** A categorical x (`status`, not a date): points sit at even index spacing, there is no trend
 *  line, and the axis labels are the category names. */
export const CategoricalX: Story = {
    render: () => {
        const view = { type: 'line' as const, x: 'status', y: 'priority', aggregate: 'sum' as const }
        return (
            <LineView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('pre')).not.toBeNull())
        const plot = canvasElement.querySelector('pre')!.textContent ?? ''
        expect(plot).toMatch(/[A-Za-z]{3,}/)
    },
}

/** `onOpen` wired: with an opener the drill rows are note links. Activating the column with the
 *  keyboard opens the drill, and clicking a row link fires the app-wide `bismuth-open` event —
 *  captured into state and shown, so the click is proven rather than assumed. */
export const OnOpenWired: Story = {
    render: () => {
        const view = { type: 'line' as const }
        const [opened, setOpened] = createSignal<string>('nothing yet')
        const onOpenEvent = (e: Event) => setOpened((e as CustomEvent<string>).detail)
        window.addEventListener('bismuth-open', onOpenEvent)
        onCleanup(() => window.removeEventListener('bismuth-open', onOpenEvent))
        return (
            <div>
                <LineView
                    result={sampleViewResult(undefined, { view })}
                    config={sampleBaseConfig({ view })}
                    onOpen={() => {}}
                />
                <div data-testid="opened">opened: {opened()}</div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const pre = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('pre')
            if (!el) throw new Error('plot not mounted yet')
            return el
        })
        pre.focus()
        await userEvent.keyboard('{ArrowRight}{Enter}')
        const link = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('a')
            if (!el) throw new Error('drill has no note link yet')
            return el
        })
        await userEvent.click(link)
        await waitFor(() => expect(canvasElement.textContent).toMatch(/opened: .+\.md/))
    },
}

/** Keyboard only: the plot takes focus, the arrows walk the hover column (the readout follows),
 *  Home/End jump to the ends, Enter opens the drill for the column and Enter again closes it.
 *  No pointer event is dispatched. */
export const KeyboardReach: Story = {
    render: () => {
        const view = { type: 'line' as const }
        return (
            <LineView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
                onOpen={() => {}}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const pre = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('pre')
            if (!el) throw new Error('plot not mounted yet')
            return el
        })
        expect(pre.tabIndex).toBe(0)
        await userEvent.tab()
        expect(document.activeElement).toBe(pre)

        await userEvent.keyboard('{ArrowRight}')
        await waitFor(() => expect(canvasElement.querySelector('[class*="active"]')).not.toBeNull())
        const first = canvasElement.querySelector('[class*="active"]')!.textContent
        await userEvent.keyboard('{End}')
        await waitFor(() =>
            expect(canvasElement.querySelector('[class*="active"]')!.textContent).not.toBe(first),
        )
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(canvas.getByText('clear')).toBeInTheDocument())
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(canvas.queryByText('clear')).toBeNull())
    },
}

/** Space on the focused plot with no hover column is swallowed — the page must not scroll. */
export const SpaceWithoutHoverDoesNotScroll: Story = {
    render: () => {
        const view = { type: 'line' as const }
        return (
            <LineView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const pre = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('pre')
            if (!el) throw new Error('plot not mounted yet')
            return el
        })
        pre.focus()
        const ev = new KeyboardEvent('keydown', {
            key: ' ',
            code: 'Space',
            bubbles: true,
            cancelable: true,
        })
        pre.dispatchEvent(ev)
        expect(ev.defaultPrevented).toBe(true)
        expect(canvasElement.textContent).not.toContain('clear')
    },
}
