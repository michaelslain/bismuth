// Visual spec for <ChartFields> — a chart view's aggregation, date bucket and row limit.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import ChartFields, { type ChartAggregate, type ChartBin } from './ChartFields'
import type { ViewType } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/ChartFields',
    component: ChartFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ChartFields>

export default meta
type Story = StoryObj<typeof meta>

function Harness(p: { kind: ViewType }) {
    const [agg, setAgg] = createSignal<ChartAggregate>('count')
    const [bin, setBin] = createSignal<ChartBin>('day')
    const [limit, setLimit] = createSignal('')
    return (
        <div style={{ width: '460px' }}>
            <ChartFields
                kind={p.kind}
                aggregate={agg()}
                bin={bin()}
                limitText={limit()}
                onAggregate={setAgg}
                onBin={setBin}
                onLimit={setLimit}
            />
        </div>
    )
}

export const Bar: Story = {
    render: () => <Harness kind="bar" />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('date bucket')).toBeVisible()
        const limit = c.getByPlaceholderText('no limit') as HTMLInputElement
        await userEvent.type(limit, '12')
        await expect(limit.value).toBe('12')
    },
}

export const Line: Story = {
    render: () => <Harness kind="line" />,
}

/** A heatmap has no date bucket. */
export const Heatmap: Story = {
    render: () => <Harness kind="heatmap" />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryByText('date bucket')).toBeNull()
    },
}
