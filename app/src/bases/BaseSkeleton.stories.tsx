// Visual spec for <BaseSkeleton> — the shaped loading placeholder BaseView shows while a
// view's rows are still resolving (before any cached/fetched rows arrive). It paints the
// SILHOUETTE of the view kind rather than a generic spinner, so the pane already reads as
// "this view, loading" the instant it opens.
//
// Only `cards` gets its own silhouette (a grid of cover+text-line outlines); every other
// `ViewType` — table, list, kanban, bar, calendar, … — falls back to the table silhouette
// (a header row over body rows), per the component's own doc comment. The two stories below
// are therefore the WHOLE surface: `Table` exercises every non-cards kind at once (picking
// `kanban` to make that fallback explicit rather than defaulting to the literal `table` type),
// and `Cards` is the one kind with distinct markup.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { BaseSkeleton } from './BaseSkeleton'

const meta = {
    title: 'Bases/BaseSkeleton',
    component: BaseSkeleton,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BaseSkeleton>

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

/** The table silhouette — used for `table` itself and, per the component's fallback rule,
 *  every other non-cards kind (`kanban` here, standing in for the rest). */
export const Table: Story = {
    render: () => (
        <Frame>
            <BaseSkeleton type="kanban" />
        </Frame>
    ),
}

/** The cards silhouette — the one kind with dedicated markup (a grid of cover-bar +
 *  two-text-line card outlines) instead of the table fallback. */
export const Cards: Story = {
    render: () => (
        <Frame>
            <BaseSkeleton type="cards" />
        </Frame>
    ),
}
