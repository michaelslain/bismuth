import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import GraphLayerToggles from './GraphLayerToggles'

const meta = {
    title: 'Graph/GraphLayerToggles',
    component: GraphLayerToggles,
} satisfies Meta<typeof GraphLayerToggles>
export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Both on — a fresh window's state (today's graph look). */
export const AllOn: Story = {
    render: () => (
        <GraphLayerToggles clusters gradient showClusters onClusters={noop} onGradient={noop} />
    ),
}

/** Both off — every note, flat ground. */
export const AllOff: Story = {
    render: () => (
        <GraphLayerToggles clusters={false} gradient={false} showClusters onClusters={noop} onGradient={noop} />
    ),
}

/** 3D: LOD masses are 2D-only, so only [gradient] renders. */
export const ThreeD: Story = {
    render: () => (
        <GraphLayerToggles clusters gradient showClusters={false} onClusters={noop} onGradient={noop} />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.queryByRole('button', { name: /clusters/ })).toBeNull()
        await expect(c.getByRole('button', { name: /gradient/ })).toBeTruthy()
    },
}

/** Live state: clicking flips aria-pressed on each button independently. */
export const Interactive: Story = {
    render: () => {
        const [clusters, setClusters] = createSignal(true)
        const [gradient, setGradient] = createSignal(true)
        return (
            <GraphLayerToggles
                clusters={clusters()}
                gradient={gradient()}
                showClusters
                onClusters={setClusters}
                onGradient={setGradient}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const cl = c.getByRole('button', { name: /clusters/ })
        const gr = c.getByRole('button', { name: /gradient/ })
        await expect(cl.getAttribute('aria-pressed')).toBe('true')
        await userEvent.click(cl)
        await expect(cl.getAttribute('aria-pressed')).toBe('false')
        await expect(gr.getAttribute('aria-pressed')).toBe('true')
        await userEvent.click(gr)
        await expect(gr.getAttribute('aria-pressed')).toBe('false')
    },
}
