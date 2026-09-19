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
