// Visual spec for <Sparkline> — extracted out of StatTiles once the glyphs needed a caption,
// endpoint labels and hover state of their own (user report: "i dont even know what the bars
// here mean").
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import SparklineChart from './SparklineChart'

const meta = {
    title: 'Bases/SparklineChart',
    component: SparklineChart,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof SparklineChart>

export default meta
type Story = StoryObj<typeof meta>

const WEEK_KEYS = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']
const WEEK_LABELS = ['Jul 6', 'Jul 13', 'Jul 20', 'Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21']

/** 12 weekly bins ending "this week" — the caption reads "last 12 weeks", the endpoint
 *  labels read "Jul 6" … "Sep 21", and the last glyph (this week) is `--accent`. */
export const WeeklySeries: Story = {
    args: {
        values: [2, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 12],
        keys: WEEK_KEYS,
        labels: WEEK_LABELS,
        bin: 'week',
    },
}

/** A metric with no time axis renders nothing for this component — StatTiles simply omits
 *  it — so daily bins are the shortest realistic window: a 12-day caption + hover. */
export const DailySeries: Story = {
    args: {
        values: [1, null, 3, 4, 2, 5, 6, 7, 5, 8, 9, 10],
        keys: Array.from({ length: 12 }, (_, i) => `2026-09-${10 + i}`),
        labels: ['Sep 10', 'Sep 11', 'Sep 12', 'Sep 13', 'Sep 14', 'Sep 15', 'Sep 16', 'Sep 17', 'Sep 18', 'Sep 19', 'Sep 20', 'Sep 21'],
        bin: 'day',
    },
}

/** One bucket: no range to show (`last 1 week`), a single glyph at the mid height, and it is the
 *  current bin so it is `--accent`. */
export const SingleBucket: Story = {
    args: { values: [5], keys: ['2026-09-21'], labels: ['Sep 21'], bin: 'week' },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('last 1 week'))
        expect(canvasElement.querySelectorAll('[data-bucket]').length).toBe(1)
        expect(canvasElement.textContent).not.toContain('–')
    },
}

/** Every bin empty: the series has no range, so all glyphs sit on the lowest tick. */
export const AllNull: Story = {
    args: {
        values: [null, null, null, null],
        keys: ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'],
        labels: ['Sep 1', 'Sep 8', 'Sep 15', 'Sep 22'],
        bin: 'week',
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            const glyphs = Array.from(canvasElement.querySelectorAll('[data-bucket]'))
            expect(glyphs.length).toBe(4)
            expect(glyphs.every(g => g.textContent === '▁')).toBe(true)
        })
    },
}

/** `onHover` holds real state: hovering a glyph reports its bin key (shown under the chart),
 *  leaving reports `null`. */
export const OnHover: Story = {
    render: () => {
        const [hovered, setHovered] = createSignal<string | null>(null)
        return (
            <div>
                <SparklineChart
                    values={[2, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 12]}
                    keys={WEEK_KEYS}
                    labels={WEEK_LABELS}
                    bin="week"
                    onHover={setHovered}
                />
                <div data-testid="hovered">hovered: {hovered() ?? 'none'}</div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const glyph = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('[data-bucket="2026-07-13"]')
            if (!el) throw new Error('sparkline not mounted yet')
            return el
        })
        await userEvent.hover(glyph)
        await waitFor(() => expect(canvasElement.textContent).toContain('hovered: 2026-07-13'))
        await userEvent.unhover(glyph)
        await waitFor(() => expect(canvasElement.textContent).toContain('hovered: none'))
    },
}
