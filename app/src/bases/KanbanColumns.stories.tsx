// Visual spec for <KanbanView>'s column management: add/rename/delete a column, the column
// `…` menu, and the trailing "+ column" composer (AddColumn). Split out of KanbanView.stories.tsx
// — board rendering + colour lives there, own-rows/row-write behaviour in
// KanbanStoredRows.stories.tsx. Exercises `sampleViewResult` end to end: real rows, run through
// the real query engine (core/src/bases/query.ts `runView`) with a `groupBy`, rendered by the
// real KanbanView component. `onChange` is a required prop (fired after a write); a no-op here
// since nothing in these stories persists.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { KanbanView } from './KanbanView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { setTransport } from '../api'
import {
    boardWidths,
    fontsSettled,
    ghostOf,
    inputTextOrigin,
    restTextOrigin,
} from '../ui/_kanbanAddColumnAssertions'
import { fakeTransport } from '../ui/_fakeTransport'
import { kanbanViews, openColumnMenu } from '../ui/_kanbanProbes'
import { spiedTransport } from '../ui/_kanbanSpiedTransport'
import type { Transport } from '../api'
import { toasts } from '../toastStore'

const meta = {
    title: 'Bases/KanbanView/Columns',
    component: KanbanView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

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
        const views = kanbanViews({ order: undefined })
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

        // The `+ column` text-node top must land level with a real column title's, within 1px
        // (kanban-polish finding 2/1: the header's min-height pin + the ghost's derived
        // padding-top). Measured via a Range over each text node's own glyph box, not the
        // element's box, so ascender/descender padding can't hide a real mismatch.
        await fontsSettled()
        const ghost = ghostOf(canvasElement)
        const firstColumn = canvasElement.querySelector(
            '[data-kbcol]',
        ) as HTMLElement
        const firstColumnKey = firstColumn.getAttribute('data-kbcol') as string
        const titleEl = within(firstColumn).getByText(firstColumnKey)
        const range = document.createRange()
        range.selectNodeContents(titleEl.firstChild as Node)
        const titleTop = range.getBoundingClientRect().top
        const restOrigin = restTextOrigin(ghost)
        expect(Math.abs(restOrigin.y - titleTop)).toBeLessThanOrEqual(1)

        // Every column's width (and the ghost's), not just the first — a reflow anywhere on the
        // board changes at least one.
        const restWidths = boardWidths(canvasElement)
        await userEvent.click(ghost.querySelector('button') as HTMLElement)
        const input = (await canvas.findByPlaceholderText(
            'name',
        )) as HTMLInputElement

        // The swap into the input must not move the text or reflow the board — the same
        // measurement KanbanAddColumn.stories' Editing asserts.
        const editOrigin = inputTextOrigin(input)
        expect(Math.abs(editOrigin.x - restOrigin.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(editOrigin.y - restOrigin.y)).toBeLessThanOrEqual(1)
        expect(boardWidths(canvasElement)).toEqual(restWidths)

        await userEvent.type(input, 'Blocked')
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(canvasElement.querySelectorAll('[data-kbcol]').length).toBe(
                columnsBefore + 1,
            ),
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
        const views = kanbanViews()
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
        await openColumnMenu(canvasElement, 'Todo')
        await userEvent.click(await body.findByText(/^rename$/i))
        // The rename input focuses via queueMicrotask inside a portal — under a loaded pooled
        // run findBy's 1000ms default raced it, so wait longer, scoped to the menu panel.
        const input = await waitFor(
            () =>
                within(
                    body.getByTestId('kanban-column-menu'),
                ).getByDisplayValue('Todo'),
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

        const cardsWrite = kanbanCalls.find(c => c.path === '/set-properties')
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

// Released by play() once it has driven both renames through their optimistic state — holds
// every `columns` write open so the second rename's dispatch happens while the first is still
// in flight, the exact overlap `renameColumn`'s rollback bookkeeping has to survive.
let releaseRenameRoundTripWrites: () => void = () => {}

/** Rename Todo -> Backlog -> Todo, quickly (task 1's fix): `renameColumn` adds `from` to
 *  `pendingRemovedCols` on every call but, before the fix, never cleared a PRIOR call's
 *  removal of the rename's own TARGET — so renaming back to `Todo` while the first `columns`
 *  write was still in flight left both `Todo` and `Backlog` marked removed, hiding the column
 *  and its cards until the server groups changed shape. Gating the `columns` write open keeps
 *  both renames' optimistic state live at once instead of letting the first settle before the
 *  second starts. */
export const RenameColumnRoundTrip: Story = {
    render: () => {
        const base = fakeTransport()
        const calls: { path: string; body: unknown }[] = []
        const gate = new Promise<void>(resolve => {
            releaseRenameRoundTripWrites = resolve
        })
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                calls.push({ path, body })
                if (
                    path === '/set-property' &&
                    (body as { key?: string }).key === 'columns'
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
        const views = kanbanViews()
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-rename-round-trip.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(canvasElement.ownerDocument.body)

        async function renameVia(fromKey: string, toName: string) {
            await openColumnMenu(canvasElement, fromKey)
            await userEvent.click(await body.findByText(/^rename$/i))
            const input = await waitFor(
                () =>
                    within(
                        body.getByTestId('kanban-column-menu'),
                    ).getByDisplayValue(fromKey),
                { timeout: 3000 },
            )
            await userEvent.clear(input)
            await userEvent.type(input, toName)
            await userEvent.keyboard('{Enter}')
        }

        await renameVia('Todo', 'Backlog')
        expect(
            canvasElement.querySelector('[data-kbcol="Backlog"]'),
        ).not.toBeNull()
        expect(canvasElement.querySelector('[data-kbcol="Todo"]')).toBeNull()

        // The Backlog -> Todo rename dispatches while the FIRST rename's `columns` write is
        // still gated open — the overlap the fix has to survive.
        await renameVia('Backlog', 'Todo')
        expect(
            canvasElement.querySelector('[data-kbcol="Todo"]'),
        ).not.toBeNull()

        releaseRenameRoundTripWrites()
        await waitFor(() =>
            expect(
                kanbanCalls.filter(
                    c =>
                        c.path === '/set-property' &&
                        (c.body as { key?: string }).key === 'columns',
                ).length,
            ).toBe(2),
        )
        expect(
            canvasElement.querySelector('[data-kbcol="Todo"]'),
        ).not.toBeNull()
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
        const views = kanbanViews({
            groupOrder: ['Todo', 'Doing', 'Blocked', 'Done'],
        })
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
        expect(
            canvasElement.querySelector('[data-kbcol="Blocked"]'),
        ).not.toBeNull()

        await openColumnMenu(canvasElement, 'Blocked')
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
        expect((columnsWrite!.body as { value: string[] }).value).not.toContain(
            'Blocked',
        )
    },
}

/** `renameColumn` writes `columns` first, then moves the column's `groupColors` pin. When
 *  `columns` lands but the `groupColors` write rejects, the `columns` write already landed, so the
 *  toast reads `Rename column partially applied`, not `Rename column failed`. The local overlay
 *  still rolls back, and the app's refetch (`props.onChange`) reconciles the board with the
 *  server. */
export const RenameColumnPartial: Story = {
    render: () => {
        const base = fakeTransport()
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                if (
                    path === '/set-property' &&
                    (body as { key?: string }).key === 'groupColors'
                )
                    throw new Error('base file changed underneath')
                return base.post(path, body)
            },
        }
        setTransport(transport)
        const views = kanbanViews()
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-rename-partial.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(canvasElement.ownerDocument.body)
        const before = toasts().length
        await openColumnMenu(canvasElement, 'Todo')
        await userEvent.click(await body.findByText(/^rename$/i))
        const input = await waitFor(
            () =>
                within(
                    body.getByTestId('kanban-column-menu'),
                ).getByDisplayValue('Todo'),
            { timeout: 3000 },
        )
        await userEvent.clear(input)
        await userEvent.type(input, 'Backlog')
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(toasts().length).toBe(before + 1))
        expect(toasts()[before].message).toContain(
            'Rename column partially applied',
        )
        // NOT asserting the column's visible key here: `renameColumn`'s catch unconditionally
        // reverts the local `pendingColOrder`/`pending` overlay on ANY failure (columnsLanded
        // only picks the toast wording), relying on the app's own refetch (`props.onChange` ->
        // BaseView's SSE-driven revalidation) to reconcile the visible board with the server's
        // already-renamed state — a static-result story has no such refetch to observe.
    },
}

/** Same partial-failure shape as `RenameColumnPartial`, for delete: `columns` drops the key
 *  first, then the `groupColors` cleanup write (only issued when the column HAD an override —
 *  hence the seeded `groupColors` below) rejects. The column is already gone server-side, so the
 *  toast reads `Delete column partially applied`, not `Delete column failed`. */
export const DeleteColumnPartial: Story = {
    render: () => {
        const base = fakeTransport()
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                if (
                    (path === '/set-property' || path === '/delete-property') &&
                    (body as { key?: string }).key === 'groupColors'
                )
                    throw new Error('base file changed underneath')
                return base.post(path, body)
            },
        }
        setTransport(transport)
        const views = kanbanViews({
            groupOrder: ['Todo', 'Doing', 'Blocked', 'Done'],
            groupColors: { Blocked: '#e06c6c' },
        })
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-delete-partial.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(canvasElement.ownerDocument.body)
        const before = toasts().length
        await openColumnMenu(canvasElement, 'Blocked')
        const del = await body.findByText(/^delete$/i)
        await userEvent.click(del)
        await waitFor(() => expect(toasts().length).toBe(before + 1))
        expect(toasts()[before].message).toContain(
            'Delete column partially applied',
        )
        // NOT asserting the column is gone from the DOM here: `deleteColumn`'s catch
        // unconditionally reverts the local `pendingRemovedCols` overlay on ANY failure —
        // same reliance on the app's own refetch as `RenameColumnPartial` above.
    },
}

/** `addColumn`'s rollback (task 1's fix): delete the empty "Blocked" column, then re-add the
 *  same name while the delete's own removal is still the only record of it (this story never
 *  simulates a refetch, so `pendingRemovedCols` never clears on its own) — and make the ADD's
 *  `columns` write reject. Before the fix, the catch only restored `pendingColOrder`, so the
 *  removal `addColumn` had optimistically cleared for the re-add never came back: the column
 *  would show neither as present (the failed add) nor as removed (the lost bookkeeping) —
 *  invisible until an unrelated refetch happened to reconcile it. */
export const AddColumnFailsRestoresRemoved: Story = {
    render: () => {
        const base = fakeTransport()
        const calls: { path: string; body: unknown }[] = []
        let columnsWrites = 0
        const transport: Transport = {
            ...base,
            post: async (path, body) => {
                calls.push({ path, body })
                if (
                    path === '/set-property' &&
                    (body as { key?: string }).key === 'columns'
                ) {
                    columnsWrites++
                    // The first `columns` write is the DELETE (must land so the column is
                    // really gone server-side); the second is the re-add, which fails.
                    if (columnsWrites === 2) throw new Error('network down')
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
            groupOrder: ['Todo', 'Doing', 'Blocked', 'Done'],
        })
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-addcolumn-fails.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const before = toasts().length

        await openColumnMenu(canvasElement, 'Blocked')
        const del = await body.findByText(/^delete$/i)
        await userEvent.click(del)
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-kbcol="Blocked"]'),
            ).toBeNull(),
        )

        await userEvent.click(canvas.getByText('+ column'))
        const input = await canvas.findByPlaceholderText('name')
        await userEvent.type(input, 'Blocked')
        await userEvent.keyboard('{Enter}')

        // No ToastHost is mounted around a standalone KanbanView story, so the failure's
        // "Add column failed" toast never reaches the DOM — assert against the toast STORE
        // instead, which needs no host mounted.
        await waitFor(() => expect(toasts().length).toBe(before + 1))
        expect(toasts()[before].message).toMatch(/add column failed/i)
        // The re-add's failure left the column exactly as removed as the delete left it —
        // still hidden, not a phantom half-state.
        expect(canvasElement.querySelector('[data-kbcol="Blocked"]')).toBeNull()
    },
}

/** A rename that lands on a key whose `autoColor` equals the OLD key's `autoColor` (no
 *  `groupColors` override on either side) stays Auto — the fix skips the `groupColors` write
 *  entirely rather than pinning a color the user never chose, which would show a plain rename
 *  as a custom color. "Todo" and "Todox" both fall through to the same hash-of-key palette slot
 *  (no `STATUS_COLOR` entry for either), so this rename is exactly that case. */
export const RenameColumnKeepsAuto: Story = {
    render: () => {
        const { transport, calls } = spiedTransport()
        kanbanCalls = calls
        setTransport(transport)
        const views = kanbanViews()
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-rename-keeps-auto.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(canvasElement.ownerDocument.body)
        await openColumnMenu(canvasElement, 'Todo')
        await userEvent.click(await body.findByText(/^rename$/i))
        const input = await waitFor(() =>
            within(body.getByTestId('kanban-column-menu')).getByDisplayValue(
                'Todo',
            ),
        )
        await userEvent.clear(input)
        // A same-auto-color key that isn't just casing/whitespace of the original, so this
        // exercises the hash fallback comparison rather than the (trivially equal) identity case.
        await userEvent.type(input, 'Todox')
        await userEvent.keyboard('{Enter}')

        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-kbcol="Todox"]'),
            ).not.toBeNull(),
        )
        expect(
            kanbanCalls.some(
                c =>
                    c.path === '/set-property' &&
                    (c.body as { key?: string }).key === 'groupColors',
            ),
        ).toBe(false)
    },
}
