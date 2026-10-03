// The first-run intro's 3D graph layer, one story per use. The root is `position: absolute;
// inset: 0`, so every story gives it a sized, positioned wrapper. The canvas pauses its rAF loop
// while the tab is hidden, so a backgrounded tab can sample blank — the play() asserts the canvas
// exists and has size, never ink. The theme's CSS vars are painted onto :root the way the intro
// does (introTheme.ts), because the renderer paints from those tokens, not from its `theme` prop.
import { onCleanup, onMount } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { applyIntroTheme, snapshotRootTheme } from './introTheme'
import IntroGraph from './IntroGraph'
import { BIG_GRAPH, SMALL_GRAPH } from './vaultIntroGraph'

const meta = {
    title: 'Intro/IntroGraph',
    component: IntroGraph,
    parameters: { layout: 'fullscreen' },
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
                    width: '100vw',
                    height: '100vh',
                    background: 'var(--bg)',
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

/** The theme slide's starter cloud: small, full-bleed, ink. */
export const Small: Story = {
    args: { graph: SMALL_GRAPH, active: true, theme: 'ink' },
    play: async ({ canvasElement }) => canvasSized(canvasElement),
}

/** The three-brains slide's whole-vault cloud, pushed up and zoomed out. */
export const BigCondensed: Story = {
    args: {
        graph: BIG_GRAPH,
        active: true,
        theme: 'ink',
        offsetY: 0.12,
        fitMargin: 1.55,
    },
    play: async ({ canvasElement }) => canvasSized(canvasElement),
}

/** The starter cloud recolored to the paper theme. */
export const Paper: Story = {
    args: { graph: SMALL_GRAPH, active: true, theme: 'paper' },
    play: async ({ canvasElement }) => canvasSized(canvasElement),
}

/** An inactive instance fades to 0 and pauses: nothing visible. */
export const Inactive: Story = {
    args: { graph: SMALL_GRAPH, active: false, theme: 'ink' },
    play: async ({ canvasElement }) => {
        await canvasSized(canvasElement)
        const root = canvasElement.querySelector('[data-testid="frame"]')!.firstElementChild!
        expect(getComputedStyle(root).opacity).toBe('0')
    },
}
