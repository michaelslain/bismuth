// Visual spec for <TableView> — the Bases table renderer. Exercises `sampleViewResult` end to
// end: real rows, run through the real query engine (core/src/bases/query.ts `runView`),
// rendered by the real TableView component — proving the bases fixture module actually works,
// not just typechecks.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { TableView } from './TableView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/TableView',
    component: TableView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TableView>

export default meta
type Story = StoryObj<typeof meta>

/** The curated sample dataset (text/number/checkbox/date/select/multiselect columns). */
export const Default: Story = {
    render: () => (
        <TableView result={sampleViewResult()} config={sampleBaseConfig()} />
    ),
    play: async ({ canvasElement }) => {
        // A muted cell must not paint the same colour as the title cell. `.table td` sets
        // `color: var(--fg)` at specificity (0,1,1) and a bare `.cellMuted` is (0,1,0), so
        // before `td.cellMuted` the class landed on the cell and changed nothing — correct
        // binding, full-foreground text. Comparing the two RELATIVELY rather than against a
        // literal keeps this true in all four themes. The first row's second cell (`status`)
        // is muted: not the title column, not a tag column, not a rating column.
        const cells = [
            ...canvasElement.querySelectorAll('tbody tr:first-child td'),
        ]
        expect(cells.length).toBeGreaterThan(1)
        expect(getComputedStyle(cells[1]).color).not.toBe(
            getComputedStyle(cells[0]).color,
        )
    },
}

/** Same dataset grouped by `status` — the ResultGroup shape a grouped table (or kanban) needs. */
export const Grouped: Story = {
    render: () => {
        const views = [
            {
                type: 'table' as const,
                name: 'Table',
                groupBy: { property: 'status' },
            },
        ]
        return (
            <TableView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}
