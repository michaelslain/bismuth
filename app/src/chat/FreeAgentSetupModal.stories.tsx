// Visual spec for <FreeAgentSetupModal> — the palette's "set up free agent" panel. Progress is a
// plain prop so each shot is deterministic; the polling itself is covered by freeAgentClient.test.
import { expect } from 'storybook/test'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import FreeAgentSetupModal from './FreeAgentSetupModal'

const meta = {
    title: 'Chat/FreeAgentSetupModal',
    component: FreeAgentSetupModal,
    parameters: { layout: 'fullscreen' },
    args: { onClose: () => {} },
} satisfies Meta<typeof FreeAgentSetupModal>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {
    play: async () => {
        await expect(document.body.textContent).toContain('set up free agent')
    },
}
export const Downloading: Story = {
    args: { initialProgress: { phase: 'downloading', received: 12e6, total: 45e6 } },
    play: async () => {
        await expect(document.body.textContent).toContain(
            'downloading opencode  12 / 45 MB',
        )
    },
}
export const Ready: Story = {
    args: { initialProgress: { phase: 'ready' } },
    play: async () => {
        await expect(document.body.textContent).toContain(
            'ready // new opencode chats run on Zen Free (rotating)',
        )
    },
}
