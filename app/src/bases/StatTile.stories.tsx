// Visual spec for <StatTile> — one tile of the stat grid, every variant on its own: plain,
// accent, faint, delta, a period + sparkline pair that reacts to hover, a string spark, KaTeX and
// an error. StatTiles.stories.tsx shows them laid out in the grid.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import StatTile from './StatTile'

const meta = {
    title: 'Bases/StatTile',
    component: StatTile,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof StatTile>

export default meta
type Story = StoryObj<typeof meta>

const KEYS = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']
const LABELS = ['Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7']

/** Value + label only, on the default `--fg` value colour. */
export const Plain: Story = {
    args: { label: 'buckets', value: '6' },
}

/** The standout metric: `--accent` value, with a `--faint` delta line under the label. */
export const AccentWithDelta: Story = {
    args: { label: 'total priority', value: '18', tone: 'accent', delta: '+2 latest' },
}

/** A near-empty metric: `--faint` value. */
export const Faint: Story = {
    args: { label: 'overdue', value: '0', tone: 'faint' },
}

/** The full declared-metric tile. Hovering a glyph swaps the period line to that bin's own
 *  value; leaving restores it — the tile holds that state itself. */
export const PeriodAndSparkline: Story = {
    args: {
        label: 'total price',
        value: '42',
        tone: 'accent',
        period: '12 this week // 9 last week',
        spark: { values: [2, 3, 5, 4, 6, 12], keys: KEYS, labels: LABELS, bin: 'week' },
        tex: '\\sum_{n \\in \\text{notes}} n.\\text{price}',
    },
    play: async ({ canvasElement }) => {
        const first = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('[data-bucket="2026-08-03"]')
            if (!el) throw new Error('sparkline not mounted yet')
            return el
        })
        await userEvent.hover(first)
        await waitFor(() => expect(canvasElement.textContent).toContain('week of Aug 3 // 2'))
        await userEvent.unhover(first)
        await waitFor(() => expect(canvasElement.textContent).toContain('12 this week // 9 last week'))
    },
}

/** A plain glyph string as `spark` — non-interactive, no caption. */
export const StringSpark: Story = {
    args: { label: 'trend', value: '9', spark: '▁▂▃▅▆█' },
}

/** A metric that failed to evaluate: `—` and `cannot read: …` in `--danger`. */
export const WithError: Story = {
    args: {
        label: 'bad metric',
        value: '—',
        error: 'priority must be inside sum, avg, min, max or count',
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('cannot read: priority'))
    },
}

/** HeatmapView-style smaller value size via `valueStyle`. */
export const SmallValue: Story = {
    args: { label: 'current streak', value: '3 days', valueStyle: { 'font-size': '22px' } },
}
