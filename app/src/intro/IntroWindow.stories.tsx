// Visual spec for <IntroWindow>: the framed window the intro slides sit in. The decorator stands in
// for VaultIntro's centring parent. `short-window` proves the footer stays on screen at 640px tall.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import Heading from '../ui/Heading'
import Text from '../ui/Text'
import IntroFooter from './IntroFooter'
import IntroWindow from './IntroWindow'

const meta = {
    title: 'Intro/IntroWindow',
    component: IntroWindow,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof IntroWindow>

export default meta
type Story = StoryObj<typeof meta>

const Stage = (height: string) => (Story: () => JSX.Element) => (
    <div
        style={{
            height,
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            background: 'var(--bg)',
            'box-sizing': 'border-box',
            // The size container IntroWindow's short-window step reads (VaultIntro's root is the
            // real one); sizing this box forces the 16-row state.
            'container-type': 'size',
        }}
    >
        <Story />
    </div>
)

const args = {
    art: <Text size="ui">art // centred over the copy</Text>,
    text: (
        <>
            <Heading level={1} size="hero" register="prose">
                Notes that think
            </Heading>
            <Text size="lead" register="prose" tone="muted">
                A vault of plain markdown, with an agent that reads it.
            </Text>
        </>
    ),
    footer: (
        <IntroFooter
            index={0}
            count={7}
            label="welcome"
            onPrev={() => {}}
            onNext={() => {}}
        />
    ),
    onClose: () => {},
}

export const Default: Story = { args, decorators: [Stage('100vh')] }

export const EmptyArt: Story = {
    args: { ...args, art: undefined },
    decorators: [Stage('100vh')],
}

/** The body's height: two --sp-7 paddings, the art height (`--intro-art-h`) and nine copy rows. */
const bodyRows = (canvasElement: HTMLElement) => {
    const rowH = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
    )
    const body = canvasElement.querySelector('[data-intro-slot="art"]')!.parentElement!
    const pad = parseFloat(getComputedStyle(body).paddingTop)
    return (body.getBoundingClientRect().height - 2 * pad) / rowH - 9
}

/** The art and the copy centre as one group: the gap above the art matches the gap below the copy. */
const expectCentred = async (canvasElement: HTMLElement) => {
    const body = canvasElement.querySelector('[data-intro-slot="art"]')!.parentElement!
    const box = body.getBoundingClientRect()
    const art = canvasElement.querySelector('[data-intro-slot="art"]')!.getBoundingClientRect()
    const text = canvasElement.querySelector('[data-intro-slot="text"]')!.getBoundingClientRect()
    await expect(Math.abs(art.top - box.top - (box.bottom - text.bottom))).toBeLessThan(2)
}

/** A 640px-tall container: the art height drops to 16 rows and the footer stays inside the window. */
export const ShortWindow: Story = {
    args,
    decorators: [Stage('640px')],
    play: async ({ canvasElement }) => {
        await expect(bodyRows(canvasElement)).toBeCloseTo(16, 0)
        const footer = canvasElement.querySelector('[data-intro-slot="footer"]')!
        await expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            canvasElement.getBoundingClientRect().bottom,
        )
    },
}

/** A tall container (900px, over the 44rem step): the full 24-row art height, with the art and
 *  the copy centred in the body as one group. */
export const TallWindow: Story = {
    args,
    decorators: [Stage('900px')],
    play: async ({ canvasElement }) => {
        await expect(bodyRows(canvasElement)).toBeCloseTo(24, 0)
        await expectCentred(canvasElement)
    },
}

/** The backdrop slot fills the whole body behind the art and the copy (the palette slide's graph). */
export const WithBackdrop: Story = {
    args: {
        ...args,
        backdrop: (
            <Text as="div" size="ui" tone="faint">
                {'. '.repeat(2000)}
            </Text>
        ),
    },
    decorators: [Stage('100vh')],
}
