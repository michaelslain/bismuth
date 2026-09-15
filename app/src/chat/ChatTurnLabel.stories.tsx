// Visual spec for <ChatTurnLabel> — the quiet speaker label above a turn. Covers Acceptance
// ("Turn labels are lowercase … in the same head style as the daemon panels") and the regression
// it caught: a capitalized persona name (the default "Claude") reaching the DOM as-is because
// Text's `eyebrow` register deliberately never applies a CSS case transform.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatTurnLabel from './ChatTurnLabel'
import Text from '../ui/Text'

const meta = {
    title: 'Chat/ChatTurnLabel',
    component: ChatTurnLabel,
} satisfies Meta<typeof ChatTurnLabel>

export default meta
type Story = StoryObj<typeof meta>

export const You: Story = {
    args: { label: 'you' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('you')).toBeInTheDocument()
    },
}

/** A capitalized persona name (the "Claude" default) must render lowercase — the bug this label
 *  was restyled to fix. */
export const CapitalizedPersona: Story = {
    args: { label: 'Claude' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('claude')).toBeInTheDocument()
        await expect(canvas.queryByText('Claude')).not.toBeInTheDocument()
    },
}

/** The queued-turn trailing slot (note + cancel button) — kept generic in the component. */
export const WithTrailing: Story = {
    args: {
        label: 'you',
        trailing: (
            <Text as="span" size="micro" tone="faint">
                queued
            </Text>
        ),
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('queued')).toBeInTheDocument()
    },
}
