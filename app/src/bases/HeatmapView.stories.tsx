// Visual spec for <HeatmapView> — the GitHub-style contribution grid, over the same
// `buildChartData`/`buildHeatmapWeeks` pipeline (core/src/bases/chart.ts) as the other chart
// views, but always day-binned. Requires an `x` that resolves to ISO date strings (or a
// majority-date column for auto-detection) or it renders the empty state.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import type { Row } from '../../../core/src/bases/types'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { HeatmapView } from './HeatmapView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/HeatmapView',
    component: HeatmapView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof HeatmapView>

export default meta
type Story = StoryObj<typeof meta>

function entryRow(i: number, iso: string, words: number): Row {
    return {
        file: {
            name: `entry-${i}`,
            basename: `entry-${i}`,
            path: `journal/entry-${i}.md`,
            folder: 'journal',
            ext: 'md',
            size: 128,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note: { date: iso, words },
        formula: {},
    }
}

/** `x: "due"` explicit (the curated dataset's date column) — a sparse grid spanning the rows'
 *  due dates, plus the streak footer line. */
export const Default: Story = {
    render: () => {
        const views = [{ type: 'heatmap' as const, name: 'Activity', x: 'due' }]
        return (
            <HeatmapView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** A denser dataset — daily entries over three consecutive weeks ending today — so the streak
 *  footer shows a real multi-day run instead of isolated single days. */
export const DenseActivity: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Writing streak', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const rows: Row[] = Array.from({ length: 18 }, (_, i) => {
            const iso = addDaysISO(today, i - 17)
            return entryRow(i, iso, 200 + ((i * 37) % 400))
        })
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** A full year of sparse activity — every 3rd day — spanning month boundaries, to check the
 *  grid spans the whole pane and month labels don't collide. */
export const YearOfData: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Year', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const rows: Row[] = []
        for (let i = 0; i < 365; i += 3) {
            const iso = addDaysISO(today, i - 364)
            rows.push(entryRow(i, iso, 50 + ((i * 13) % 300)))
        }
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** `x` resolves to a non-date column (status) — the empty state must show, not a blank grid. */
export const NonDateX: Story = {
    render: () => {
        const views = [{ type: 'heatmap' as const, name: 'Activity', x: 'status' }]
        return (
            <HeatmapView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** Hover shows the bucket's date/value/note-count in the readout; clicking opens the drill list
 *  of notes behind that day, and clicking again (or `[ clear ]`) closes it. */
export const HoverAndDrill: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Writing streak', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const rows: Row[] = [
            entryRow(0, today, 400),
            entryRow(1, today, 120),
        ]
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const todayCell = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${todayISO()}"]`,
            )
            if (!el) throw new Error('today cell not yet rendered')
            return el
        })
        todayCell.dispatchEvent(
            new PointerEvent('pointerenter', { bubbles: true }),
        )
        await waitFor(() => {
            const active = canvasElement.querySelector('[class*="active"]')
            if (!active) throw new Error('readout not yet active')
            return active
        })
        todayCell.click()
        const clear = await waitFor(() => {
            const btn = Array.from(
                canvasElement.querySelectorAll('button'),
            ).find(b => b.textContent?.includes('clear'))
            if (!btn) throw new Error('drill not yet open')
            return btn
        })
        expect(clear).toBeTruthy()
    },
}

/** The latest entry is a year ago — the grid ends there, not at today, so an idle dataset still
 *  reads as a year of ITS history rather than mostly-empty recent weeks. */
export const OldDataOnly: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Old journal', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const base = addDaysISO(today, -365)
        const rows: Row[] = Array.from({ length: 5 }, (_, i) =>
            entryRow(i, addDaysISO(base, i), 150 + i * 10),
        )
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** A ~300px pane — the grid still renders without horizontal overflow (columns floor at 20). */
export const Narrow: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Writing streak', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const rows: Row[] = Array.from({ length: 10 }, (_, i) =>
            entryRow(i, addDaysISO(today, i - 9), 100 + i * 20),
        )
        return (
            <div style={{ width: '300px' }}>
                <HeatmapView
                    result={sampleViewResult(rows, { views })}
                    config={sampleBaseConfig({ views })}
                />
            </div>
        )
    },
}
