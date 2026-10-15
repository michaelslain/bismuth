// Visual spec for <Sheen> — the compositor-driven `--grad` slide, cut to a host's glyphs by an SVG
// text mask. It always sits inside a host that is `.asc-wordmark` (position: relative, transparent
// text); Wordmark and DaemonFace are the two real hosts, and Wordmark.stories carries the
// old-vs-new comparison. This story shows the bare pairing and the two host knobs.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import Sheen from './Sheen'

/** Under `prefers-reduced-motion: reduce` the layer's `animation` is `none` (and its play-state
 *  resets to `running`), so the animation assertions read the preference and grade that mode's
 *  contract instead of assuming motion is on. */
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const meta = {
    title: 'UI/Sheen',
    component: Sheen,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof Sheen>

export default meta
type Story = StoryObj<typeof meta>

/** A host line with the real class: the text lays out, the Sheen paints it. */
export const Default: Story = {
    args: { parts: [{ text: 'bismuth' }] },
    render: args => (
        <span
            class="asc-wordmark"
            style={{ '--wordmark-size': '48px', '--wordmark-tracking': '0.04em' }}
        >
            bismuth
            <Sheen {...args} />
        </span>
    ),
    play: async ({ canvasElement }) => {
        const host = canvasElement.querySelector('.asc-wordmark') as HTMLElement
        const sheen = host.querySelector('span[aria-hidden]') as HTMLElement
        // Wait on the observed state (the mask reference resolved to a mounted <mask>), not a clock.
        let mask: SVGMaskElement | null = null
        await waitFor(() => {
            const maskId = getComputedStyle(sheen).maskImage.match(/#([^")]+)/)?.[1]
            mask = maskId ? host.querySelector(`mask[id="${maskId}"]`) : null
            expect(mask).not.toBeNull()
        })
        const resolved = mask as unknown as SVGMaskElement
        // The mask region must cover the host's box in resolved px. A percentage resolves against
        // the 0x0 defs <svg> in Chrome, which gives a zero-size mask and no glyphs at all.
        const box = sheen.getBoundingClientRect()
        await expect(resolved.width.baseVal.value).toBeGreaterThan(box.width)
        await expect(resolved.height.baseVal.value).toBeGreaterThan(box.height)
        const layer = sheen.firstElementChild as Element
        await waitFor(() => {
            const name = getComputedStyle(layer).animationName
            if (reducedMotion()) expect(name).toBe('none')
            else expect(name).not.toBe('none')
        })
    },
}

/** `--sheen-play: paused` (the asleep daemon face) holds the slide still. */
export const Paused: Story = {
    args: { parts: [{ text: 'bismuth' }] },
    render: args => (
        <span
            class="asc-wordmark"
            style={{
                '--wordmark-size': '48px',
                '--wordmark-tracking': '0.04em',
                '--sheen-play': 'paused',
            }}
        >
            bismuth
            <Sheen {...args} />
        </span>
    ),
    play: async ({ canvasElement }) => {
        const host = canvasElement.querySelector('.asc-wordmark') as HTMLElement
        const layer = host.querySelector('span[aria-hidden]')!.firstElementChild as Element
        // Reduced motion drops the animation outright (`animation: none`), so there is no slide to
        // pause and the play-state falls back to its initial `running`: grade that mode as held still.
        await waitFor(() => {
            if (reducedMotion()) expect(getComputedStyle(layer).animationName).toBe('none')
            else expect(getComputedStyle(layer).animationPlayState).toBe('paused')
        })
    },
}
