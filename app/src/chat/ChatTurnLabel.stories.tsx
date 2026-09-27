// Visual spec for <ChatTurnLabel> — the quiet speaker label above a turn. Covers Acceptance
// ("Turn labels are lowercase … in the same head style as the daemon panels") and the regression
// it caught: a capitalized persona name (the default "Claude") reaching the DOM as-is because
// Text's `eyebrow` register deliberately never applies a CSS case transform.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatTurnLabel from './ChatTurnLabel'
import Text from '../ui/Text'
import DaemonFace from '../daemon/DaemonFace'

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

/** The transcript's lowest assistant row: the bot's face leads, the name sits to its right on the
 *  same line — face-then-name, so the face never stands in for who you are talking to. */
export const WithAvatar: Story = {
    args: {
        label: 'Sage',
        avatar: <DaemonFace mood="idle" size="avatar" label="sage" />,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const name = canvas.getByText('sage')
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )
        await expect(face).not.toBeNull()
        const f = face!.getBoundingClientRect()
        const n = name.getBoundingClientRect()
        // Name to the RIGHT of the face, on the same line (vertical centres within a few px).
        await expect(n.left).toBeGreaterThan(f.right)
        await expect(
            Math.abs(n.top + n.height / 2 - (f.top + f.height / 2)),
        ).toBeLessThan(4)
    },
}
