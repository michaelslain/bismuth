// Visual spec for <DragGhost> — the translucent block previewing an event being created (accent)
// or moved (its category colour) inside a time-grid day column. Its box comes from
// timeGridLayout's `ghostBox`, so a story feeds it the real geometry.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import DragGhost from './DragGhost'
import { ghostBox, GRID_PX } from './timeGridLayout'
import { categoryFill } from '../../categoryColor'

const meta = {
    title: 'Calendar/Views/DragGhost',
    component: DragGhost,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DragGhost>

export default meta
type Story = StoryObj<typeof meta>

const Column = (props: { start: number; end: number; color: string }) => {
    const box = ghostBox(props.start, props.end)
    return (
        <div style={{ position: 'relative', width: '180px', height: `${GRID_PX / 4}px`, border: '1px solid var(--border-soft)' }}>
            <DragGhost {...box} startMin={props.start} color={props.color} />
        </div>
    )
}

export const Create: Story = {
    render: () => <Column start={60} end={120} color="var(--accent)" />,
    play: async ({ canvasElement }) => {
        const ghost = within(canvasElement).getByTestId('drag-ghost')
        expect(ghost.textContent).toContain('—')
        expect(Math.round(ghost.getBoundingClientRect().height)).toBe(Math.round(ghostBox(60, 120).height))
        expect(getComputedStyle(ghost).pointerEvents).toBe('none')
    },
}

export const ShortFloorsToFifteenMinutes: Story = {
    render: () => <Column start={90} end={90} color="var(--teal)" />,
    play: async ({ canvasElement }) => {
        const ghost = within(canvasElement).getByTestId('drag-ghost')
        expect(Math.round(ghost.getBoundingClientRect().height)).toBe(Math.round(ghostBox(90, 90).height))
    },
}

// ---- event-look comparison — phase 2 keeps one ----------------------------------------------

/** The ghost under each candidate look (an ancestor `data-event-look`): a create (accent) and a
 *  move of a two-category event (the categoryFill bands). */
export const Looks: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '16px' }}>
            {(['tint', 'outline', 'solid'] as const).map(look => (
                <div data-event-look={look} style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                    <Column start={60} end={120} color="var(--accent)" />
                    <Column
                        start={60}
                        end={120}
                        color={categoryFill(['var(--blue)', 'var(--violet)'])!}
                    />
                </div>
            ))}
        </div>
    ),
}
