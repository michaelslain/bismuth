// The absent-value placeholder, in the contexts it actually appears in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import EmptyValue from './EmptyValue'
import Text from './Text'

const meta = {
    title: 'UI/EmptyValue',
    component: EmptyValue,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof EmptyValue>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <EmptyValue /> }

/**
 * Beside real values — the comparison that matters. The placeholder must read as ABSENCE and not
 * as a value in its own right, so it has to be visibly quieter than the text around it while still
 * holding the column's alignment.
 */
export const InAColumn: Story = {
    render: () => (
        <div
            style={{
                background: 'var(--bg)',
                padding: 'var(--sp-5)',
                display: 'flex',
                'flex-direction': 'column',
                gap: 'var(--sp-2)',
                'min-width': '220px',
            }}
        >
            <Text>a real value</Text>
            <EmptyValue />
            <Text>another real value</Text>
            <EmptyValue>none</EmptyValue>
        </div>
    ),
}
