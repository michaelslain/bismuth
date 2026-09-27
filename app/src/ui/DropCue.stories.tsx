// Visual spec for <DropCue> — the drag-over affordance a drop host (chat pane, daemon page) lays over
// itself while a draggable is over it. Props: active, className.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
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
export const Inactive: Story = { args: { active: false } }
