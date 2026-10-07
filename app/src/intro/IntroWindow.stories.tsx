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
    art: <Text size="ui">art box // fixed height, content centred</Text>,
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

/** A 640px-tall container: the art box drops to 16 rows and the footer stays inside the window. */
export const ShortWindow: Story = {
    args,
    decorators: [Stage('640px')],
    play: async ({ canvasElement }) => {
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
        )
        const art = canvasElement.querySelector('[data-intro-slot="art"]')!
        await expect(art.getBoundingClientRect().height).toBeCloseTo(16 * rowH, 0)
        const footer = canvasElement.querySelector('[data-intro-slot="footer"]')!
        await expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            canvasElement.getBoundingClientRect().bottom,
        )
    },
}

/** A tall container (900px, over the 44rem step): the full 24-row art box. */
export const TallWindow: Story = {
    args,
    decorators: [Stage('900px')],
    play: async ({ canvasElement }) => {
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
        )
        const art = canvasElement.querySelector('[data-intro-slot="art"]')!
        await expect(art.getBoundingClientRect().height).toBeCloseTo(24 * rowH, 0)
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
