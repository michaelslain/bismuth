// Visual spec for <DragGhost> — the block previewing an event being created (accent) or moved
// (its category colours, in the event chip's frame + wash) inside a time-grid day column. Its box comes from
// timeGridLayout's `ghostBox`, so a story feeds it the real geometry.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import DragGhost from './DragGhost'
import { ghostBox, GRID_PX } from './timeGridLayout'

const meta = {
    title: 'Calendar/Views/DragGhost',
    component: DragGhost,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DragGhost>

export default meta
type Story = StoryObj<typeof meta>

const Column = (props: { start: number; end: number; colors: string[] }) => {
    const box = ghostBox(props.start, props.end)
    return (
        <div style={{ position: 'relative', width: '180px', height: `${GRID_PX / 4}px`, border: '1px solid var(--border-soft)' }}>
            <DragGhost {...box} startMin={props.start} colors={props.colors} />
        </div>
    )
}

export const Create: Story = {
    render: () => <Column start={60} end={120} colors={[]} />,
    play: async ({ canvasElement }) => {
        const ghost = within(canvasElement).getByTestId('drag-ghost')
        expect(ghost.textContent).toContain('—')
        expect(Math.round(ghost.getBoundingClientRect().height)).toBe(Math.round(ghostBox(60, 120).height))
        expect(getComputedStyle(ghost).pointerEvents).toBe('none')
    },
}

export const ShortFloorsToFifteenMinutes: Story = {
    render: () => <Column start={90} end={90} colors={['var(--teal)']} />,
    play: async ({ canvasElement }) => {
        const ghost = within(canvasElement).getByTestId('drag-ghost')
        expect(Math.round(ghost.getBoundingClientRect().height)).toBe(Math.round(ghostBox(90, 90).height))
    },
}

/** Moving a two-category event: the ghost's frame splits into both categories and its wash stays
 *  the first category's — the same reading as the event chip, never a half-and-half fill. */
export const MoveTwoCategories: Story = {
    render: () => <Column start={60} end={120} colors={['var(--blue)', 'var(--violet)']} />,
    play: async ({ canvasElement }) => {
        const ghost = within(canvasElement).getByTestId('drag-ghost')
        expect(getComputedStyle(ghost).borderImageSource).toContain('linear-gradient')
    },
}
