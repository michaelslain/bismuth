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
export const Line = kind({ type: 'line', x: 'due' }, 'peak 3')
export const Stat = kind({ type: 'stat' }, 'sum of priority')
export const Heatmap = kind(
    { type: 'heatmap', x: 'due' },
    'right-click a day',
)
export const Map = kind({ type: 'map' }, 'properties to a note to pin it')

/** The five ROW kinds with nothing to show. They must agree on the empty state: one `no matches`
 *  line (QueryEmpty) at the top-left of the view area, where the first row would start — never
 *  centred, never a heading. Measured against the frame, so a kind that drifts back to a centred
 *  block fails here instead of in a screenshot. */
function empty(view: ViewConfig): Story {
    return {
        args: {
            ...argsFor(view),
            result: sampleViewResult([], { view }),
        },
        render: a => (
            <div
                data-testid="empty-frame"
                style={{ height: '480px', overflow: 'auto', display: 'flex', 'flex-direction': 'column' }}
            >
                <ViewRenderer {...a} />
            </div>
        ),
        play: async ({ canvasElement }) => {
            const line = () =>
                canvasElement.querySelector<HTMLElement>('[data-testid="query-empty"]')
            await waitFor(() => expect(line()?.textContent).toBe('no matches'))
            const scroller = canvasElement.querySelector<HTMLElement>('[data-testid="empty-frame"]')!
            const frame = scroller.getBoundingClientRect()
            expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight)
            const box = line()!.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(line()!)
            const text = range.getBoundingClientRect()
            // Text starts within the view gutter on the left, in the top band of the frame (a
            // table's header row sits above it).
            expect(text.left - frame.left).toBeLessThan(40)
            expect(box.top - frame.top).toBeLessThan(80)
        },
    }
}

export const EmptyTable = empty({ type: 'table' })
export const EmptyCards = empty({ type: 'cards' })
export const EmptyList = empty({ type: 'list' })
export const EmptyBullets = empty({ type: 'bullets' })
export const EmptyKanban = empty({ type: 'kanban', groupBy: { property: 'status' } })
