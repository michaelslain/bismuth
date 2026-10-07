import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Readout from './Readout'
import NoteLink from './NoteLink'

const narrowDecorator = (Story: () => JSX.Element) => (
    <div style={{ width: '220px' }}>
        <Story />
    </div>
)

const meta = {
    title: 'UI/Readout',
    component: Readout,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Readout>

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
        tone: 'default',
    },
}

/** A part can be an element, not just a string — here a note link inside the line. */
export const WithElementPart: Story = {
    args: {
        parts: [
            'opened from',
            <NoteLink path="projects/Roadmap.md">Roadmap</NoteLink>,
            '3 notes',
        ],
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
