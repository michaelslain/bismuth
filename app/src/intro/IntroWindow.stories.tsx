// Visual spec for <IntroWindow>: the borderless frame the intro slides sit in. The decorator stands in
// for VaultIntro's root (a --sp-7 gutter, the window filling the rest). `ShortWindow` proves the footer
// stays on screen at 640px tall, `TallWindow` that a full-height art box grows with the height, and
// `ArtFit` / `ArtFitShortWindow` that a fitted art box takes its art's height and gives way only to the
// copy. All of them prove the art and the copy are one group centred in the body.
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
            display: 'grid',
            'grid-template-rows': 'minmax(0, 1fr)',
            'justify-items': 'center',
            'align-items': 'stretch',
            padding: 'var(--sp-7)',
            background: 'var(--bg)',
            'box-sizing': 'border-box',
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

const slot = (el: HTMLElement, name: string) =>
    el.querySelector(`[data-intro-slot="${name}"]`)! as HTMLElement

/** The frame has no border and no rules, and it carries the `data-intro-window` hook. */
const expectBorderless = async (canvasElement: HTMLElement) => {
    const win = canvasElement.querySelector('[data-intro-window]')! as HTMLElement
    await expect(parseFloat(getComputedStyle(win).borderTopWidth)).toBe(0)
    await expect(parseFloat(getComputedStyle(slot(canvasElement, 'footer').firstElementChild!).borderTopWidth)).toBe(0)
}

/** The bottom padding that lifts the body's group to its optical centre. */
const liftOf = (canvasElement: HTMLElement) =>
    parseFloat(getComputedStyle(slot(canvasElement, 'art').parentElement!).paddingBottom)

/** The art and the copy are one group centred in the body above its lift (the slack above the art
 *  equals the slack below the copy, less the bottom padding), so it sits a little above the middle. */
const expectCentred = async (canvasElement: HTMLElement) => {
    const body = slot(canvasElement, 'art').parentElement!.getBoundingClientRect()
    const art = slot(canvasElement, 'art').getBoundingClientRect()
    const text = slot(canvasElement, 'text').getBoundingClientRect()
    const lift = liftOf(canvasElement)
    await expect(lift).toBeGreaterThan(0)
    await expect(Math.abs((art.top - body.top) - (body.bottom - lift - text.bottom))).toBeLessThan(2)
    await expect(art.top).toBeGreaterThanOrEqual(body.top - 1)
    await expect(text.bottom).toBeLessThanOrEqual(body.bottom + 1)
}

/** A 640px-tall container: the footer stays inside the window. */
export const ShortWindow: Story = {
    args,
    decorators: [Stage('640px')],
    play: async ({ canvasElement }) => {
        await expectBorderless(canvasElement)
        await expectCentred(canvasElement)
        await expect(
            slot(canvasElement, 'footer').getBoundingClientRect().bottom,
        ).toBeLessThanOrEqual(canvasElement.getBoundingClientRect().bottom)
    },
}

/** A tall container (900px) with `artFill`: the art box takes the body's art budget, 44% of the body
 *  (above its lift) rounded down to whole rows (over the 15-row floor at this height), and still centres with the
 *  copy. */
export const TallWindow: Story = {
    args: { ...args, artFill: true },
    decorators: [Stage('900px')],
    play: async ({ canvasElement }) => {
        await expectBorderless(canvasElement)
        await expectCentred(canvasElement)
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
        )
        const body = slot(canvasElement, 'art').parentElement!.getBoundingClientRect()
        const artH = slot(canvasElement, 'art').getBoundingClientRect().height
        await expect(artH).toBeGreaterThan(15 * rowH)
        const contentH = body.height - liftOf(canvasElement)
        await expect(Math.abs(artH - Math.floor((0.44 * contentH) / rowH) * rowH)).toBeLessThan(1)
    },
}

/** Art 18 rows tall, past the 15-row art budget, capped at its box and scrolling inside it (the
 *  privacy picker's shape). */
const tallArt = (
    <div style={{ 'max-height': '100%', 'overflow-y': 'auto' }}>
        <div style={{ height: 'calc(18 * var(--row-h))' }}>
            <Text size="ui">art // 18 rows, shown whole</Text>
        </div>
    </div>
)

/** `artFit` at the default 800px stage: the art box is the art's full 18 rows, past the art budget, and
 *  centres with the copy. */
export const ArtFit: Story = {
    args: { ...args, art: tallArt, artFit: true },
    decorators: [Stage('800px')],
    play: async ({ canvasElement }) => {
        await expectCentred(canvasElement)
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
        )
        const art = slot(canvasElement, 'art').getBoundingClientRect()
        await expect(Math.abs(art.height - 18 * rowH)).toBeLessThan(1)
    },
}

/** `artFit` at a 480px stage, too short for the art and the copy: the art box gives way to the copy,
 *  the group still fills the body without spilling, and the art scrolls inside its box. */
export const ArtFitShortWindow: Story = {
    args: { ...args, art: tallArt, artFit: true },
    decorators: [Stage('480px')],
    play: async ({ canvasElement }) => {
        await expectCentred(canvasElement)
        const art = slot(canvasElement, 'art')
        const scroller = art.lastElementChild!.firstElementChild as HTMLElement
        await expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
        await expect(scroller.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            art.getBoundingClientRect().bottom + 1,
        )
    },
}

/** The backdrop slot fills the art box behind the art (the palette slide's graph). */
export const WithBackdrop: Story = {
    args: {
        ...args,
        backdrop: (
            <Text as="div" size="ui" tone="faint">
                {'. '.repeat(2000)}
            </Text>
        ),
        artFill: true,
    },
    decorators: [Stage('100vh')],
}
