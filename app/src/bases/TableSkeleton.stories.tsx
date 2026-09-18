// Visual spec for <TableSkeleton> — the header-row-over-body-rows silhouette BaseSkeleton
// falls back to for every non-cards view kind. Standalone here (vs. BaseSkeleton's stories,
// which exercise it through the `type` prop) so the shape itself — and its per-row width
// stagger — is directly inspectable.
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
}
