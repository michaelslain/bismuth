// Visual spec for <KanbanView> — the Trello-style board renderer. Exercises `sampleViewResult`
// end to end: real rows, run through the real query engine (core/src/bases/query.ts `runView`)
// with a `groupBy`, rendered by the real KanbanView component. `onChange` is a required prop
// (fired after a write); a no-op here since nothing in these stories persists.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import { KanbanView } from './KanbanView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { runView } from '../../../core/src/bases/query'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { Row } from '../../../core/src/bases/types'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import type { FakeTransportSeed } from '../ui/_fakeTransport'
import type { Transport } from '../api'

// `fakeTransport` gives every route a generic 200 ack with no record of the call — enough for a
// story that only needs the write to succeed, not enough to ASSERT what was written. Wraps it
// with a `post` spy (the verb `setViewProperty`/`rowCreate`/`rowUpdate` all go through) so a
// play() can inspect exactly what was sent, same shared-closure shape as KanbanAddColumn.stories'
// `addedNames`.
function spiedTransport(seed: FakeTransportSeed = {}): {
    transport: Transport
    calls: { path: string; body: unknown }[]
} {
    const calls: { path: string; body: unknown }[] = []
    const base = fakeTransport(seed)
    const transport: Transport = {
        ...base,
        post: async (path, body) => {
            calls.push({ path, body })
            return base.post(path, body)
        },
        put: async (path, body) => {
            calls.push({ path, body })
            return base.put(path, body)
        },
    }
    return { transport, calls }
}

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

/** No `groupBy` on the view — the board falls back to a `Callout` hint instead of columns.
 *  Asserted rather than left to a screenshot: the hint's copy renders, proving the fallback path
 *  is the real `Callout` component (its module class) and not a bare div. */
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const hint = await canvas.findByText(/needs a "groupBy" property/)
        expect(hint.closest('[class*="callout"]')).not.toBeNull()
    },
}

// Every swatch's accessible name + title — parallel to KanbanView's PALETTE_NAMES.
const PALETTE_NAMES = ['rose', 'violet', 'blue', 'teal', 'green']

/** The column colour picker open — clicking a column's colour dot reveals the palette `Swatch`es
 *  (each aria-labelled by its colour name, e.g. "rose") plus the "Auto" option that clears an
 *  override. Needs `basePath` (`editable()`) for the dot button to be enabled at all. The first
 *  column ("Todo") has no override set, so no swatch shows the `selected` ring — only Auto reads
 *  pressed, exactly one control marked at a time. */
export const ColorPickerOpen: Story = {
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
                basePath="stories/kanban-demo.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const dot = canvas.getAllByTitle('Column color')[0]!
        await userEvent.click(dot)
        const auto = await canvas.findByRole('button', { name: 'Auto' })
        expect(auto).toBeVisible()
        expect(auto).toHaveAttribute('aria-pressed', 'true')
        const swatches = PALETTE_NAMES.map(name => {
            const el = canvas.getByRole('button', { name })
            expect(el).toBeVisible()
            expect(el).toHaveAttribute('title', name)
            return el
        })
        expect(swatches.length).toBe(5)
    },
}

/** Same board, opened on the THIRD column ("Done") instead of the first — proves the popover
 *  anchors to the column it belongs to, not always the leftmost one. "Done" also matches a
 *  known status color (STATUS_COLOR), so no override is set yet none of the five swatches is
 *  "selected" either — that color didn't come from this palette. */
export const ColorPickerOpenThirdColumn: Story = {
    render: () => {
        const views = [
            {
                type: 'kanban' as const,
                name: 'Kanban',
                groupBy: { property: 'status' },
                order: ['priority', 'tags'],
                groupOrder: ['Todo', 'Doing', 'Done'],
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const dots = canvas.getAllByTitle('Column color')
        expect(dots.length).toBeGreaterThanOrEqual(3)
        await userEvent.click(dots[2]!)
        const auto = await canvas.findByRole('button', { name: 'Auto' })
        expect(auto).toBeVisible()
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

// Captured by each story's render() and read back in its play() — same shared-closure shape as
// `addedNames` in KanbanAddColumn.stories.tsx.
let kanbanCalls: { path: string; body: unknown }[] = []

/** The trailing "+ column" ghost — clicking it, typing a name and hitting Enter adds a fourth,
 *  empty column ("Blocked") alongside the 3 status groups the sample rows already produce, and
 *  persists it via `api.setViewProperty(basePath, viewIndex, 'columns', [...])` (KanbanView's
 *  `addColumn`, optimistic like `reorderColumns`). `status` is a declared `select` property here
 *  (`_baseFixtures.ts`), so `addColumn` also appends the option to `properties` — a second write
 *  the assertion below doesn't care about, only that the `columns` one carries `Blocked`. */
export const AddColumn: Story = {
    render: () => {
        const views = [
            {
                type: 'kanban' as const,
                name: 'Kanban',
                groupBy: { property: 'status' },
            },
        ]
        const { transport, calls } = spiedTransport()
        kanbanCalls = calls
        setTransport(transport)
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-demo.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const columnsBefore =
            canvasElement.querySelectorAll('[data-kbcol]').length
        await userEvent.click(canvas.getByText('+ column'))
        const input = await canvas.findByPlaceholderText('column name')
        await userEvent.type(input, 'Blocked')
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(
                canvasElement.querySelectorAll('[data-kbcol]').length,
            ).toBe(columnsBefore + 1),
        )
        const newCol = canvasElement.querySelector('[data-kbcol="Blocked"]')
        expect(newCol).not.toBeNull()
        expect(
            newCol!.querySelectorAll('[data-testid="kanban-card"]').length,
        ).toBe(0)
        const columnsWrite = kanbanCalls.find(
            c =>
                c.path === '/set-property' &&
                (c.body as { key?: string }).key === 'columns',
        )
        expect(columnsWrite).toBeDefined()
        expect((columnsWrite!.body as { value: string[] }).value).toContain(
            'Blocked',
        )
    },
}

// The stored-row rows the composer adds against — same shape as `StoredRows` above.
const STORED_ADD_PATH = 'boards/stored-add.md'
const STORED_ADD_ROWS: Row[] = [
    { description: 'write the spec', status: 'Todo' },
].map((note, index) => ({
    file: syntheticBaseFile(STORED_ADD_PATH),
    note,
    formula: {},
    index,
}))

/** `ownsRows: true` (a `mode: tasks`/own-rows base's own bug this task fixes): the per-column
 *  "+" composer's add must call `api.rowCreate` (`POST /row/update` with `index: null`) instead
 *  of writing a new note file — before the fix it always `api.write`d into the base's own
 *  folder, which for a stored-row board is the base file's own parent. Asserts the transport saw
 *  the row write and never a `/file` PUT. */
export const StoredRowsAddCard: Story = {
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
        const { transport, calls } = spiedTransport()
        kanbanCalls = calls
        setTransport(transport)
        return (
            <KanbanView
                result={runView(config, STORED_ADD_ROWS, 0)}
                config={config}
                basePath={STORED_ADD_PATH}
                ownsRows
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const addButton = canvas.getAllByLabelText('Add a card')[0]!
        await userEvent.click(addButton)
        const input = await canvas.findByPlaceholderText(/card title/i)
        await userEvent.type(input, 'fix the flake redux')
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(
                kanbanCalls.some(
                    c =>
                        c.path === '/row/update' &&
                        (c.body as { index: unknown }).index === null,
                ),
            ).toBe(true),
        )
        expect(kanbanCalls.some(c => c.path === '/file')).toBe(false)
    },
}

// Rows for the title/rename/delete stories below — same stored-row shape as `STORED_ROWS`,
// with `description` as the view's first `order:` id so `storedTitleColumn` binds the title
// there (task 4's fix: before it, `titleCol()` stayed `'file.name'` on an own-rows board, so
// every card's heading rendered empty — `syntheticBaseFile`'s `name` is `''`).
const STORED_TITLE_PATH = 'boards/stored-titles.md'
const STORED_TITLE_ROWS: Row[] = [
    { description: 'write the spec', status: 'Todo' },
    { description: 'fix the flake', status: 'Todo' },
].map((note, index) => ({
    file: syntheticBaseFile(STORED_TITLE_PATH),
    note,
    formula: {},
    index,
}))

/** Both stored rows render their real `description` as the card heading — not empty, and not
 *  ALSO repeated as a meta chip (`storedTitleColumn` picks `description` as the title column,
 *  so `metaColumns` drops it from the chip list the same way it drops `file.name` normally). */
export const StoredRowsTitles: Story = {
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
                result={runView(config, STORED_TITLE_ROWS, 0)}
                config={config}
                basePath={STORED_TITLE_PATH}
                ownsRows
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const titles = [
            ...canvasElement.querySelectorAll(
                '[data-edit-target="description"]',
            ),
        ].map(el => (el.textContent ?? '').trim())
        expect(titles).toEqual(['write the spec', 'fix the flake'])
        // No OTHER element also carries a `description` edit-target (the duplicate-chip bug) —
        // exactly one per card, the title itself.
        expect(
            canvasElement.querySelectorAll('[data-edit-target]').length,
        ).toBe(2)
    },
}

/** A stored row's card title is renamable and deletable, same as a real note's: tapping the
 *  title opens the edit modal, typing a new title + Enter writes it back via
 *  `api.rowUpdate` (`POST /row/update`, `index` matching the row, `note.description` the new
 *  text), and DELETE writes `api.rowDelete` (`POST /row/delete`) — task 4's fix, `CardEditModal`
 *  no longer hides either affordance for a stored row. */
export const StoredRowsRenameDelete: Story = {
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
        const { transport, calls } = spiedTransport()
        kanbanCalls = calls
        setTransport(transport)
        return (
            <KanbanView
                result={runView(config, STORED_TITLE_ROWS, 0)}
                config={config}
                basePath={STORED_TITLE_PATH}
                ownsRows
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector<HTMLElement>(
            '[data-edit-target="description"]',
        )!
        await userEvent.click(title)
        const titleInput = await within(document.body).findByPlaceholderText(
            'Untitled',
        )
        await userEvent.clear(titleInput)
        await userEvent.type(titleInput, 'renamed task')
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(
                kanbanCalls.some(
                    c =>
                        c.path === '/row/update' &&
                        (
                            c.body as {
                                index: unknown
                                note: Record<string, unknown>
                            }
                        ).index === 0 &&
                        (c.body as { note: Record<string, unknown> }).note
                            .description === 'renamed task',
                ),
            ).toBe(true),
        )

        const deleteButton = await within(document.body).findByText('DELETE')
        await userEvent.click(deleteButton)
        await waitFor(() =>
            expect(
                kanbanCalls.some(
                    c =>
                        c.path === '/row/delete' &&
                        (c.body as { index: unknown }).index === 0,
                ),
            ).toBe(true),
        )
    },
}

/** A NOTE board (SAMPLE_ROWS, two cards in "Todo"): the column header's `…` menu → Rename →
 *  `Backlog` rewrites `columns` (Todo → Backlog) AND moves both "Todo" cards there in ONE
 *  batched `/set-properties` write — `status` is a declared `select` property here
 *  (`_baseFixtures.tsx`), so this also proves the two writes (columns, cards) both land without
 *  asserting on the option-rename write the same way `AddColumn` doesn't assert its `properties`
 *  write. */
export const RenameColumn: Story = {
    render: () => {
        const { transport, calls } = spiedTransport()
        kanbanCalls = calls
        setTransport(transport)
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
                basePath="stories/kanban-demo.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(canvasElement.ownerDocument.body)
        const todoBefore = canvasElement.querySelector<HTMLElement>(
            '[data-kbcol="Todo"]',
        )!
        const cardsBefore = todoBefore.querySelectorAll(
            '[data-testid="kanban-card"]',
        )
        expect(cardsBefore.length).toBe(2)

        // Scope to Todo's own menu trigger rather than assuming it's rendered first — column
        // order is derived data (groupBy option order), not a layout guarantee this story should
        // depend on (DeleteEmptyColumn already scopes the same way, to `blockedCol`).
        const todoMenus = within(todoBefore).getAllByLabelText('Column menu')
        await userEvent.click(todoMenus[0]!)
        await userEvent.click(await body.findByText(/^rename$/i))
        // The rename input focuses via queueMicrotask inside a portal — under a loaded pooled
        // run findBy's 1000ms default raced it, so wait longer, scoped to the menu panel.
        const input = await waitFor(
            () =>
                within(body.getByTestId('kanban-column-menu')).getByDisplayValue(
                    'Todo',
                ),
            { timeout: 3000 },
        )
        await userEvent.clear(input)
        await userEvent.type(input, 'Backlog')
        await userEvent.keyboard('{Enter}')

        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-kbcol="Backlog"]'),
            ).not.toBeNull(),
        )
        expect(canvasElement.querySelector('[data-kbcol="Todo"]')).toBeNull()
        const backlogCol = canvasElement.querySelector(
            '[data-kbcol="Backlog"]',
        )!
        expect(
            backlogCol.querySelectorAll('[data-testid="kanban-card"]').length,
        ).toBe(2)

        const columnsWrite = kanbanCalls.find(
            c =>
                c.path === '/set-property' &&
                (c.body as { key?: string }).key === 'columns',
        )
        expect(columnsWrite).toBeDefined()
        const newColumns = (columnsWrite!.body as { value: string[] }).value
        expect(newColumns).toContain('Backlog')
        expect(newColumns).not.toContain('Todo')

        const cardsWrite = kanbanCalls.find(
            c => c.path === '/set-properties',
        )
        expect(cardsWrite).toBeDefined()
        // ONE batched card write, not one request per card.
        expect(
            kanbanCalls.filter(c => c.path === '/set-properties').length,
        ).toBe(1)
        const writes = (
            cardsWrite!.body as {
                writes: Array<{ path: string; key: string; value: unknown }>
            }
        ).writes
        const statusWrites = writes.filter(w => w.key === 'status')
        expect(statusWrites.length).toBe(2)
        for (const w of statusWrites) expect(w.value).toBe('Backlog')
    },
}

/** `EditableWithPinnedColumns`' pinned-but-empty "Blocked" column: the `…` menu offers Delete
 *  (`canDelete` — no cards), and picking it removes the column from `columns` and from the
 *  board. */
export const DeleteEmptyColumn: Story = {
    render: () => {
        const { transport, calls } = spiedTransport()
        kanbanCalls = calls
        setTransport(transport)
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        expect(
            canvasElement.querySelector('[data-kbcol="Blocked"]'),
        ).not.toBeNull()

        const menus = canvas.getAllByLabelText('Column menu')
        const blockedCol = canvasElement.querySelector(
            '[data-kbcol="Blocked"]',
        )!
        const blockedMenu = [...menus].find(m => blockedCol.contains(m))!
        await userEvent.click(blockedMenu)
        const del = await body.findByText(/^delete$/i)
        await userEvent.click(del)

        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-kbcol="Blocked"]'),
            ).toBeNull(),
        )
        const columnsWrite = kanbanCalls.find(
            c =>
                c.path === '/set-property' &&
                (c.body as { key?: string }).key === 'columns',
        )
        expect(columnsWrite).toBeDefined()
        expect(
            (columnsWrite!.body as { value: string[] }).value,
        ).not.toContain('Blocked')
    },
}

// Three rows stored in ONE own-rows base, deleted from row 0 — proves a stored-row delete
// splices the SERVER-side array (not just the optimistic client-side hide) and a subsequent
// `/rows` read reflects it: the remaining two rows keep their original titles, shifted down to
// indexes 0/1.
const STORED_DELETE_PATH = 'boards/stored-delete.md'
function storedDeleteRows(): Row[] {
    return [
        { description: 'write the spec', status: 'Todo' },
        { description: 'fix the flake', status: 'Todo' },
        { description: 'ship the release', status: 'Todo' },
    ].map((note, index) => ({
        file: syntheticBaseFile(STORED_DELETE_PATH),
        note,
        formula: {},
        index,
    }))
}

// Set by the story's render() once the wrapper component mounts, called by play() AFTER it has
// observed the `/row/delete` write land — same "capture in render, drive from play" shape as
// `kanbanCalls` above, but for a refetch trigger rather than a request log. No sleep: play()
// waits on the captured request, not on a timer.
let deleteShiftRefetch: () => Promise<void> = async () => {}

/** A stored-row delete's write path (`api.rowDelete` -> `POST /row/delete`) and read path
 *  (`POST /rows`) share the SAME server-side array — this fake transport splices it on delete so
 *  the next `/rows` resolve proves the row actually left the store, not just the client's
 *  optimistic hide. `deleteShiftRefetch` re-runs `api.resolveRows` + `runView` to rebuild the
 *  board from that fresh read, on demand — never a timer. */
export const StoredRowsDeleteShift: Story = {
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
        let liveRows = storedDeleteRows()
        const base = fakeTransport()
        const calls: { path: string; body: unknown }[] = []
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                calls.push({ path, body })
                if (path === '/row/delete') {
                    const { index } = body as { index: number }
                    liveRows = liveRows
                        .filter((_, i) => i !== index)
                        .map((r, i) => ({ ...r, index: i }))
                    return new Response('ok')
                }
                return base.post(path, body)
            },
            postJson: async <T,>(path: string, body: unknown): Promise<T> => {
                if (path === '/rows') return liveRows as unknown as T
                return base.postJson<T>(path, body)
            },
        }
        setTransport(transport)
        kanbanCalls = calls

        function Board() {
            const [result, setResult] = createSignal(
                runView(config, storedDeleteRows(), 0),
            )
            deleteShiftRefetch = async () => {
                const rows = await api.resolveRows({ kind: 'base' })
                setResult(runView(config, rows, 0))
            }
            return (
                <KanbanView
                    result={result()}
                    config={config}
                    basePath={STORED_DELETE_PATH}
                    ownsRows
                    onChange={() => void deleteShiftRefetch()}
                />
            )
        }
        return <Board />
    },
    play: async ({ canvasElement }) => {
        const titles = () =>
            [
                ...canvasElement.querySelectorAll(
                    '[data-edit-target="description"]',
                ),
            ].map(el => (el.textContent ?? '').trim())
        expect(titles()).toEqual([
            'write the spec',
            'fix the flake',
            'ship the release',
        ])

        const title = canvasElement.querySelector<HTMLElement>(
            '[data-edit-target="description"]',
        )!
        await userEvent.click(title)
        const deleteButton = await within(document.body).findByText('DELETE')
        await userEvent.click(deleteButton)

        await waitFor(() =>
            expect(
                kanbanCalls.some(
                    c =>
                        c.path === '/row/delete' &&
                        (c.body as { index: unknown }).index === 0,
                ),
            ).toBe(true),
        )
        await deleteShiftRefetch()

        await waitFor(() => expect(titles()).toHaveLength(2))
        expect(titles()).toEqual(['fix the flake', 'ship the release'])
    },
}

// Two rows stored in ONE own-rows base, both in `todo` — proves a stored-row column rename
// sends ONE `rowUpdateMany` (`POST /rows/update`) carrying whole stored rows with integer
// indexes >= 0 and the new `status`, per task 1's fix to KanbanView's rename path.
const STORED_RENAME_COL_PATH = 'boards/stored-rename-col.md'
const STORED_RENAME_COL_ROWS: Row[] = [
    { description: 'write the spec', status: 'todo' },
    { description: 'fix the flake', status: 'todo' },
].map((note, index) => ({
    file: syntheticBaseFile(STORED_RENAME_COL_PATH),
    note,
    formula: {},
    index,
}))

export const StoredRowsRenameColumn: Story = {
    render: () => {
        const { transport, calls } = spiedTransport()
        kanbanCalls = calls
        setTransport(transport)
        const views = [
            {
                type: 'kanban' as const,
                name: 'Kanban',
                groupBy: { property: 'status' },
                order: ['description'],
                groupOrder: ['todo'],
            },
        ]
        const config = sampleBaseConfig({ views })
        return (
            <KanbanView
                result={runView(config, STORED_RENAME_COL_ROWS, 0)}
                config={config}
                basePath={STORED_RENAME_COL_PATH}
                ownsRows
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(canvasElement.ownerDocument.body)
        const todoBefore = canvasElement.querySelector<HTMLElement>(
            '[data-kbcol="todo"]',
        )!
        const todoMenus = within(todoBefore).getAllByLabelText('Column menu')
        await userEvent.click(todoMenus[0]!)
        await userEvent.click(await body.findByText(/^rename$/i))
        const input = await waitFor(
            () =>
                within(body.getByTestId('kanban-column-menu')).getByDisplayValue(
                    'todo',
                ),
            { timeout: 3000 },
        )
        await userEvent.clear(input)
        await userEvent.type(input, 'doing')
        await userEvent.keyboard('{Enter}')

        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-kbcol="doing"]'),
            ).not.toBeNull(),
        )

        const renameManyWrites = kanbanCalls.filter(
            c => c.path === '/rows/update',
        )
        expect(renameManyWrites.length).toBe(1)
        const write = renameManyWrites[0]!
        const { updates } = write.body as {
            file?: string
            updates: Array<{
                index: number | null
                note: Record<string, unknown>
            }>
        }
        expect((write.body as { file?: string }).file).toBe(
            STORED_RENAME_COL_PATH,
        )
        expect(updates.length).toBe(2)
        for (const u of updates) {
            expect(Number.isInteger(u.index)).toBe(true)
            expect((u.index as number) >= 0).toBe(true)
            expect(u.note.description).toBeDefined()
            expect(u.note.status).toBe('doing')
        }
    },
}
