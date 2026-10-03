// Visual spec for <IntroHeader> — the intro's floating top overlay: the corner LogoMark on the
// left, the skip button on the right. It is `position: absolute`, so each story gives it a
// positioned frame to float in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import IntroHeader from './IntroHeader'

const noop = () => {}

const meta = {
    title: 'Intro/IntroHeader',
    component: IntroHeader,
    parameters: { layout: 'padded' },
    decorators: [
        Story => (
            <div
                style={{
                    position: 'relative',
                    width: '480px',
                    height: '84px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border-soft)',
                }}
            >
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof IntroHeader>

export default meta
type Story = StoryObj<typeof meta>

/** Every slide except welcome/begin: the corner mark shows at left. */
export const WithMark: Story = {
    render: () => (
        <IntroHeader icon="hopper-crystal" showMark={true} onSkip={noop} />
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('img').length).toBe(1)
        await expect(
            canvasElement.querySelector('button[aria-label="Skip intro"]'),
        ).not.toBeNull()
    },
}

/** welcome/begin already show the big centered mark: no corner mark, but skip stays at the
 *  right edge because the slot is still occupied. */
export const WithoutMark: Story = {
    render: () => (
        <IntroHeader icon="hopper-crystal" showMark={false} onSkip={noop} />
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('img').length).toBe(0)
        await expect(
            canvasElement.querySelector('button[aria-label="Skip intro"]'),
        ).not.toBeNull()
    },
}
