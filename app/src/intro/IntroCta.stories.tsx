// Visual spec for <IntroCta> — the intro's one primary action: `[enter your vault]`, or the
// disabled `[opening…]` while the native folder picker is open.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import IntroCta from './IntroCta'

const meta = {
    title: 'Intro/IntroCta',
    component: IntroCta,
    parameters: { layout: 'centered' },
    args: { busy: false, onEnter: () => {} },
} satisfies Meta<typeof IntroCta>

export default meta
type Story = StoryObj<typeof meta>

/** At rest: enabled, labelled `enter your vault`. */
export const Idle: Story = {
    play: async ({ canvasElement }) => {
        const btn = within(canvasElement).getByRole('button')
        await expect(btn.textContent).toContain('enter your vault')
        await expect((btn as HTMLButtonElement).disabled).toBe(false)
    },
}

/** The picker is open: label flips to `opening…` and the button is disabled. */
export const Busy: Story = {
    args: { busy: true },
    play: async ({ canvasElement }) => {
        const btn = within(canvasElement).getByRole('button')
        await expect(btn.textContent).toContain('opening…')
        await expect((btn as HTMLButtonElement).disabled).toBe(true)
    },
}
