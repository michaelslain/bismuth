// The first-run intro's 3D graph, drawn inside the intro's art box. The root is `position:
// absolute; inset: 0`, so every story gives it a sized, positioned wrapper. The canvas pauses its rAF loop
// while the tab is hidden, so a backgrounded tab can sample blank — the play() asserts the canvas
// exists and has size, never ink. The theme's CSS vars are painted onto :root the way the intro
// does (introTheme.ts), because the renderer paints from those tokens, not from its `theme` prop.
import { onCleanup, onMount } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { applyIntroTheme, snapshotRootTheme } from './introTheme'
import IntroGraph from './IntroGraph'
import { BIG_GRAPH } from './vaultIntroGraph'

const meta = {
    title: 'Intro/IntroGraph',
    component: IntroGraph,
    parameters: { layout: 'centered' },
    render: args => {
        const restore = snapshotRootTheme()
        applyIntroTheme(args.theme)
        onMount(() => applyIntroTheme(args.theme))
        onCleanup(restore)
        return (
            <div
                data-testid="frame"
                style={{
                    position: 'relative',
                    overflow: 'hidden',
                    width: 'calc(126 * var(--cell-w))',
                    height: 'calc(18 * var(--row-h))',
                    background: 'var(--editor)',
                }}
            >
                <IntroGraph {...args} />
            </div>
        )
    },
} satisfies Meta<typeof IntroGraph>

export default meta
type Story = StoryObj<typeof meta>

const canvasSized = async (canvasElement: HTMLElement) => {
    const canvas = canvasElement.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas!.width).toBeGreaterThan(0)
    expect(canvas!.height).toBeGreaterThan(0)
}

/** The whole-vault cloud inside the intro's art box: wholly inside with margin, no glow. */
export const InArtBox: Story = {
    args: { graph: BIG_GRAPH, active: true, theme: 'ink' },
    play: async ({ canvasElement }) => canvasSized(canvasElement),
}

/** The same box recolored to the paper theme. */
export const InArtBoxPaper: Story = {
    args: { graph: BIG_GRAPH, active: true, theme: 'paper' },
    play: async ({ canvasElement }) => canvasSized(canvasElement),
}
