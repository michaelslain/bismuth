// The per-slide hero of the first-run intro, one story per kind, each drawn at a pinned time well
// past its scene's reveal so the frame is the resting one. The wrapper is the hero box IntroFrame
// gives it (96 x 16 cells at IntroFrame's 1.5 `--intro-glyph-scale`). Canvas proof is pixels: each play counts inked pixels on the canvas.
// `WordmarkLive` has no pinned time, so the real loop runs.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import type { JSX } from 'solid-js'
import { agentsScene } from './glyphScenes/agents'
import { beginScene } from './glyphScenes/begin'
import { daemonScene } from './glyphScenes/daemon'
import { wordmarkScene } from './glyphScenes/wordmark'
import IntroHero from './IntroHero'

const meta = {
    title: 'Intro/IntroHero',
    component: IntroHero,
    parameters: { layout: 'centered' },
    decorators: [
        (Story: () => JSX.Element) => (
            <div
                style={{
                    width: 'calc(96 * var(--cell-w) * 1.5)',
                    height: 'calc(16 * var(--row-h) * 1.5)',
                }}
            >
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof IntroHero>

export default meta
type Story = StoryObj<typeof meta>

/** Fraction of the canvas's pixels with any ink (alpha > 0). */
const inked = (canvas: HTMLCanvasElement): number => {
    const d = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n / (d.length / 4)
}

const expectInked = async (root: HTMLElement) => {
    const canvas = await waitFor(() => {
        const c = root.querySelector('canvas')
        if (!c) throw new Error('no canvas mounted')
        return c
    })
    await waitFor(() => expect(inked(canvas)).toBeGreaterThan(0.01))
}

/** The welcome slide: the `bismuth` block-letter wordmark over a sparse noise field. */
export const Wordmark: Story = {
    args: { hero: 'wordmark', at: wordmarkScene.revealMs + 3000 },
    play: ({ canvasElement }) => expectInked(canvasElement),
}

/** The daemon slide: `> bismuth daemon status`, three cron rows and a log. */
export const Daemon: Story = {
    args: { hero: 'daemon', at: daemonScene.revealMs + 3000 },
    play: ({ canvasElement }) => expectInked(canvasElement),
}

/** The agents slide: six agent names converging on `[ mcp ]` over `( vault )`. */
export const Agents: Story = {
    args: { hero: 'agents', at: agentsScene.revealMs + 3000 },
    play: ({ canvasElement }) => expectInked(canvasElement),
}

/** The begin slide: the formed wordmark over the `> open vault_` prompt. */
export const Begin: Story = {
    args: { hero: 'begin', at: beginScene.revealMs + 3000 },
    play: ({ canvasElement }) => expectInked(canvasElement),
}

/** The welcome wordmark with no pinned time: the real animation loop (reveal, then sheen). */
export const WordmarkLive: Story = {
    args: { hero: 'wordmark' },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            if (!canvasElement.querySelector('canvas'))
                throw new Error('no canvas mounted')
        })
        const host = canvasElement.querySelector('[role="img"]')!
        await expect(host.getAttribute('aria-label')).toBe('bismuth')
    },
}
