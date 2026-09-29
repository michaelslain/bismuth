import { createSignal, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { ViewConfig } from '../../../core/src/bases/types'
import ChartConfigBar from './ChartConfigBar'

const COLUMNS = ['due', 'priority', 'status', 'points']

/** A controlled wrapper holding real ViewConfig state — changing a picker writes back through
 *  `onSet` exactly like BaseView does (setProperty on a value, deleteProperty on
 *  `undefined`), then re-renders the bar from the updated view, so a story exercises the real
 *  read-after-write loop rather than a static snapshot. */
function Controlled(props: { view: ViewConfig }): JSX.Element {
    const [view, setView] = createSignal(props.view)
    return (
        <div>
            <ChartConfigBar
                view={view()}
                columns={COLUMNS}
                onSet={changes =>
                    setView(v => {
                        const next = { ...v }
                        for (const [key, value] of Object.entries(changes)) {
                            if (value === undefined) delete next[key as keyof ViewConfig]
                            else next[key as keyof ViewConfig] = value as never
                        }
                        return next
                    })
                }
            />
            <pre data-testid="config-json">{JSON.stringify(view())}</pre>
        </div>
    )
}

const meta = {
    title: 'Bases/ChartConfigBar',
    parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Bar/line/heatmap shape: x, y, agg, bin all live. Picking a new y updates the shown value. */
export const Default: Story = {
    render: () => (
        <Controlled view={{ type: 'bar', x: 'due', y: 'priority', aggregate: 'sum', bin: 'week' }} />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const buttons = canvas.getAllByRole('button')
        // agg is the 3rd picker (x, y, agg, bin) — open it and choose "avg".
        await userEvent.click(buttons[2])
        const option = await within(document.body).findByText('avg')
        await userEvent.click(option)
        await expect(canvas.getByTestId('config-json')).toHaveTextContent('"aggregate":"avg"')
    },
}

/** Heatmap: no bin picker at all. */
export const Heatmap: Story = {
    render: () => (
        <Controlled view={{ type: 'heatmap', x: 'due' }} />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.queryByText('bin')).not.toBeInTheDocument()
    },
}

/** A stat view with declared `stats:` shows only x and bin — no y, no agg. */
export const StatWithMetrics: Story = {
    render: () => (
        <Controlled
            view={{
                type: 'stat',
                x: 'due',
                bin: 'month',
                stats: [{ label: 'total priority', value: 'sum(priority)' }],
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.queryByText('y')).not.toBeInTheDocument()
        await expect(canvas.queryByText('agg')).not.toBeInTheDocument()
        await expect(canvas.getByText('bin')).toBeInTheDocument()
    },
}

/** Choosing "(count rows)" for y clears y and forces aggregate to count in one gesture. */
export const CountRows: Story = {
    render: () => (
        <Controlled view={{ type: 'bar', x: 'due', y: 'priority', aggregate: 'sum' }} />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const buttons = canvas.getAllByRole('button')
        await userEvent.click(buttons[1]) // y picker
        const option = await within(document.body).findByText('(count rows)')
        await userEvent.click(option)
        const json = canvas.getByTestId('config-json')
        await expect(json).toHaveTextContent('"aggregate":"count"')
        await expect(json).not.toHaveTextContent('"y"')
    },
}
