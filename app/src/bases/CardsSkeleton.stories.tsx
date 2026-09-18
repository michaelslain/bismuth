// Visual spec for <CardsSkeleton> — the grid of cover+text-line card outlines BaseSkeleton
// shows for the `cards` view kind. Standalone here (vs. BaseSkeleton's stories, which
// exercise it through the `type` prop) so the card outline itself is directly inspectable.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { CardsSkeleton } from './CardsSkeleton'

const meta = {
    title: 'Bases/CardsSkeleton',
    component: CardsSkeleton,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardsSkeleton>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: unknown }) => (
    <div
        style={{
            height: '360px',
            width: '720px',
            border: '1px solid var(--border-soft)',
            display: 'flex',
        }}
    >
        {props.children as never}
    </div>
)

/** A grid of ten card outlines — cover bar over two placeholder text lines. */
export const Default: Story = {
    render: () => (
        <Frame>
            <CardsSkeleton />
        </Frame>
    ),
}
