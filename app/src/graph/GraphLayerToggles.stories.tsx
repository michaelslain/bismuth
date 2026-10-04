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

/** On — a fresh window's state. */
export const AllOn: Story = {
    render: () => <GraphLayerToggles clusters onClusters={noop} />,
}

/** Off — every note. */
export const AllOff: Story = {
    render: () => <GraphLayerToggles clusters={false} onClusters={noop} />,
}

/** Live state: clicking flips aria-pressed. There is no [gradient] button — that is .settings now. */
export const Interactive: Story = {
    render: () => {
        const [clusters, setClusters] = createSignal(true)
        return <GraphLayerToggles clusters={clusters()} onClusters={setClusters} />
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const cl = c.getByRole('button', { name: /clusters/ })
        await expect(cl.getAttribute('aria-pressed')).toBe('true')
        await userEvent.click(cl)
        await expect(cl.getAttribute('aria-pressed')).toBe('false')
        await expect(c.queryByRole('button', { name: /gradient/ })).toBeNull()
    },
}
