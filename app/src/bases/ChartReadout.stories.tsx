import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChartReadout from './ChartReadout'

const narrowDecorator = (Story: () => JSX.Element) => (
    <div style={{ width: '220px' }}>
        <Story />
    </div>
)

const meta = {
    title: 'Bases/ChartReadout',
    component: ChartReadout,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChartReadout>

export default meta
type Story = StoryObj<typeof meta>

/** At rest: the caption + peak, muted. */
export const AtRest: Story = {
    args: {
        parts: ['sum of priority by week of due', 'peak 3 (Jul 1)'],
    },
}

/** Hovering a bucket: `--fg`, date // value // note count. */
export const Active: Story = {
    args: {
        parts: ['Jul 20', '3', '2 notes'],
        active: true,
    },
}

/** A long readout in a narrow pane ellipsizes instead of wrapping. */
export const Overflowing: Story = {
    args: {
        parts: [
            'sum of priority by week of due for every note tagged reading in the last year',
            'peak 42 (Jul 1) across every bucket in the whole dataset',
        ],
    },
    decorators: [narrowDecorator],
}
