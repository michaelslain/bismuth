// Visual spec for <QueryEmpty> — the one line a base view shows when its query returns nothing.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import QueryEmpty from './QueryEmpty'
import InlineCode from '../ui/InlineCode'

const meta = {
    title: 'Bases/QueryEmpty',
    component: QueryEmpty,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof QueryEmpty>

export default meta
type Story = StoryObj<typeof meta>

/** The default: `no matches`, faint italic, at the view gutter. */
export const Default: Story = {
    render: () => <QueryEmpty />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('no matches')).toBeTruthy()
    },
}

/** A view-specific reason in place of the default, with inline code. */
export const WithReason: Story = {
    render: () => (
        <QueryEmpty>
            add <InlineCode>lat</InlineCode> / <InlineCode>lng</InlineCode> properties to a note
            to pin it
        </QueryEmpty>
    ),
}

/** `flush` drops the gutter, for a frame that already pads by it. */
export const Flush: Story = {
    render: () => <QueryEmpty flush />,
}
