// Visual spec for <BaseView> — the unified view host that resolves ANY source (base file /
// inline ```query source / notes / tasks) into rows and picks the right renderer (table, cards,
// kanban, list, bullets, map, heatmap, bar, line, stat, calendar, flashcards). Individual
// renderers already have their own stories (TableView, KanbanView, CardsView, …) driven directly
// off `sampleViewResult()`; THIS file is the one place that exercises the resolution pipeline
// itself — `props.source` (inline YAML, same shape a ```query fence holds) parsed by
// `parseBase()`, resolved via `POST /rows` (fakeTransport, seeded with SAMPLE_ROWS) — end to
// end, the same path a real embedded/base-file view takes.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { BaseView } from './BaseView'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/BaseView',
    component: BaseView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BaseView>

export default meta
type Story = StoryObj<typeof meta>

/** Seeds `/rows` with the shared curated dataset (ui/_baseFixtures.ts) so every view kind below
 *  has the same real vocabulary (status/priority/done/due/tags) to render. */
function seedRows(): void {
    setTransport(fakeTransport({ rows: SAMPLE_ROWS }))
}

/** No `path`/`view` — an inline `source` YAML, exactly what an embedded ```query block with a
 *  full config holds. No explicit `source:` key, so BaseView defaults it to `{kind: "notes"}`
 *  and resolves via `POST /rows`. */
export const Table: Story = {
    render: () => {
        seedRows()
        return <BaseView source={'views:\n  - type: table\n'} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(
                canvas.getByText('Draft the roadmap'),
            ).toBeInTheDocument()
        })
    },
}

/** The cards renderer — proves the view-type switch in `activeType()`/the render `<Switch>`
 *  actually routes to `<CardsView>`, not just `<TableView>` with different data. */
export const Cards: Story = {
    render: () => {
        seedRows()
        return <BaseView source={'views:\n  - type: cards\n'} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(
                canvas.getByText('Ship storybook coverage'),
            ).toBeInTheDocument()
        })
    },
}

/** The kanban renderer, grouped by `status` — the one view kind that needs a `groupBy` to be
 *  meaningful, so this is also the only story here exercising grouped resolution. */
export const Kanban: Story = {
    render: () => {
        seedRows()
        return (
            <BaseView
                source={
                    'views:\n  - type: kanban\n    groupBy: status\n'
                }
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // Column headers come from the grouped status values, not the row titles.
        await waitFor(() => {
            expect(canvas.getByText('Todo')).toBeInTheDocument()
            expect(canvas.getByText('Doing')).toBeInTheDocument()
            expect(canvas.getByText('Done')).toBeInTheDocument()
        })
    },
}

/** A `type: base` md FILE (not an inline source) with no rows of its own — a "query base"
 *  (filters/views over the vault) that BaseView defaults to `{kind: "notes"}` when the config
 *  declares no explicit source and the file's own GFM table is empty. `body` is handed in
 *  pre-fetched (as FileView always does), so no `/file` round-trip is needed for this story. */
export const FromBaseFile: Story = {
    render: () => {
        seedRows()
        return (
            <BaseView
                path="boards/tasks.md"
                body={'---\ntype: base\nviews:\n  - type: table\n---\n'}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(
                canvas.getByText('Write onboarding docs'),
            ).toBeInTheDocument()
        })
    },
}
