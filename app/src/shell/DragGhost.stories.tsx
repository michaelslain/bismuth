// Visual spec for <DragGhost> — the floating chip that follows the cursor while a tab or pane is
// being dragged. `pointer-events: none` so `elementFromPoint` resolves the drop target beneath it;
// no developer sees this outside an actual drag, so the baseline is what actually verifies it.
//
// WHY THIS FILE EXISTS: recorded BEFORE `.drag-ghost`/`.pane` moved from the global App.css into
// DragGhost.module.css, which HASHES every class name — see the plan's THE RECIPE for why the
// recording order is load-bearing.
//
// THREE STORIES: `Tab` — the solid-border resting state for a dragged tab chip. `Pane` — the
// `.pane` state class (dashed border), the only story reaching it since it is a co-riding class
// that hashes to a module local once the CSS half lands. `LongLabel` — the 280px `max-width`
// ellipsis. Position is `fixed` in the real app, so each story wraps in a `position: relative` box
// with enough room to see the ghost sitting away from the origin.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DragGhost } from './DragGhost'

const meta = {
    title: 'Shell/DragGhost',
    component: DragGhost,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DragGhost>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            position: 'relative',
            width: '360px',
            height: '160px',
            border: '1px dashed var(--border-soft)',
        }}
    >
        {props.children as never}
    </div>
)

/** A dragged tab chip — solid border. */
export const Tab: Story = {
    render: () => (
        <Wrap>
            <DragGhost
                label="design-notes.md"
                pane={false}
                x={40}
                y={40}
                width={160}
            />
        </Wrap>
    ),
}

/** A dragged pane — `.pane`, the dashed-border state class. The only story reaching it. */
export const Pane: Story = {
    render: () => (
        <Wrap>
            <DragGhost
                label="Knowledge Graph"
                pane={true}
                x={40}
                y={40}
                width={160}
            />
        </Wrap>
    ),
}

/** A label long enough to exercise the 280px `max-width` ellipsis. */
export const LongLabel: Story = {
    render: () => (
        <Wrap>
            <DragGhost
                label="a-very-long-note-title-that-should-be-truncated-with-an-ellipsis.md"
                pane={false}
                x={20}
                y={40}
                width={280}
            />
        </Wrap>
    ),
}
