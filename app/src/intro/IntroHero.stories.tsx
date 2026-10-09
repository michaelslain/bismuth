// The per-slide hero of the first-run intro, one story per kind. The wrapper is IntroWindow's art
// box (126 cells x 18 rows) on the window ground. Glyph scenes are drawn at a pinned time well past
// their reveal so the frame is the resting one; canvas proof is pixels (inked fraction).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import type { JSX } from 'solid-js'
import { agentsScene } from './glyphScenes/agents'
import { daemonScene } from './glyphScenes/daemon'
import IntroHero from './IntroHero'

const meta = {
    title: 'Intro/IntroHero',
    component: IntroHero,
    parameters: { layout: 'centered' },
    decorators: [
        (Story: () => JSX.Element) => (
            <div
                style={{
                    width: 'calc(126 * var(--cell-w))',
                    height: 'calc(18 * var(--row-h))',
                    background: 'var(--editor)',
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

/** The welcome slide: the gradient `bismuth` wordmark. */
export const Wordmark: Story = {
    args: { hero: 'wordmark' },
    play: ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('bismuth')
    },
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
