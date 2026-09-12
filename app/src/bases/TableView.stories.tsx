// Visual spec for <TableView> — the Bases table renderer. Exercises `sampleViewResult` end to
// end: real rows, run through the real query engine (core/src/bases/query.ts `runView`),
// rendered by the real TableView component — proving the bases fixture module actually works,
// not just typechecks.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { TableView } from './TableView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { runView } from '../../../core/src/bases/query'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { BaseConfig, Row } from '../../../core/src/bases/types'

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
        // A NOTES-sourced row names a real note of its own — unlike a row stored in a base's
        // own body (see StoredRows below), the title cell here must stay a live anchor that
        // opens it.
        const titleLink = cells[0].querySelector('a')
        expect(titleLink).toBeTruthy()
        const opened = await new Promise<string>(resolve => {
            window.addEventListener(
                'bismuth-open',
                e => resolve((e as CustomEvent<string>).detail),
                { once: true },
            )
            ;(titleLink as HTMLAnchorElement).click()
        })
        expect(opened).toBe('projects/Draft the roadmap.md')
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

// Two rows STORED in a base's own body — `syntheticBaseFile` + an integer `index`, the shape
// `canWriteStoredRow`/`rowId` key off (see rowIdentity.ts) — rather than rows read from
// distinct notes. `mergeRow` in `_baseFixtures.tsx` does not carry `index` through, so this
// builds the rows + config directly and runs them through the real `runView`.
const STORED_CONFIG: BaseConfig = {
    declaredProperties: ['description', 'status'],
    views: [{ type: 'table', name: 'Table' }],
}

const STORED_ROWS: Row[] = [
    {
        file: syntheticBaseFile('boards/stored-table.md'),
        note: { description: 'ship the parser', status: 'Todo' },
        formula: {},
        index: 0,
    },
    {
        file: syntheticBaseFile('boards/stored-table.md'),
        note: { description: 'fix the flake', status: 'Doing' },
        formula: {},
        index: 1,
    },
]

/** A row stored in the base's own body has no note of its own — `syntheticBaseFile` gives
 *  every such row the BASE's own path, a write-back handle rather than a destination.
 *  Rendering the title as an anchor to it offered "open the file you already have open"; the
 *  title cell must instead be plain text carrying the row's label. */
export const StoredRows: Story = {
    render: () => (
        <TableView
            result={runView(STORED_CONFIG, STORED_ROWS, 0)}
            config={STORED_CONFIG}
        />
    ),
    play: async ({ canvasElement }) => {
        const titleCell = canvasElement.querySelector(
            'tbody tr:first-child td',
        )
        expect(titleCell).toBeTruthy()
        expect(titleCell!.querySelector('a')).toBeNull()
        expect((titleCell!.textContent ?? '').trim()).toContain(
            'ship the parser',
        )
    },
}
