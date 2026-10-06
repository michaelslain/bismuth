// The begin slide's prompt line, alone.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import IntroPrompt from './IntroPrompt'

const meta = {
    title: 'Intro/IntroPrompt',
    component: IntroPrompt,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof IntroPrompt>

export default meta
type Story = StoryObj<typeof meta>

/** `> open vault_` — accent chevron, foreground text, the blinking caret. */
export const Default: Story = {
    args: { text: 'open vault' },
    play: ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('> open vault')
    },
}
