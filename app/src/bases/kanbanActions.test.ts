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
import { toasts } from '../toastStore'
import { createKanbanActions, type PendingMove } from './kanbanActions'
import type { DeletedMap } from './kanbanDelete'

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
        put: nope,
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
function harness(over: { groupColors?: Record<string, string> } = {}) {
    const [basePath, setBasePath] = createSignal<string | undefined>('b.md')
    const [colOrder, setColOrder] = createSignal<string[] | null>(null)
    const [removed, setRemoved] = createSignal<Set<string>>(new Set())
    const [pending, setPending] = createSignal<Record<string, PendingMove>>({})
    const [pendingAdds, setPendingAdds] = createSignal<never[]>([])
    const [deleted, setDeleted] = createSignal<DeletedMap>(new Map())
    let changed = 0
    const config = { properties: {} } as unknown as BaseConfig
    const result = {
        view: { type: 'kanban', groupBy: { property: 'status' } },
        groups: GROUPS,
        columns: [],
    } as unknown as ViewResult
    const keys = () =>
        (colOrder() ?? GROUPS.map(g => g.key)).filter(k => !removed().has(k))
    const actions = createKanbanActions({
        basePath,
        viewIndex: () => 0,
        config: () => config,
        result: () => result,
        ownsRows: () => false,
        onChange: () => void changed++,
        groupBy: () => result.view.groupBy,
        groupColors: () => over.groupColors ?? {},
        titleCol: () => 'file.name',
        autoColor: k => `auto:${k}`,
        columnKeys: keys,
        groupByKey: k => GROUPS.find(g => g.key === k) ?? { key: k, rows: [] },
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
        draft: () => '',
        setDraft: () => {},
    })
    return {
        actions,
        setBasePath,
        colOrder,
        removed,
        pending,
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
            viewIndex: 0,
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

test('deleteColumn drops the key, clears the status off each card and offers Undo', async () => {
    const calls: Call[] = []
    install(calls)
    const h = harness()
    const before = toasts().length
    await h.actions.deleteColumn('Todo')
    expect(calls.filter(c => c.path === '/delete-property')).toHaveLength(2)
    expect(h.removed().has('Todo')).toBe(true)
    expect(toasts()[before]!.action?.label).toBe('Undo')
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
            viewIndex: 0,
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
