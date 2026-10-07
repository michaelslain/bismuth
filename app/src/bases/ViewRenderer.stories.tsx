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
export const Map = kind({ type: 'map' }, 'no rows have a location')

/** The five ROW kinds with nothing to show. They must agree on where the empty state sits: the
 *  block is centred in the view area (`EmptyState fill`), not padded down from the top or left
 *  blank. Measured as the block's centre against the frame's, so a kind that drifts back to
 *  top-padded placement fails here instead of in a screenshot. */
function empty(view: ViewConfig, title: string, dxTolerance = 24): Story {
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
            const block = () =>
                canvasElement.querySelector<HTMLElement>('[data-testid="ui-empty-block"]')
            await waitFor(() => expect(block()?.textContent).toContain(title))
            const scroller = canvasElement.querySelector<HTMLElement>('[data-testid="empty-frame"]')!
            const frame = scroller.getBoundingClientRect()
            // The empty block fits UNDER the header: a `fill` block as tall as the whole frame would
            // push the scroller's content one header height past its own box.
            expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight)
            const box = block()!.getBoundingClientRect()
            const dx = box.left + box.width / 2 - (frame.left + frame.width / 2)
            const dy = box.top + box.height / 2 - (frame.top + frame.height / 2)
            // Centred on x within `dxTolerance`; on y within a quarter of the frame (a table's header
            // row sits above its empty block, so exact centring is not expected there).
            expect(Math.abs(dx)).toBeLessThan(dxTolerance)
            expect(Math.abs(dy)).toBeLessThan(frame.height / 4)
        },
    }
}

export const EmptyTable = empty({ type: 'table' }, 'no rows')
export const EmptyCards = empty({ type: 'cards' }, 'no rows')
export const EmptyList = empty({ type: 'list' }, 'no rows')
export const EmptyBullets = empty({ type: 'bullets' }, 'no rows')
export const EmptyKanban = empty(
    { type: 'kanban', groupBy: { property: 'status' } },
    'no cards',
    // Kanban is writable here, so its add-column ghost takes the right edge of the board and the
    // block centres in what is left — about half the ghost's width off the frame's centre.
    120,
)
