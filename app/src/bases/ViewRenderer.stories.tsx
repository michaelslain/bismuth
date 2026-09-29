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
    const config = sampleBaseConfig({ views: [view] })
    return {
        result: sampleViewResult(undefined, { views: [view] }),
        config,
        basePath: 'boards/tasks.md',
        mode: 'normal',
        ownsRows: false,
        viewIndex: 0,
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

export const Table = kind({ type: 'table', name: 'Table' }, 'Draft the roadmap')
export const Cards = kind({ type: 'cards', name: 'Cards' }, 'Ship storybook coverage')
export const List = kind({ type: 'list', name: 'List' }, 'Draft the roadmap')
export const Bullets = kind({ type: 'bullets', name: 'Bullets' }, 'Draft the roadmap')
export const Kanban = kind(
    { type: 'kanban', name: 'Board', groupBy: { property: 'status' } },
    'Doing',
)
export const Bar = kind({ type: 'bar', name: 'Bar', x: 'status' }, 'Todo')
export const Line = kind({ type: 'line', name: 'Line', x: 'due' }, '')
export const Stat = kind({ type: 'stat', name: 'Stat' }, '')
export const Heatmap = kind({ type: 'heatmap', name: 'Heat', x: 'due' }, '')
export const Map = kind({ type: 'map', name: 'Map' }, '')
