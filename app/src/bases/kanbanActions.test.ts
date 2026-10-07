import { afterEach, expect, test } from 'bun:test'
import { createSignal } from 'solid-js'
import type {
    BaseConfig,
    ResultGroup,
    Row,
    ViewResult,
} from '../../../core/src/bases/types'
import { placeholderFile } from '../../../core/src/bases/types'
import { apiBase, httpTransport, setTransport, type Transport } from '../api'
import { toasts } from '../ui/toastStore'
import { createKanbanActions, type PendingMove } from './kanbanActions'
import type { DeletedMap } from './kanbanDelete'

// dropCard / deleteCard schedule their FLIP replay on the next frame; bun has no rAF.
if (!globalThis.requestAnimationFrame)
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0) as unknown as number

const originalBase = apiBase()
afterEach(() => setTransport(httpTransport(originalBase)))

type Call = { path: string; body: unknown }

/** A Transport that records every write and answers `/delete` with a trash path. */
function install(calls: Call[], failPath?: string): void {
    const nope = () => Promise.reject(new Error('not stubbed'))
    setTransport({
        getJson: nope,
        getText: nope,
        post: (path, body) => {
            calls.push({ path, body })
            if (path === failPath) return Promise.reject(new Error('boom'))
            return Promise.resolve(new Response('{}'))
        },
        put: (path, body) => {
            calls.push({ path, body })
            return Promise.resolve(new Response('{}'))
        },
        postJson: <T>(path: string, body: unknown) => {
            calls.push({ path, body })
            return Promise.resolve({ trashPath: '.trash/a.md' } as T)
        },
        writeFileChecked: nope,
        uploadAsset: nope,
        fetchAsset: nope,
        convertHeic: nope,
        stageTmpFile: nope,
        assetUrl: (t: string) => t,
        eventsUrl: () => '',
        base: () => originalBase,
    } as Transport)
}

const row = (name: string, status: string): Row => ({
    file: placeholderFile(name, `board/${name}.md`),
    note: { status },
    formula: {},
})

const GROUPS: ResultGroup[] = [
    { key: 'Todo', rows: [row('a', 'Todo'), row('b', 'Todo')] },
    { key: 'Done', rows: [] },
]

/** Real Solid signals stand in for the view's overlay state; every dep is an accessor. */
function harness(
    over: {
        groupColors?: Record<string, string>
        groups?: ResultGroup[]
        sortedRows?: (g: ResultGroup) => Row[]
        draft?: string
    } = {},
) {
    const groups = over.groups ?? GROUPS
    const [basePath, setBasePath] = createSignal<string | undefined>('b.md')
    const [colOrder, setColOrder] = createSignal<string[] | null>(null)
    const [removed, setRemoved] = createSignal<Set<string>>(new Set())
    const [pending, setPending] = createSignal<Record<string, PendingMove>>({})
    const [pendingAdds, setPendingAdds] = createSignal<never[]>([])
    const [deleted, setDeleted] = createSignal<DeletedMap>(new Map())
    let changed = 0
    const drafts: string[] = []
    const config = { properties: {} } as unknown as BaseConfig
    const result = {
        view: { type: 'kanban', groupBy: { property: 'status' } },
        groups,
        columns: [],
    } as unknown as ViewResult
    const keys = () =>
        (colOrder() ?? groups.map(g => g.key)).filter(k => !removed().has(k))
    const actions = createKanbanActions({
        basePath,
        config: () => config,
        result: () => result,
        ownsRows: () => false,
        editable: () => true,
        sortedRows: over.sortedRows ?? (g => g.rows),
        onChange: () => void changed++,
        groupBy: () => result.view.groupBy,
        groupColors: () => over.groupColors ?? {},
        titleCol: () => 'file.name',
        autoColor: k => `auto:${k}`,
        columnKeys: keys,
        groupByKey: k => groups.find(g => g.key === k) ?? { key: k, rows: [] },
        effOrder: (_r, g) => g.rows.indexOf(_r),
        overlay: {
            pending,
            setPending,
            pendingAdds,
            setPendingAdds: setPendingAdds as never,
            pendingColOrder: colOrder,
            setPendingColOrder: setColOrder,
            pendingRemovedCols: removed,
            setPendingRemovedCols: setRemoved,
            setDeletedIds: setDeleted,
        },
        drag: () => ({
            snapshotRects: () => {},
            playFlip: () => {},
            snapshotColRects: () => {},
            playColFlip: () => {},
        }),
        closeColorPicker: () => {},
        draft: () => over.draft ?? '',
        setDraft: v => void drafts.push(v),
    })
    return {
        actions,
        setBasePath,
        colOrder,
        removed,
        pending,
        pendingAdds,
        deleted,
        drafts,
        changes: () => changed,
    }
}

test('renameColumn writes columns, then moves every card in one batch', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    await h.actions.renameColumn('Todo', 'Backlog')
    expect(calls[0]).toEqual({
        path: '/set-property',
        body: {
            path: 'b.md',
            key: 'columns',
            value: ['Backlog', 'Done'],
        },
    })
    const batch = calls.find(c => c.path === '/set-properties')!
    expect((batch.body as { writes: unknown[] }).writes).toHaveLength(2)
    expect(h.changes()).toBe(1)
})

test('a failed rename rolls the overlay back and toasts', async () => {
    const calls: Call[] = []
    install(calls, '/set-property')
    const h = harness()
    const before = toasts().length
    await h.actions.renameColumn('Todo', 'Backlog')
    expect(h.removed().size).toBe(0)
    expect(h.pending()).toEqual({})
    expect(toasts()[before]!.message).toContain('Rename column failed')
})

test('deleteColumn drops the key, clears the status off each card and offers undo', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    const before = toasts().length
    await h.actions.deleteColumn('Todo')
    expect(calls.filter(c => c.path === '/delete-property')).toHaveLength(2)
    expect(h.removed().has('Todo')).toBe(true)
    expect(toasts()[before]!.message).toBe('deleted column Todo')
    expect(toasts()[before]!.action?.label).toBe('undo')
})

test('renameCard to a taken name moves to the suffixed path instead of colliding', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    const target = await h.actions.renameCard(row('b', 'Todo'), 'a')
    expect(target).toBe('board/a 2.md')
    expect(calls.find(c => c.path === '/move')?.body).toEqual({
        from: 'board/b.md',
        to: 'board/a 2.md',
    })
})

test('setColColor(null) clears the override, a value writes it', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness({ groupColors: { Todo: 'var(--graph-1)' } })
    await h.actions.setColColor('Todo', null)
    expect(calls[0]!.path).toBe('/delete-property')
    await h.actions.setColColor('Done', 'var(--graph-2)')
    expect(calls[1]).toEqual({
        path: '/set-property',
        body: {
            path: 'b.md',
            key: 'groupColors',
            value: { Todo: 'var(--graph-1)', Done: 'var(--graph-2)' },
        },
    })
})

test('deps are accessors: a basePath that changes after creation is read live', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    h.setBasePath(undefined)
    await h.actions.setColColor('Todo', 'var(--graph-0)')
    expect(calls).toEqual([])
    h.setBasePath('other.md')
    await h.actions.setColColor('Todo', 'var(--graph-0)')
    expect((calls[0]!.body as { path: string }).path).toBe('other.md')
})

/** Bounded poll on a condition — the undo paths are fire-and-forget, so wait for their effect. */
async function until(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !cond(); i++)
        await new Promise(res => setTimeout(res, 5))
    expect(cond()).toBe(true)
}

const ORDERED = (name: string, status: string): Row => row(name, status)

test('dropCard places the card by sortedRows (not raw row order) and writes status + every order', async () => {
    const calls: Call[] = []
    install(calls)
    const a = row('a', 'Todo')
    const x = ORDERED('x', 'Done')
    const y = ORDERED('y', 'Done')
    const groups: ResultGroup[] = [
        { key: 'Todo', rows: [a] },
        { key: 'Done', rows: [x, y] },
    ]
    // The view's DISPLAY order is y, x — the index a drop lands at is an index into THAT.
    const h = harness({ groups, sortedRows: g => [...g.rows].reverse() })
    await h.actions.dropCard({
        id: 'board/a.md',
        insertAt: 1,
        targetKey: 'Done',
        from: 'Todo',
    })
    expect(calls).toEqual([
        {
            path: '/set-properties',
            body: {
                writes: [
                    { path: 'board/a.md', key: 'status', value: 'Done' },
                    { path: 'board/a.md', key: 'order', value: 1 },
                    { path: 'board/y.md', key: 'order', value: 0 },
                    { path: 'board/x.md', key: 'order', value: 2 },
                ],
            },
        },
    ])
    expect(h.pending()['board/a.md']).toEqual({ key: 'Done', order: 1 })
})

test('dropCard within the same column writes no status, only orders', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    await h.actions.dropCard({
        id: 'board/a.md',
        insertAt: 1,
        targetKey: 'Todo',
        from: 'Todo',
    })
    const writes = (calls[0]!.body as { writes: { key: string }[] }).writes
    expect(writes.some(w => w.key === 'status')).toBe(false)
    expect(writes[0]).toEqual({ path: 'board/a.md', key: 'order', value: 1 })
})

test('addCard writes a note file under the board folder with the column status and a trailing order, and shows it at once', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness({ draft: 'New card' })
    await h.actions.addCard('Todo')
    const put = calls.find(c => c.path === '/file')!
    const body = put.body as { path: string; contents: string }
    expect(body.path).toBe('board/New card.md')
    expect(body.contents).toContain('status: Todo')
    expect(body.contents).toContain('order: 3')
    expect(h.pendingAdds()).toHaveLength(1)
    expect(h.pendingAdds()[0]!.col).toBe('Todo')
    expect(h.drafts).toEqual([''])
})

test('addCard with an empty draft writes nothing', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness({ draft: '   ' })
    await h.actions.addCard('Todo')
    expect(calls).toEqual([])
    expect(h.pendingAdds()).toHaveLength(0)
})

test('addColumn appends the key to columns and shows it before the refetch', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    await h.actions.addColumn('Review')
    expect(calls[0]).toEqual({
        path: '/set-property',
        body: {
            path: 'b.md',
            key: 'columns',
            value: ['Todo', 'Done', 'Review'],
        },
    })
    expect(h.colOrder()).toEqual(['Todo', 'Done', 'Review'])
})

test('deleteCard trashes the file, hides the card, and Undo restores it from the trash path', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    const before = toasts().length
    await h.actions.deleteCard(row('a', 'Todo'))
    expect(calls.find(c => c.path === '/delete')?.body).toEqual({
        path: 'board/a.md',
    })
    expect(h.deleted().has('board/a.md')).toBe(true)
    const t = toasts()[before]!
    expect(t.action).toBeDefined()
    await t.action!.onClick()
    await until(() => calls.some(c => c.path === '/restore'))
    expect(calls.find(c => c.path === '/restore')?.body).toEqual({
        trashPath: '.trash/a.md',
        to: 'board/a.md',
    })
})

test('undoing deleteColumn un-hides the column at its old index and rewrites columns', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    const before = toasts().length
    await h.actions.deleteColumn('Todo')
    expect(h.removed().has('Todo')).toBe(true)
    const t = toasts()[before]!
    expect(t.action?.label).toBe('undo')
    await t.action!.onClick()
    await until(() => !h.removed().has('Todo'))
    await until(
        () => calls.filter(c => c.path === '/set-property').length === 2,
    )
    const restore = calls.filter(c => c.path === '/set-property')[1]!
    expect(restore.body).toEqual({
        path: 'b.md',
        key: 'columns',
        value: ['Todo', 'Done'],
    })
})
