// Visual spec for <IntroNav> — the intro's Back / dots / Next row. The forward slot stays
// occupied on the last slide (a hidden copy of Next) so the dot strip stays centred on the stage.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import IntroNav from './IntroNav'

const meta = {
    title: 'Intro/IntroNav',
    component: IntroNav,
    parameters: { layout: 'centered' },
    args: {
        index: 0,
        count: 7,
        onPrev: () => {},
        onNext: () => {},
        onSelect: () => {},
    },
    decorators: [
        Story => (
            <div data-testid="intronav-stage" style={{ width: '480px' }}>
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof IntroNav>

export default meta
type Story = StoryObj<typeof meta>

/** The dot strip's centre must sit on the root's centre, whichever slide is showing. */
const expectCentred = async (canvasElement: HTMLElement) => {
    const root = within(canvasElement).getByTestId('intronav-stage')
        .firstElementChild as HTMLElement
    const strip = within(root).getByLabelText('Go to slide 1')
        .parentElement as HTMLElement
    const mid = (r: DOMRect) => r.left + r.width / 2
    const delta = Math.abs(
        mid(strip.getBoundingClientRect()) - mid(root.getBoundingClientRect()),
    )
    await expect(delta).toBeLessThanOrEqual(1)
}

export const First: Story = {
    play: async ({ canvasElement }) => {
        const back = within(canvasElement).getByRole('button', { name: 'Back' })
        await expect((back as HTMLButtonElement).disabled).toBe(true)
        await expectCentred(canvasElement)
    },
}

export const Middle: Story = {
    args: { index: 3 },
    play: async ({ canvasElement }) => {
        await expectCentred(canvasElement)
    },
}

/** Last slide: Next is replaced by a hidden, inert, IconButton-sized spacer. */
export const Last: Story = {
    args: { index: 6 },
    play: async ({ canvasElement }) => {
        const spacer = canvasElement.querySelector(
            'button[aria-hidden="true"]',
        ) as HTMLButtonElement
        await expect(spacer.disabled).toBe(true)
        await expect(spacer.tabIndex).toBe(-1)
        await expectCentred(canvasElement)
    },
}

/** Over the graph: the --bg drop-shadow keeps the dots legible against the bloom. */
export const Backdrop: Story = {
    args: { index: 3, backdrop: true },
    play: async ({ canvasElement }) => {
        const root = within(canvasElement).getByTestId('intronav-stage')
            .firstElementChild as HTMLElement
        await expect(getComputedStyle(root).filter).toContain('drop-shadow')
        await expectCentred(canvasElement)
    },
}
