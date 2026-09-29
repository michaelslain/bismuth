// Visual spec for <ViewRenderer> — the kind switch for resolved row-based views. One story per
// kind it routes, each fed a REAL ViewResult from the query engine (sampleViewResult), so a
// kind that stops routing shows as the table fallback here, not silently.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import ViewRenderer, { type ViewRendererProps } from './ViewRenderer'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import type { ViewConfig } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/ViewRenderer',
    component: ViewRenderer,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ViewRenderer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

function argsFor(view: ViewConfig): ViewRendererProps {
    const config = sampleBaseConfig({ view })
    return {
        result: sampleViewResult(undefined, { view }),
        config,
        basePath: 'boards/tasks.md',
        mode: 'normal',
        ownsRows: false,
        onChange: noop,
        onToggle: noop,
        onSetStatus: noop,
    }
}

function kind(view: ViewConfig, present: string): Story {
    return {
        args: argsFor(view),
        render: a => (
            <div style={{ height: '480px', overflow: 'auto', display: 'flex', 'flex-direction': 'column' }}>
                <ViewRenderer {...a} />
            </div>
        ),
        play: async ({ canvasElement }) => {
            await waitFor(() =>
                expect(canvasElement.textContent).toContain(present),
            )
        },
    }
}

export const Table = kind({ type: 'table' }, 'Draft the roadmap')
export const Cards = kind({ type: 'cards' }, 'Ship storybook coverage')
export const List = kind({ type: 'list' }, 'Draft the roadmap')
export const Bullets = kind({ type: 'bullets' }, 'Draft the roadmap')
export const Kanban = kind(
    { type: 'kanban', groupBy: { property: 'status' } },
    'Doing',
)
export const Bar = kind({ type: 'bar', x: 'status' }, 'Todo')
export const Line = kind({ type: 'line', x: 'due' }, '')
export const Stat = kind({ type: 'stat' }, '')
export const Heatmap = kind({ type: 'heatmap', x: 'due' }, '')
export const Map = kind({ type: 'map' }, '')
