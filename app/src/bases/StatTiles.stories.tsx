// Visual spec for <StatTiles> — the plain number/label/delta grid shared by StatView's
// aggregate summary and HeatmapView's streak stats. See StatTiles.tsx for why it's extracted.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import StatTiles from './StatTiles'

const meta = {
    title: 'Bases/StatTiles',
    component: StatTiles,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof StatTiles>

export default meta
type Story = StoryObj<typeof meta>

/** StatView's 4-tile grid: total (accent), average, bucket count, peak (faint when zero). */
export const FourTiles: Story = {
    args: {
        tiles: [
            { label: 'total priority', value: '18', delta: '+2 latest', tone: 'accent' },
            { label: 'average / bucket', value: '3.0' },
            { label: 'buckets', value: '6' },
            { label: 'peak priority', value: '5' },
        ],
    },
}

/** A single tile, StatView's <=1-bucket mode. */
export const SingleTile: Story = {
    args: {
        tiles: [{ label: 'priority', value: '5' }],
    },
}

/** HeatmapView's streak cards: three plain value/label tiles at a smaller value size, no
 *  delta and no tone. */
export const StreakCards: Story = {
    args: {
        tiles: [
            { label: 'entries', value: '12', valueStyle: { 'font-size': '22px' } },
            { label: 'current streak', value: '3 days', valueStyle: { 'font-size': '22px' } },
            { label: 'longest streak', value: '5 days', valueStyle: { 'font-size': '22px' } },
        ],
    },
}

// A 12-week series ending "this week" (index 11), for the sparkline's caption + endpoint
// labels + hover-mapped period line.
const WEEK_KEYS = Array.from({ length: 12 }, (_, i) => `2026-0${i < 4 ? 6 : 7}-${(i % 4) * 7 + 1}`)
const WEEK_LABELS = ['Jul 6', 'Jul 13', 'Jul 20', 'Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21']

/** StatView's full declared-metric tile: value, label, period split, sparkline (caption +
 *  endpoint labels + hoverable glyphs), KaTeX — in acceptance order and tone (period/label
 *  `--text-muted`, current-bin glyph `--accent`, KaTeX `--faint`). */
export const WithMetricFields: Story = {
    args: {
        tiles: [
            {
                label: 'total price',
                value: '42',
                tone: 'accent',
                period: '12 this week // 9 last week',
                spark: {
                    values: [2, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 12],
                    keys: WEEK_KEYS,
                    labels: WEEK_LABELS,
                    bin: 'week',
                },
                tex: '\\sum_{n \\in \\text{notes}} n.\\text{price}',
            },
            {
                label: 'units',
                value: '18',
                period: '5 this week // 4 last week',
                spark: {
                    values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                    keys: WEEK_KEYS,
                    labels: WEEK_LABELS,
                    bin: 'week',
                },
                tex: '\\sum_{n \\in \\text{notes}} n.\\text{units}',
            },
        ],
    },
}

/** A metric that failed to parse/evaluate: `—` for its value, `cannot read: <reason>` in
 *  `--danger` where the KaTeX line would be — the other tile still renders normally. */
export const WithError: Story = {
    args: {
        tiles: [
            {
                label: 'price per unit',
                value: '2.3',
                tone: 'accent',
                tex: '\\frac{\\sum_{n \\in \\text{notes}} n.\\text{price}}{\\sum_{n \\in \\text{notes}} n.\\text{units}}',
            },
            {
                label: 'bad metric',
                value: '—',
                error: 'priority must be inside sum, avg, min, max or count',
            },
        ],
    },
}
