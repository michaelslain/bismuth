// Visual spec for <ChartFrame> — the outer padding/scroll/empty-state chrome shared by
// Bar/Heatmap/Line/Stat views, extracted out of the old bases/Charts.module.css (imported
// directly by all four). See ChartFrame.tsx for why.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChartFrame from './ChartFrame'

const meta = {
    title: 'Bases/ChartFrame',
    component: ChartFrame,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChartFrame>

export default meta
type Story = StoryObj<typeof meta>

/** Populated: renders its children as-is inside the padded/scrollable frame. */
export const WithContent: Story = {
    args: {
        empty: false,
        emptyMessage: 'No data to chart.',
        children: <div>chart content goes here</div>,
    },
}

/** Empty: `emptyMessage` renders centered instead of `children`. */
export const Empty: Story = {
    args: {
        empty: true,
        emptyMessage: 'No data to chart.',
        children: <div>chart content goes here</div>,
    },
}
