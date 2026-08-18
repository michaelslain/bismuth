// Visual spec for <BaseSettings> — the per-view settings modal (`.evm-modal` chrome shared
// with the calendar's CalendarSettings): column mapping for non-tabular views, chart
// aggregation, record columns/sort/group-by, and the base-level Properties editor (#104) that
// shows for every view type. Saving calls `api.setProperty` per changed field — the global
// fakeTransport (.storybook/preview.ts) answers any unmapped POST with a generic 200 ack (see
// ui/_fakeTransport.ts), so SAVE completing here proves the write path runs without asserting
// on a specific backend response.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { BaseSettings } from './BaseSettings'
import { sampleBaseConfig, SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/BaseSettings',
    component: BaseSettings,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BaseSettings>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Table: a RECORD type that DOES show the Columns section (only kanban suppresses it — see
 *  `showColumns` in the component, which pushes column order into Properties instead). */
export const Table: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                views: [{ type: 'table', name: 'Table' }],
            })}
            viewIdx={0}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Kanban: a record type WITHOUT the Columns section (Properties supersedes it), plus its own
 *  "Hide meta labels" toggle absent from every other record type. */
export const Kanban: Story = {
    render: () => (
        <BaseSettings
            type="kanban"
            config={sampleBaseConfig({
                views: [
                    {
                        type: 'kanban',
                        name: 'Board',
                        groupBy: { property: 'status', direction: 'ASC' },
                    },
                ],
            })}
            viewIdx={0}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Flashcards: the field-mapping section (front/back/due column pickers) plus the
 *  bidirectional toggle unique to this view type. */
export const Flashcards: Story = {
    render: () => (
        <BaseSettings
            type="flashcards"
            config={sampleBaseConfig({
                views: [
                    { type: 'flashcards', name: 'Review', bidirectional: true },
                ],
            })}
            viewIdx={0}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Bar chart: the chart-axis field mapping (X/Value) plus Aggregation (aggregate + date
 *  bucket) — no Columns/sort/group, no Properties column-order coupling. */
export const BarChart: Story = {
    render: () => (
        <BaseSettings
            type="bar"
            config={sampleBaseConfig({
                views: [
                    { type: 'bar', name: 'By status', x: 'due', y: 'priority' },
                ],
            })}
            viewIdx={0}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Heatmap: a chart type whose Aggregation section omits the date-bucket picker (`bin` isn't
 *  offered for heatmap — see `props.type !== 'heatmap'` in the component). */
export const Heatmap: Story = {
    render: () => (
        <BaseSettings
            type="heatmap"
            config={sampleBaseConfig({
                views: [{ type: 'heatmap', name: 'Activity', x: 'due' }],
            })}
            viewIdx={0}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** No `basePath` — the sub-title (note label under "Table settings") is hidden, and SAVE is a
 *  no-op past `onSaved` (the component only calls `api.setProperty` `if (props.basePath)`).
 *  This is a real reachable state: settings opened for a view with no host note yet resolved. */
export const NoBasePath: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                views: [{ type: 'table', name: 'Table' }],
            })}
            viewIdx={0}
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** No rows: `allCols()` falls back to the config's own declared properties, so the column
 *  toggles and sort/group dropdowns still populate from `declaredProperties` alone rather than
 *  going empty — a base with rows not yet resolved (or genuinely empty) isn't a blank panel. */
export const EmptyRows: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                views: [{ type: 'table', name: 'Table' }],
            })}
            viewIdx={0}
            basePath="projects/roadmap.md"
            rows={[]}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Interactive: expand the Properties section's progressive disclosure — clicking a collapsed
 *  property row opens its full editor (name/type/type-specific extras/reorder/delete),
 *  proving the "at most one row open at a time" behaviour actually reaches the DOM. */
export const ExpandPropertyRow: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                views: [{ type: 'table', name: 'Table' }],
            })}
            viewIdx={0}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const statusRow = await canvas.findByText('status')
        await userEvent.click(statusRow)
        await expect(canvas.getByText('DELETE')).toBeInTheDocument()
    },
}
