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
    play: async () => {
        // Was a <div role="button"> with no tabindex — present to a screen reader, unreachable by
        // keyboard. ModalHeader makes it a real IconButton. ui/Modal portals to document.body, so
        // query there rather than canvasElement.
        const close = document.body.querySelector(
            '[aria-label="Close"]',
        ) as HTMLElement | null
        await expect(close).not.toBeNull()
        await expect(close!.tagName).toBe('BUTTON')
        // Prove the PROPERTY, not the tag: a <div role="button"> with no tabindex — which is
        // exactly what this used to be — cannot take focus, so activeElement would stay put.
        // A real <button> can. This is what makes the control keyboard-reachable at all.
        close!.focus()
        await expect(document.activeElement).toBe(close)
    },
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
 *  proving the "at most one row open at a time" behaviour actually reaches the DOM.
 *  <BaseSettings> renders through <Modal>, which mounts via a solid-js/web <Portal> to
 *  document.body (ui/Modal.tsx) — canvasElement is the empty storybook-root the portal left
 *  behind, so this queries document.body instead. The plain text "status" is ambiguous inside
 *  the modal (the Columns section's own checkbox for the same property carries the identical
 *  label), so the property row is targeted by its `role="button"` (`propset-head` in the
 *  component) rather than by text alone — and `role: "button"` alone is STILL ambiguous: the
 *  row's own eye-icon child (`aria-label="Hide status from cards/table"`) is itself a `role:
 *  "button"` whose accessible name also contains "status". The row's accessible name is built
 *  name-first ("status" then "select" then the nested eye button's aria-label — see
 *  `propset-head`'s child order), so anchoring the match to the START of the name picks the
 *  row, not the nested toggle. */
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
    play: async () => {
        const canvas = within(document.body)
        const statusRow = await canvas.findByRole('button', {
            name: /^status/i,
        })
        await userEvent.click(statusRow)
        await expect(canvas.getByText('DELETE')).toBeInTheDocument()
    },
}
