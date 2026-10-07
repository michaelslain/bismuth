// Visual spec for <DropCue> — the drag-over affordance a drop host (chat pane, daemon page) lays over
// itself while a draggable is over it. Props: active, className.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import DropCue from './DropCue'

const meta = {
    title: 'UI/DropCue',
    component: DropCue,
    parameters: { layout: 'centered' },
    args: { active: true },
    render: args => (
        <div
            style={{
                position: 'relative',
                width: '320px',
                height: '180px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
            }}
        >
            <DropCue {...args} />
        </div>
    ),
} satisfies Meta<typeof DropCue>

export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {}
/** `active: false` paints NOTHING: the cue is not mounted at all (no hidden element, no zero-opacity
 *  ring). The frame is therefore the bare host box by design, and the play proves that emptiness
 *  rather than leaving it to be mistaken for a render failure. */
export const Inactive: Story = {
    args: { active: false },
    play: async ({ canvasElement }) => {
        const host = canvasElement.firstElementChild as HTMLElement | null
        expect(host).not.toBeNull()
        expect(host!.children.length).toBe(0)
        expect(canvasElement.querySelector('[aria-hidden="true"]')).toBeNull()
    },
}
