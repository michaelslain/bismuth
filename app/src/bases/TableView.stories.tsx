// Visual spec for <TableView> — the Bases table renderer. Exercises `sampleViewResult` end to
// end: real rows, run through the real query engine (core/src/bases/query.ts `runView`),
// rendered by the real TableView component — proving the bases fixture module actually works,
// not just typechecks.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import { createSignal } from 'solid-js'
import { TableView } from './TableView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { runView } from '../../../core/src/bases/query'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import { setTransport } from '../api'
import type { Transport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { EMPTY_FILE } from '../../../core/src/bases/types'
import {
    expectCompletions,
    pressKey,
    tagsFieldView,
    typeInto,
} from '../ui/_tagsFieldPlay'

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
        const titleCell = canvasElement.querySelector('tbody tr:first-child td')
        expect(titleCell).toBeTruthy()
        expect(titleCell!.querySelector('a')).toBeNull()
        expect((titleCell!.textContent ?? '').trim()).toContain(
            'ship the parser',
        )
    },
}

/** With `basePath` set, every cell of an owned row edits IN PLACE: a click turns the cell into
 *  a focused input (the write itself goes through openRowEditor's commitMeta — Storybook's fake
 *  transport only acks it, so this proves the editing surface; the round trip is proven against
 *  the real backend). */
export const EditableOwnedRow: Story = {
    render: () => (
        <TableView
            result={runView(STORED_CONFIG, STORED_ROWS, 0)}
            config={STORED_CONFIG}
            basePath="boards/stored-table.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const titleCell = canvasElement.querySelector<HTMLElement>(
            'tbody tr:first-child td',
        )!
        expect((titleCell.textContent ?? '').trim()).toContain(
            'ship the parser',
        )
        titleCell.querySelector<HTMLElement>('button')!.click()
        await new Promise(r => setTimeout(r, 30))
        // `description` is a markdown column, so its editor is a textarea, not an input.
        const field =
            titleCell.querySelector<HTMLInputElement>('input, textarea')
        expect(field).toBeTruthy()
        expect(document.activeElement).toBe(field)
        expect(field!.value).toBe('ship the parser')
    },
}

/** A note row keeps its title as a link to the note, and its other cells edit in place — no
 *  separate edit button. */
export const EditableNoteRow: Story = {
    render: () => (
        <TableView
            result={sampleViewResult()}
            config={sampleBaseConfig()}
            basePath="projects/tasks.md"
        />
    ),
    play: async ({ canvasElement }) => {
        expect(
            canvasElement.querySelector('button[aria-label="Edit properties"]'),
        ).toBeNull()
        const titleLink = canvasElement.querySelector(
            'tbody tr:first-child td a',
        )
        expect(titleLink).toBeTruthy()
        const second = canvasElement.querySelectorAll<HTMLElement>(
            'tbody tr:first-child td',
        )[1]
        const btn = second.querySelector<HTMLElement>(
            'button[title="Click to edit"]',
        )
        if (btn) {
            btn.click()
            await new Promise(r => setTimeout(r, 30))
            expect(second.querySelector('input, textarea, button')).toBeTruthy()
        }
    },
}

// A stored-row table backed by a REAL in-memory row store — a plain transport intercepting
// `/row/update` and re-deriving `runView` from it, the same shape
// `KanbanStoredRows.stories.tsx`'s `StoredRowsDeleteShift` uses — so a boolean toggle or a
// select edit here visibly STICKS (the read-only render changes), not just acks. `done` has no
// declared type: its own value is already a real boolean, which is all `propertyEditKind` needs.
// `status` is declared `select` so its cell opens the type-aware picker instead of a text box.
const EDIT_PATH = 'boards/editable-table.md'
const EDIT_CONFIG: BaseConfig = {
    declaredProperties: ['status', 'done'],
    properties: {
        status: {
            type: { kind: 'select', options: ['Todo', 'Doing', 'Done'] },
        },
    },
    views: [{ type: 'table', name: 'Table' }],
}
let editRows: Row[] = [
    {
        file: syntheticBaseFile(EDIT_PATH),
        note: { status: 'Todo', done: false },
        formula: {},
        index: 0,
    },
    {
        file: syntheticBaseFile(EDIT_PATH),
        note: { status: 'Doing', done: true },
        formula: {},
        index: 1,
    },
]

/** Items 1, 2 and 6 for the table: column widths never move while a cell is open (with or
 *  without stored `columnWidths`), a boolean cell flips on one click with no `input` ever
 *  mounted, and the row store is real so the flip is still there after the toggle. */
export const EditableBooleanAndSelect: Story = {
    render: () => {
        const base = fakeTransport()
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                if (path === '/row/update') {
                    const { index, note } = body as {
                        index: number
                        note: Record<string, unknown>
                    }
                    editRows = editRows.map((r, i) =>
                        i === index ? { ...r, note } : r,
                    )
                    return new Response('ok')
                }
                return base.post(path, body)
            },
        }
        setTransport(transport)

        function Table() {
            const [result, setResult] = createSignal(
                runView(EDIT_CONFIG, editRows, 0),
            )
            return (
                <TableView
                    result={result()}
                    config={EDIT_CONFIG}
                    basePath={EDIT_PATH}
                    onChange={() =>
                        setResult(runView(EDIT_CONFIG, editRows, 0))
                    }
                />
            )
        }
        return <Table />
    },
    play: async ({ canvasElement }) => {
        const ths = () =>
            [...canvasElement.querySelectorAll('thead th')] as HTMLElement[]
        const widths = () => ths().map(th => th.getBoundingClientRect().width)
        const colIndex = (label: string) =>
            ths().findIndex(
                th => (th.textContent ?? '').trim().toLowerCase() === label,
            )
        const statusIdx = colIndex('status')
        const doneIdx = colIndex('done')
        expect(statusIdx).toBeGreaterThanOrEqual(0)
        expect(doneIdx).toBeGreaterThanOrEqual(0)
        const before = widths()

        const firstRowCells = () => [
            ...canvasElement.querySelectorAll<HTMLElement>(
                'tbody tr:first-child td',
            ),
        ]

        // Opening the select cell's (non-boolean) editor must not resize any column.
        firstRowCells()
            [statusIdx]!.querySelector<HTMLElement>('button')!
            .click()
        await new Promise(r => setTimeout(r, 30))
        const editorTrigger =
            firstRowCells()[statusIdx]!.querySelector<HTMLElement>('button')
        expect(editorTrigger).toBeTruthy()
        expect(document.activeElement).toBe(editorTrigger)
        expect(widths()).toEqual(before)

        // The boolean cell: one click flips it, immediately, with no `input` ever appearing —
        // and the flip survives because the row store above is real.
        const boolBtn = () =>
            firstRowCells()[doneIdx]!.querySelector<HTMLElement>('button')!
        expect((boolBtn().textContent ?? '').trim()).toBe('')
        boolBtn().click()
        await waitFor(() =>
            expect((boolBtn().textContent ?? '').trim()).toBe('x'),
        )
        expect(canvasElement.querySelector('input')).toBeNull()
        expect(widths()).toEqual(before)
    },
}

// A `source: tasks` row's `file` is the containing NOTE, not the task — the table is the one
// row view that keeps rendering every row (including task-line rows) even under `mode:
// "tasks"` (see the component's own comment), so it must never route a task-line row into the
// shared note/row editor: that editor would title itself with the note, rename the whole file
// on a title edit, and let `delete` trash it instead of the one task line.
const TASK_LINE_CONFIG: BaseConfig = {
    declaredProperties: ['description', 'status'],
    views: [{ type: 'table', name: 'Table' }],
}
const TASK_LINE_ROWS: Row[] = [
    {
        file: {
            ...EMPTY_FILE,
            name: 'tasks',
            basename: 'tasks',
            path: 'tasks.md',
        },
        note: { description: 'ship the parser', line: 5, status: 'todo' },
        formula: {},
    },
]

// A `tags` column across several rows — each row's own value only lists ONE or TWO of the
// board's tags, but the picker must offer every distinct tag the COLUMN holds (arraySiblingsFor
// in TableView.tsx). Regression for the tags-dropdown fix: `siblingValues={() => []}` (the
// previous behaviour) would show row 1's picker with only "alpha" to choose from.
const TAGS_PATH = 'boards/tags-table.md'
const TAGS_CONFIG: BaseConfig = {
    declaredProperties: ['tags'],
    views: [{ type: 'table', name: 'Table' }],
}
const TAGS_ROWS: Row[] = [
    {
        file: syntheticBaseFile(TAGS_PATH),
        note: { tags: ['alpha'] },
        formula: {},
        index: 0,
    },
    {
        file: syntheticBaseFile(TAGS_PATH),
        note: { tags: ['beta', 'gamma'] },
        formula: {},
        index: 1,
    },
]

export const TagsColumnListsWholeBoard: Story = {
    render: () => (
        <TableView
            result={runView(TAGS_CONFIG, TAGS_ROWS, 0)}
            config={TAGS_CONFIG}
            basePath={TAGS_PATH}
        />
    ),
    play: async ({ canvasElement }) => {
        const ths = () =>
            [...canvasElement.querySelectorAll('thead th')] as HTMLElement[]
        const colIndex = (label: string) =>
            ths().findIndex(
                th => (th.textContent ?? '').trim().toLowerCase() === label,
            )
        const tagsIdx = colIndex('tags')
        expect(tagsIdx).toBeGreaterThanOrEqual(0)
        const firstRowCells = () => [
            ...canvasElement.querySelectorAll<HTMLElement>(
                'tbody tr:first-child td',
            ),
        ]
        // Row 0's OWN value is only "alpha" — opening its cell and typing `b` must still offer
        // "beta" from row 1.
        firstRowCells()[tagsIdx]!.querySelector<HTMLElement>('button')!.click()
        const view = await tagsFieldView(canvasElement)
        expect(view.state.doc.toString()).toBe('alpha, ')
        typeInto(view, 'b')
        await expectCompletions(['#beta'])
    },
}

// The tags field end to end in a table cell, with a row store that RE-RESOLVES after the write
// the way BaseView does on a version bump — `runView` hands back brand-new row objects.
const PICK_PATH = 'boards/tags-picker.md'
const PICK_CONFIG: BaseConfig = {
    declaredProperties: ['tags'],
    views: [{ type: 'table', name: 'Table' }],
}
const pickSeed = (): Row[] => [
    {
        file: syntheticBaseFile(PICK_PATH),
        note: { tags: ['alpha'] },
        formula: {},
        index: 0,
    },
    {
        file: syntheticBaseFile(PICK_PATH),
        note: { tags: ['beta', 'gamma'] },
        formula: {},
        index: 1,
    },
]
let pickRows: Row[] = pickSeed()
let pickResolves = 0

export const TagsTypeAcceptCommit: Story = {
    render: () => {
        pickRows = pickSeed()
        pickResolves = 0
        const base = fakeTransport()
        setTransport({
            ...base,
            post: async (path, body) => {
                if (path === '/row/update') {
                    const { index, note } = body as {
                        index: number
                        note: Record<string, unknown>
                    }
                    pickRows = pickRows.map((r, i) =>
                        i === index ? { ...r, note } : r,
                    )
                    return new Response('ok')
                }
                return base.post(path, body)
            },
        })
        function Table() {
            const [result, setResult] = createSignal(
                runView(PICK_CONFIG, pickRows, 0),
            )
            return (
                <TableView
                    result={result()}
                    config={PICK_CONFIG}
                    basePath={PICK_PATH}
                    onChange={() => {
                        pickResolves++
                        setResult(runView(PICK_CONFIG, pickRows, 0))
                    }}
                />
            )
        }
        return <Table />
    },
    play: async ({ canvasElement }) => {
        const tagsIdx = [
            ...canvasElement.querySelectorAll('thead th'),
        ].findIndex(
            th => (th.textContent ?? '').trim().toLowerCase() === 'tags',
        )
        expect(tagsIdx).toBeGreaterThanOrEqual(0)
        const cell = () =>
            canvasElement.querySelectorAll<HTMLElement>(
                'tbody tr:first-child td',
            )[tagsIdx]!

        await userEvent.click(cell().querySelector('button')!)
        const view = await tagsFieldView(canvasElement)
        // The field reads like the cell's text, caret at the end, ready for the next tag.
        expect(view.state.doc.toString()).toBe('alpha, ')
        expect(view.hasFocus).toBe(true)

        typeInto(view, 'b')
        await expectCompletions(['#beta'])
        pressKey(view, 'Tab')
        typeInto(view, 'g')
        await expectCompletions(['#gamma'])
        pressKey(view, 'Tab')
        await waitFor(() =>
            expect(view.state.doc.toString()).toBe('alpha, beta, gamma, '),
        )
        // Nothing was written while typing — the whole list commits once, on Enter.
        expect(pickResolves).toBe(0)
        pressKey(view, 'Enter')
        await waitFor(() => expect(pickResolves).toBe(1))

        // Closed, the cell reads exactly like the read-only tag style — NOT `alpha,beta,gamma`,
        // which is what a tags column that is the table's FIRST (title) column used to show
        // (renderTitle stringified the array). The value itself is still an array.
        await waitFor(() =>
            expect((cell().textContent ?? '').trim()).toBe('#alpha, #beta, #gamma'),
        )
        expect(cell().querySelector('[data-testid="tags-field"]')).toBeNull()
        expect(pickRows[0]!.note.tags).toEqual(['alpha', 'beta', 'gamma'])
    },
}

export const TaskLineRowContextMenu: Story = {
    render: () => (
        <TableView
            result={runView(TASK_LINE_CONFIG, TASK_LINE_ROWS, 0)}
            config={TASK_LINE_CONFIG}
            basePath="boards/tasks.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const titleCell = canvasElement.querySelector<HTMLElement>(
            'tbody tr:first-child td',
        )!
        titleCell.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await new Promise(r => setTimeout(r, 30))
        expect(canvasElement.querySelector('[role="dialog"]')).toBeNull()
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    },
}
