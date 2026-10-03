// Visual spec for <IntroFrame> — the one geometry every intro slide sits on. The play() below is the
// real proof: whatever is (or is not) in the hero box, and however long the copy runs, the hero,
// text and nav slots keep the SAME top in the same wrapper.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import Heading from '../ui/Heading'
import Text from '../ui/Text'
import IntroFrame from './IntroFrame'
import IntroNav from './IntroNav'

const meta = {
    title: 'Intro/IntroFrame',
    component: IntroFrame,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof IntroFrame>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const nav = (
    <IntroNav index={2} count={7} onPrev={noop} onNext={noop} onSelect={noop} />
)

const copy = (body: string): JSX.Element => (
    <>
        <Heading level={1} size="hero-xl" register="prose">
            Headline sits here
        </Heading>
        <Text size="title" register="prose" tone="muted">
            {body}
        </Text>
    </>
)

const SHORT = 'One short line of body copy.'
const LONG =
    'A longer body that runs to four lines in the text slot. It keeps going so the paragraph wraps ' +
    'more than once, and the frame has to prove that a taller block of copy never pushes the hero box, ' +
    'the headline or the nav to a different height than a one-line body does. More words, more lines, ' +
    'and still the same three tops on the page.'

/** A wrapper at the intro's reference window. The frame is height:100%, so this fixes its box. */
const Stage = (props: { w: number; h: number; children: JSX.Element }) => (
    <div
        data-intro-stage
        style={{
            position: 'relative',
            width: `${props.w}px`,
            height: `${props.h}px`,
            background: 'var(--bg)',
            color: 'var(--fg)',
        }}
    >
        {props.children}
    </div>
)

/** Story-only layout probe: fills the hero box so its edges are visible. Not a design element. */
const ProbeFill = () => (
    <div
        data-story-probe="hero-box"
        style={{
            width: '100%',
            height: '100%',
            outline: '1px dashed var(--border)',
            'outline-offset': '-1px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
        }}
    >
        <Text size="micro" tone="faint">
            hero box (story-only layout probe)
        </Text>
    </div>
)

/** Slot tops measured once in the 1280x912 wrapper below (outer rows 1fr, hero 16 rows x 1.5 glyph scale = 432px,
 *  text 11 rows = 198px, nav row auto at 64px: the two 1fr rows split 912 - 432 - 198 - 64 = 218, so 109 each).
 *  Every 1280x912 story must land on these, whatever it puts in the slots. Relative to the stage. */
const EXPECTED = { hero: 109, text: 541, nav: 848 }

const slotTops = (canvasElement: HTMLElement) => {
    const stage = canvasElement.querySelector(
        '[data-intro-stage]',
    ) as HTMLElement
    const base = stage.getBoundingClientRect().top
    const top = (slot: string) =>
        (
            stage.querySelector(`[data-intro-slot="${slot}"]`) as HTMLElement
        ).getBoundingClientRect().top - base
    return { hero: top('hero'), text: top('text'), nav: top('nav') }
}

const expectGeometry = async (canvasElement: HTMLElement) => {
    const got = slotTops(canvasElement)
    await expect(got.hero).toBeCloseTo(EXPECTED.hero, 0)
    await expect(got.text).toBeCloseTo(EXPECTED.text, 0)
    await expect(got.nav).toBeCloseTo(EXPECTED.nav, 0)
}

/** No hero content (the graph slide): the box is still reserved. */
export const HeroEmpty: Story = {
    args: { variant: 'hero', text: copy(SHORT), nav },
    render: args => (
        <Stage w={1280} h={912}>
            <IntroFrame {...args} />
        </Stage>
    ),
    play: async ({ canvasElement }) => expectGeometry(canvasElement),
}

export const HeroFilled: Story = {
    args: { variant: 'hero', hero: <ProbeFill />, text: copy(SHORT), nav },
    render: args => (
        <Stage w={1280} h={912}>
            <IntroFrame {...args} />
        </Stage>
    ),
    /** The box is 16 rows tall and 96 cells wide at full scale, times the intro's 1.5 glyph scale, centred on the stage. */
    play: async ({ canvasElement }) => {
        const stage = canvasElement.querySelector(
            '[data-intro-stage]',
        ) as HTMLElement
        const box = stage
            .querySelector('[data-intro-slot="hero"]')!
            .getBoundingClientRect()
        const s = stage.getBoundingClientRect()
        const cs = getComputedStyle(stage)
        const row = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
                '--row-h',
            ),
        )
        const cell = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
                '--cell-w',
            ),
        )
        await expect(cs.position).toBe('relative')
        await expect(box.height).toBeCloseTo(16 * row * 1.5, 0)
        await expect(box.width).toBeCloseTo(96 * cell * 1.5, 0)
        await expect(box.left + box.width / 2).toBeCloseTo(
            s.left + s.width / 2,
            0,
        )
    },
}

/** A control in the box (theme cards, the power-up list): centred, the box does not grow. */
export const Setup: Story = {
    args: {
        variant: 'setup',
        hero: <Text tone="muted">a short centred control</Text>,
        text: copy(SHORT),
        nav,
    },
    render: args => (
        <Stage w={1280} h={912}>
            <IntroFrame {...args} />
        </Stage>
    ),
    play: async ({ canvasElement }) => expectGeometry(canvasElement),
}

/** A 4-line body: the text slot is a fixed track, so nothing above or below it moves. */
export const LongText: Story = {
    args: { variant: 'hero', hero: <ProbeFill />, text: copy(LONG), nav },
    render: args => (
        <Stage w={1280} h={912}>
            <IntroFrame {...args} />
        </Stage>
    ),
    play: async ({ canvasElement }) => expectGeometry(canvasElement),
}

/** A short window. The full-scale grid needs 726px (432 hero + 198 text + 64 nav + the two outer rows'
 *  16px minimums), so this stage is the smallest that holds it. The hero box's 0.75 scale comes from a viewport media query (max-height 50rem),
 *  so it only bites when the Storybook viewport itself is under 800px tall. */
export const Compact: Story = {
    args: { variant: 'hero', hero: <ProbeFill />, text: copy(SHORT), nav },
    render: args => (
        <Stage w={900} h={726}>
            <IntroFrame {...args} />
        </Stage>
    ),
    /** Whatever scale the viewport picks, the three slots stay in order and inside the stage. */
    play: async ({ canvasElement }) => {
        const stage = canvasElement.querySelector(
            '[data-intro-stage]',
        ) as HTMLElement
        const rect = (slot: string) =>
            stage
                .querySelector(`[data-intro-slot="${slot}"]`)!
                .getBoundingClientRect()
        const hero = rect('hero')
        const text = rect('text')
        const nav = rect('nav')
        const s = stage.getBoundingClientRect()
        await expect(hero.top).toBeGreaterThanOrEqual(s.top)
        await expect(text.top).toBeCloseTo(hero.bottom, 0)
        await expect(nav.top).toBeGreaterThanOrEqual(text.bottom - 1)
        await expect(nav.bottom).toBeLessThanOrEqual(s.bottom + 1)
    },
}
