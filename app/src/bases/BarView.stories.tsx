// Visual spec for <BarView> — the ASCII bar chart renderer, driven by `buildChartData`
// (core/src/bases/chart.ts) over `result.groups`. The curated sample dataset's `due` column
// auto-detects as the date x-axis and `priority` as the numeric y-axis (see chart.ts's
// auto-detection), so the default config already produces a real chart with no explicit
// `x`/`y`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import { BarView } from './BarView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import type { Row } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/BarView',
    component: BarView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BarView>

export default meta
type Story = StoryObj<typeof meta>

/** Auto-detected axes: `due` (date, >=50% of rows parse as ISO) on x, `priority` (the first
 *  numeric column) summed on y — one bar per due date. */
export const Default: Story = {
    render: () => {
        const views = [{ type: 'bar' as const, name: 'Chart' }]
        return (
            <div style={{ width: '900px' }}>
                <BarView
                    result={sampleViewResult(undefined, { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
}

/** Explicit categorical `x`/`aggregate: "count"` — one bar per `status` value, counting rows
 *  instead of summing a numeric column. */
export const GroupedByStatusCount: Story = {
    render: () => {
        const views = [
            {
                type: 'bar' as const,
                name: 'By status',
                x: 'status',
                aggregate: 'count' as const,
            },
        ]
        return (
            <div style={{ width: '900px' }}>
                <BarView
                    result={sampleViewResult(undefined, { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
}

/** Real interaction: hover a row (readout switches to the bucket's own line), click it (a drill
 *  list opens under the chart), click `[ clear ]` (it closes). Deterministic waits on the
 *  rendered DOM, never a sleep. */
export const HoverAndDrill: Story = {
    render: () => {
        const views = [
            { type: 'bar' as const, name: 'By status', x: 'status', aggregate: 'count' as const },
        ]
        return (
            <div style={{ width: '900px' }}>
                <BarView
                    result={sampleViewResult(undefined, { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const row = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('[data-bucket]')
            if (!el) throw new Error('no bar row mounted yet')
            return el
        })
        const key = row.dataset.bucket

        // A count chart's header names both axes: `status` over the labels, `notes` over the
        // value column — and never duplicates the value as a raw number in the hover line.
        await waitFor(() => {
            expect(canvasElement.textContent).toContain('status')
            expect(canvasElement.textContent).toContain('notes')
        })

        // Hovering switches the readout to the bucket's own line — a count chart collapses to
        // `<key> // N notes` (no separately-labelled value, since it duplicates the count).
        await userEvent.hover(row)
        await waitFor(
            () => {
                expect(canvasElement.textContent).toContain(`${key} // `)
                expect(canvasElement.textContent).toContain('notes')
            },
            { timeout: 5000 },
        )

        // Hovering must not rebuild the rows — the node under the pointer stays the same one.
        expect(row.isConnected).toBe(true)

        // Clicking opens the drill list under the chart — a header plus a `[ clear ]` button —
        // and marks the selected row's own label with a `>` lead-in.
        // Re-query by bucket so a legitimate re-layout never leaves the click on a detached node.
        const target = canvasElement.querySelector<HTMLElement>(`[data-bucket="${key}"]`)
        if (!target) throw new Error(`row ${key} vanished`)
        await userEvent.click(target)
        await waitFor(() => {
            expect(target.textContent?.trimStart().startsWith('>')).toBe(true)
        })
        const clearButton = await waitFor(
            () => {
                const btn = Array.from(canvasElement.querySelectorAll('button')).find(b =>
                    b.textContent?.toLowerCase().includes('clear'),
                )
                if (!btn) throw new Error('drill not open yet')
                return btn
            },
            { timeout: 5000 },
        )

        // Clicking clear closes it — the `[ clear ]` button is gone (the bar rows stay: they are
        // buttons themselves).
        await userEvent.click(clearButton)
        await waitFor(
            () => {
                const left = Array.from(canvasElement.querySelectorAll('button')).find(b =>
                    b.textContent?.toLowerCase().includes('clear'),
                )
                expect(left).toBeUndefined()
            },
            { timeout: 5000 },
        )
    },
}

/** Keyboard only: Tab reaches a bar row (a real button), focus alone shows its readout, Enter
 *  opens the drill and Space closes it again. No pointer event is dispatched. */
export const KeyboardReach: Story = {
    render: () => {
        const views = [
            { type: 'bar' as const, name: 'By status', x: 'status', aggregate: 'count' as const },
        ]
        return (
            <div style={{ width: '900px' }}>
                <BarView
                    result={sampleViewResult(undefined, { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const first = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('[data-bucket]')
            if (!el) throw new Error('no bar row mounted yet')
            return el
        })
        const key = first.dataset.bucket!
        const row = () => canvasElement.querySelector<HTMLElement>(`[data-bucket="${key}"]`)!
        expect(first.tagName).toBe('BUTTON')
        await userEvent.tab()
        expect(document.activeElement).toBe(first)
        await waitFor(() => expect(canvasElement.textContent).toContain(`${key} // `))
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(row().getAttribute('aria-pressed')).toBe('true'))
        // Opening the drill must not cost the keyboard user their place.
        expect(document.activeElement).toBe(row())
        await userEvent.keyboard(' ')
        await waitFor(() => expect(row().getAttribute('aria-pressed')).toBe('false'))
    },
}

/** No rows at all: the one shared empty state, not a blank pane. */
export const Empty: Story = {
    render: () => {
        const views = [{ type: 'bar' as const, name: 'Chart' }]
        return (
            <div style={{ width: '900px' }}>
                <BarView
                    result={sampleViewResult([], { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('no data to chart'))
    },
}

function categoryRows(values: number[]): Partial<Row>[] {
    return values.map((v, i) => ({
        note: { category: `Cat ${i + 1}`, amount: v },
    }))
}

function labeledRows(labels: string[], values: number[]): Partial<Row>[] {
    return labels.map((label, i) => ({
        note: { category: label, amount: values[i] },
    }))
}

/** Negative values clamp to zero fill — a row with a negative amount draws no bar, only its
 *  label and value. */
export const NegativeValues: Story = {
    render: () => {
        const views = [
            {
                type: 'bar' as const,
                name: 'Amounts',
                x: 'category',
                y: 'amount',
                aggregate: 'sum' as const,
            },
        ]
        const rows = categoryRows([-4, 2, -1, 7, 0])
        return (
            <div style={{ width: '900px' }}>
                <BarView
                    result={sampleViewResult(rows, { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
}

/** Sixty categories — the view scrolls vertically inside its pane rather than shrinking rows
 *  past legibility. */
export const SixtyCategories: Story = {
    render: () => {
        const views = [
            {
                type: 'bar' as const,
                name: 'Categories',
                x: 'category',
                y: 'amount',
                aggregate: 'sum' as const,
            },
        ]
        const rows = categoryRows(Array.from({ length: 60 }, (_, i) => (i % 7) + 1))
        return (
            <div style={{ width: '900px', height: '480px' }}>
                <BarView
                    result={sampleViewResult(rows, { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
}

/** Long labels + values in the hundreds inside a 300px pane — labels truncate with `…` and the
 *  bar/track widths never go negative (regression for the barWidth clamp). */
export const LongLabelsNarrow: Story = {
    render: () => {
        const views = [
            {
                type: 'bar' as const,
                name: 'Amounts',
                x: 'category',
                y: 'amount',
                aggregate: 'sum' as const,
            },
        ]
        const rows = labeledRows(
            [
                'Waiting on review from legal',
                'Blocked on design sign-off',
                'Needs a follow-up call',
                'Ready to ship',
            ],
            [120, 340, 275, 512],
        )
        return (
            <div style={{ width: '300px' }}>
                <BarView
                    result={sampleViewResult(rows, { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
}

/** A ~300px pane — columns floor at 20; rows still lay out without overflow. */
export const Narrow: Story = {
    render: () => {
        const views = [
            { type: 'bar' as const, name: 'By status', x: 'status', aggregate: 'count' as const },
        ]
        return (
            <div style={{ width: '300px' }}>
                <BarView
                    result={sampleViewResult(undefined, { views })}
                    config={sampleBaseConfig({ views })}
                    onOpen={() => {}}
                />
            </div>
        )
    },
}
