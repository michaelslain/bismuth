// Visual spec for <IntroFooter> — the intro window's footer band: readout left, bracket buttons right.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import IntroFooter from './IntroFooter'

const meta = {
    title: 'Intro/IntroFooter',
    component: IntroFooter,
    parameters: { layout: 'centered' },
    args: {
        index: 0,
        count: 7,
        label: 'welcome',
        onPrev: () => {},
        onNext: () => {},
    },
    decorators: [
        Story => (
            <div
                style={{
                    width: 'calc(140 * var(--cell-w))',
                    background: 'var(--editor)',
                }}
            >
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof IntroFooter>

export default meta
type Story = StoryObj<typeof meta>

export const First: Story = {
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('1/7 // welcome')).toBeTruthy()
        await expect(c.getByRole('button', { name: /back/ })).toBeDisabled()
    },
}

export const Middle: Story = { args: { index: 1, label: 'palette' } }

export const Last: Story = {
    args: { index: 6, label: 'open vault' },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('7/7 // open vault')).toBeTruthy()
        await expect(c.getByRole('button', { name: /enter your vault/ })).toBeEnabled()
    },
}

export const LastBusy: Story = {
    args: { index: 6, label: 'open vault', busy: true },
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByRole('button', { name: /opening…/ }),
        ).toBeDisabled()
    },
}
