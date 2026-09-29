// Visual spec for <TableSkeleton> — the header-row-over-body-rows silhouette BaseSkeleton
// falls back to for every non-cards view kind. Standalone here (vs. BaseSkeleton's stories,
// which exercise it through the `type` prop) so the shape itself — and its per-row width
// stagger — is directly inspectable.
import { expect } from 'storybook/test'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TableSkeleton } from './TableSkeleton'

const meta = {
    title: 'Bases/TableSkeleton',
    component: TableSkeleton,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TableSkeleton>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: unknown }) => (
    <div
        style={{
            height: '360px',
            width: '520px',
            border: '1px solid var(--border-soft)',
            display: 'flex',
            'flex-direction': 'column',
        }}
    >
        {props.children as never}
    </div>
)

/** Header row + eight body rows, with alternating rows narrowing a different cell so the
 *  placeholder doesn't read as a perfect grid. */
export const Default: Story = {
    render: () => (
        <Frame>
            <TableSkeleton />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        // header + 8 body rows of 4 bars each
        expect(canvasElement.children[0].children[0].children.length).toBe(9)
        expect(canvasElement.children[0].children[0].children[1].children.length).toBe(4)
    },
}

/** Fewer rows and columns — the `rows`/`columns` props resize the silhouette. */
export const Compact: Story = {
    render: () => (
        <Frame>
            <TableSkeleton rows={3} columns={2} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.children[0].children[0].children.length).toBe(4)
        expect(canvasElement.children[0].children[0].children[1].children.length).toBe(2)
    },
}
