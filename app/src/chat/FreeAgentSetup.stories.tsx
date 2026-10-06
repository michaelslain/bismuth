// Visual spec for <FreeAgentSetup> — one story per phase; progress is a plain prop so every shot is
// deterministic (the polling lives in ChatSetupGate).
import { expect } from 'storybook/test'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import FreeAgentSetup from './FreeAgentSetup'

const meta = {
    title: 'Chat/FreeAgentSetup',
    component: FreeAgentSetup,
    parameters: { layout: 'centered' },
    args: { progress: { phase: 'idle' }, onStart: () => {} },
} satisfies Meta<typeof FreeAgentSetup>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('set up free agent')
    },
}
/** The start button lives in the setup screen's agent row: idle is just the footnote. */
export const Buttonless: Story = {
    args: { buttonless: true },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('button').length).toBe(0)
        await expect(canvasElement.textContent).toContain('runs opencode on free models')
    },
}
export const Downloading: Story = {
    args: { progress: { phase: 'downloading', received: 12e6, total: 45e6 } },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('downloading opencode  12 / 45 MB')
    },
}
export const Verifying: Story = {
    args: { progress: { phase: 'verifying' } },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('checking the download…')
    },
}
export const Installing: Story = {
    args: { progress: { phase: 'installing' } },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('installing…')
    },
}
export const Error: Story = {
    args: { progress: { phase: 'error', message: 'checksum did not match' } },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain("couldn't set up the free agent: checksum did not match")
    },
}
export const Unsupported: Story = {
    args: {
        progress: {
            phase: 'error',
            message: 'opencode has no build for this platform',
        },
    },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain(
            'opencode has no build for this platform',
        )
    },
}
