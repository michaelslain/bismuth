// Visual spec for <KanbanView> — the Trello-style board renderer. Exercises `sampleViewResult`
// end to end: real rows, run through the real query engine (core/src/bases/query.ts `runView`)
// with a `groupBy`, rendered by the real KanbanView component. `onChange` is a required prop
// (fired after a write); a no-op here since nothing in these stories persists.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { KanbanView } from './KanbanView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { runView } from '../../../core/src/bases/query'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { Row } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/KanbanView',
    component: KanbanView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Grouped by `status` (required for kanban — without a `groupBy` the view renders a hint
 *  instead of a board) with `order` set so each card shows its `priority`/`tags` meta chips.
 *  No `basePath` -> read-only board (no drag/add composer), matching an embedded ```query
 *  kanban. */
export const Default: Story = {
    render: () => {
        const views = [
            {
                type: 'kanban' as const,
                name: 'Kanban',
                groupBy: { property: 'status' },
                order: ['priority', 'tags'],
            },
        ]
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                onChange={noop}
            />
        )
    },
}

/** A `basePath` makes the board editable (per-column "+" add-card composer, draggable cards/
 *  headers) and `columns` pins declared column keys as visible even when empty — "Blocked" has
 *  no cards here but stays on the board. */
export const EditableWithPinnedColumns: Story = {
    render: () => {
        const views = [
            {
                type: 'kanban' as const,
                name: 'Kanban',
                groupBy: { property: 'status' },
                order: ['priority', 'tags'],
                groupOrder: ['Todo', 'Doing', 'Blocked', 'Done'],
            },
        ]
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-demo.md"
                onChange={noop}
            />
        )
    },
}

/** No `groupBy` on the view — the board falls back to a Callout hint instead of columns. */
export const NoGroupBy: Story = {
    render: () => {
        const views = [
            {
                type: 'kanban' as const,
                name: 'Kanban',
            },
        ]
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                onChange={noop}
            />
        )
    },
}

// Two rows STORED in one base's own body — the shape `POST /rows` returns for `source: {kind:
// base}` (and what a `mode: tasks` own-rows board holds): both share `syntheticBaseFile`'s ONE
// synthetic path, and are told apart only by `Row.index`. Built directly (not through
// `sampleViewResult`, whose `mergeRow` drops `index`/`file` overrides) so the fixture carries the
// real write-back handle the fix depends on.
const STORED_PATH = 'boards/stored-two.md'
const STORED_ROWS: Row[] = [
    { description: 'write the spec', status: 'Todo' },
    { description: 'fix the flake', status: 'Todo' },
].map((note, index) => ({
    file: syntheticBaseFile(STORED_PATH),
    note,
    formula: {},
    index,
}))

/**
 * The bug this task fixes, made visible: two rows stored in ONE base file, both in the SAME
 * column (both `status: Todo`) — the exact shape that used to collapse onto a single card
 * repeated twice, because `KanbanView` keyed every card by `row.file.path` and every row here
 * shares one synthetic path. Re-keyed by `rowId` (path + index), each card now resolves to its
 * own row.
 */
export const StoredRows: Story = {
    render: () => {
        const views = [
            {
                type: 'kanban' as const,
                name: 'Kanban',
                groupBy: { property: 'status' },
                order: ['description'],
            },
        ]
        const config = sampleBaseConfig({ views })
        return (
            <KanbanView
                result={runView(config, STORED_ROWS, 0)}
                config={config}
                basePath={STORED_PATH}
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const texts = [
            ...canvasElement.querySelectorAll('[data-testid="kanban-card"]'),
        ].map(el => (el.textContent ?? '').trim())
        expect(texts).toHaveLength(2)
        // The whole bug in one line: before re-keying, both cards resolved to the last row
        // and this was ['fix the flake', 'fix the flake'].
        expect(new Set(texts).size).toBe(2)
    },
}
