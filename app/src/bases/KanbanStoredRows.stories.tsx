// Visual spec for <KanbanView>'s own-rows/stored-row behaviour: rows stored inline in a base's
// own body (`ownsRows`), the row-level add/rename/delete writes that come with owning them, and
// the write-path proofs for boards that source rows from elsewhere. Split out of
// KanbanView.stories.tsx — board rendering + colour lives there, column add/rename/delete/reorder
// in KanbanColumns.stories.tsx. Exercises `sampleViewResult`/`runView` end to end: real rows, run
// through the real query engine (core/src/bases/query.ts `runView`), rendered by the real
// KanbanView component. `onChange` is a required prop (fired after a write); a no-op here since
// nothing in these stories persists unless a story's own fake transport re-derives state from it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import { KanbanView } from './KanbanView'
import { sampleBaseConfig } from '../ui/_baseFixtures'
import { runView } from '../../../core/src/bases/query'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { Row } from '../../../core/src/bases/types'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { kanbanViews, openColumnMenu } from '../ui/_kanbanProbes'
import { spiedTransport } from '../ui/_kanbanSpiedTransport'
import type { Transport } from '../api'
import { toasts } from '../toastStore'

const meta = {
    title: 'Bases/KanbanView/Stored rows',
    component: KanbanView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

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
        const views = kanbanViews({ order: ['description'] })
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
        const views = kanbanViews({ order: ['description'] })
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
        const views = kanbanViews({ order: ['description'] })
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
        const views = kanbanViews({ order: ['description'] })
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

        const deleteButton = await within(document.body).findByRole('button', {
            name: /^delete$/i,
        })
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

/** A stored-row delete's optimistic hide (`deletedIds`, keyed by id + a content snapshot — see
 *  `deleteCard`'s own comment) survives the index shift a delete causes. This fake transport
 *  splices ITS OWN in-memory array on `/row/delete` (not a real backend) so the next `/rows`
 *  resolve returns rows re-indexed the way a real delete would shift them; `deleteShiftRefetch`
 *  re-runs `api.resolveRows` + `runView` to rebuild the board from that fresh read, on demand,
 *  never a timer. What this PROVES is that the hide's snapshot check stops covering the card
 *  that shifted into the deleted row's old id (it renders under its own real title) — not that
 *  any real store spliced anything, which is outside a Storybook story's reach. */
export const StoredRowsDeleteShift: Story = {
    render: () => {
        const views = kanbanViews({ order: ['description'] })
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
        const deleteButton = await within(document.body).findByRole('button', {
            name: /^delete$/i,
        })
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

/** A stored-row add whose `api.rowCreate` write (`POST /row/update`, `index: null`) rejects: the
 *  optimistic ghost card must not become a permanent artifact — `addCard`'s catch drops exactly
 *  this call's placeholder (matched by its own optimistic index) — and the user sees why via an
 *  `Add card failed` toast rather than a card that silently vanishes with no explanation. */
export const StoredAddFails: Story = {
    render: () => {
        const views = kanbanViews({ order: ['description'] })
        const config = sampleBaseConfig({ views })
        const base = fakeTransport()
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                if (
                    path === '/row/update' &&
                    (body as { index: unknown }).index === null
                )
                    throw new Error('base file is locked')
                return base.post(path, body)
            },
        }
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
        const before = toasts().length
        const addButton = canvas.getAllByLabelText('Add a card')[0]!
        await userEvent.click(addButton)
        const input = await canvas.findByPlaceholderText(/card title/i)
        await userEvent.type(input, 'ship the broken build')
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(toasts().length).toBe(before + 1))
        expect(toasts()[before].message).toContain('Add card failed')
        // The optimistic ghost is gone, not left behind as a permanent card.
        expect(canvas.queryByText('ship the broken build')).toBeNull()
    },
}

// A `source:` board's rows carry `syntheticBaseFile(<the SOURCE base's own path>)`, distinct
// from `basePath` (THIS board's own file) below — the shape `POST /rows` returns for any board
// that queries another base rather than owning its rows inline.
const SOURCE_DROP_PATH = 'boards/source-tasks.md'
const SOURCE_DROP_BOARD_PATH = 'boards/kanban-board.md'
const SOURCE_DROP_ROWS: Row[] = [
    { description: 'ship the release', status: 'Todo' },
    { description: 'write the spec', status: 'Doing' },
].map((note, index) => ({
    file: syntheticBaseFile(SOURCE_DROP_PATH),
    note,
    formula: {},
    index,
}))

/** Dropping a card on a `source:` board must batch its `rowUpdateMany` write to the row's OWN
 *  file (`groupUpdatesByPath`, keyed by `r.file.path`) — the SOURCE base's path — never to
 *  `props.basePath`, this board's own file, or the drop would silently corrupt the board being
 *  viewed instead of the board it actually sources from. Drives the drop the way the pointer
 *  handlers actually work (`startCardDrag`/`onPointerMove`/`onPointerUp`, not HTML5 DnD): a
 *  `pointerdown` on the card, a `pointermove` past the 5px commit threshold, a second
 *  `pointermove` over the target column (read via `document.elementFromPoint` in
 *  `resolveCardTarget`), then `pointerup`. */
export const SourceBoardDropPerPath: Story = {
    render: () => {
        const views = kanbanViews({ order: ['description'] })
        const config = sampleBaseConfig({ views })
        const { transport, calls } = spiedTransport()
        kanbanCalls = calls
        setTransport(transport)
        return (
            <KanbanView
                result={runView(config, SOURCE_DROP_ROWS, 0)}
                config={config}
                basePath={SOURCE_DROP_BOARD_PATH}
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const card = canvasElement.querySelector<HTMLElement>(
            '[data-kbcol="Todo"] [data-kbcard]',
        )!
        const doingCol = canvasElement.querySelector<HTMLElement>(
            '[data-kbcol="Doing"]',
        )!
        const cardRect = card.getBoundingClientRect()
        const from = {
            x: cardRect.left + cardRect.width / 2,
            y: cardRect.top + cardRect.height / 2,
        }
        const colRect = doingCol.getBoundingClientRect()
        const to = {
            x: colRect.left + colRect.width / 2,
            y: colRect.top + colRect.height / 2,
        }

        fireEvent.pointerDown(card, {
            button: 0,
            clientX: from.x,
            clientY: from.y,
        })
        fireEvent.pointerMove(window, {
            clientX: from.x + 10,
            clientY: from.y + 10,
        })
        fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y })
        fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y })

        await waitFor(() =>
            expect(kanbanCalls.some(c => c.path === '/rows/update')).toBe(true),
        )
        const update = kanbanCalls.find(c => c.path === '/rows/update')!
        expect((update.body as { file: string }).file).toBe(SOURCE_DROP_PATH)
        expect((update.body as { file: string }).file).not.toBe(
            SOURCE_DROP_BOARD_PATH,
        )
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
        const base = fakeTransport()
        const calls: { path: string; body: unknown }[] = []
        // A placeholder add's `/row/update` write that never resolves — the story only needs
        // it stuck in flight while the rename below fires, never for it to land.
        const neverResolves = new Promise<void>(() => {})
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                calls.push({ path, body })
                if (
                    path === '/row/update' &&
                    (body as { index: unknown }).index === null
                ) {
                    await neverResolves
                }
                return base.post(path, body)
            },
            put: async (path, body) => {
                calls.push({ path, body })
                return base.put(path, body)
            },
        }
        kanbanCalls = calls
        setTransport(transport)
        const views = kanbanViews({
            order: ['description'],
            groupOrder: ['todo'],
        })
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
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)

        // A placeholder add, still in flight (its `/row/update` write is gated open) when the
        // rename below fires — the rename's batched write must exclude it, not send a
        // negative-index placeholder to the server.
        const addButton = canvas.getAllByLabelText('Add a card')[0]!
        await userEvent.click(addButton)
        const titleInput = await canvas.findByPlaceholderText(/card title/i)
        await userEvent.type(titleInput, 'not yet saved')
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

        await openColumnMenu(canvasElement, 'todo')
        await userEvent.click(await body.findByText(/^rename$/i))
        const input = await waitFor(
            () =>
                within(
                    body.getByTestId('kanban-column-menu'),
                ).getByDisplayValue('todo'),
            { timeout: 3000 },
        )
        await userEvent.clear(input)
        await userEvent.type(input, 'doing')
        await userEvent.keyboard('{Enter}')

        await waitFor(() =>
            expect(
                kanbanCalls.filter(c => c.path === '/rows/update').length,
            ).toBe(1),
        )

        const renameManyWrites = kanbanCalls.filter(
            c => c.path === '/rows/update',
        )
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
        // ONE update per real stored row, the placeholder excluded.
        expect(updates.length).toBe(2)
        for (const u of updates) {
            expect(Number.isInteger(u.index)).toBe(true)
            expect((u.index as number) >= 0).toBe(true)
            expect(u.note).toEqual({
                ...STORED_RENAME_COL_ROWS[u.index as number]!.note,
                status: 'doing',
            })
        }
    },
}

/** A stored-row placeholder (an add not yet confirmed by the server) is INERT: opening its
 *  card and trying to rename or delete it while the add is still pending must write nothing.
 *  Before the fix, `canWriteStoredRow(-1)` was `true`, so rename/delete sent `index: -1` to
 *  `/row/update` / `/row/delete`. Gates the add's own `rowCreate` open so the card stays a
 *  placeholder for the whole play(). */
export const StoredAddPendingInert: Story = {
    render: () => {
        const views = kanbanViews({ order: ['description'] })
        const config = sampleBaseConfig({ views })
        const base = fakeTransport()
        const calls: { path: string; body: unknown }[] = []
        const gate = new Promise<void>(() => {}) // never resolves — the add stays pending forever
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                calls.push({ path, body })
                if (
                    path === '/row/update' &&
                    (body as { index: unknown }).index === null
                ) {
                    await gate
                }
                return base.post(path, body)
            },
            put: async (path, body) => {
                calls.push({ path, body })
                return base.put(path, body)
            },
        }
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
        const body = within(canvasElement.ownerDocument.body)
        const addButton = canvas.getAllByLabelText('Add a card')[0]!
        await userEvent.click(addButton)
        const input = await canvas.findByPlaceholderText(/card title/i)
        await userEvent.type(input, 'ghost card')
        await userEvent.keyboard('{Enter}')

        // The gated `rowCreate` call has been SENT (proving the add itself is in flight) but
        // never resolves, so the card stays a placeholder for the rest of this play().
        await waitFor(() =>
            expect(
                kanbanCalls.some(
                    c =>
                        c.path === '/row/update' &&
                        (c.body as { index: unknown }).index === null,
                ),
            ).toBe(true),
        )
        const callsAfterAdd = kanbanCalls.length

        const title = await canvas.findByText('ghost card')
        await userEvent.click(title)
        expect(body.queryByRole('dialog')).toBeNull()

        // Neither attempt reached the transport: no write landed for either, and the card is
        // still showing, still a placeholder, still under its original title.
        expect(kanbanCalls.length).toBe(callsAfterAdd)
        expect(kanbanCalls.some(c => c.path === '/row/delete')).toBe(false)
        expect(kanbanCalls.some(c => c.path === '/move')).toBe(false)
        expect(canvas.getByText('ghost card')).toBeVisible()
    },
}
