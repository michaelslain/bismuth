import { describe, expect, test } from 'bun:test'
import { createTaskWrites, type TaskWriteDeps } from './baseTaskWrites'
import type { Row, ViewConfig, BaseConfig } from '../../../core/src/bases/types'

const scanned = { file: { path: 'notes/a.md', name: 'a' }, note: { line: 4, statusChar: ' ' } } as unknown as Row
const stored = {
    file: { path: 'boards/t.md', name: 't' },
    index: 1,
    note: { description: 'x', status: 'todo' },
} as unknown as Row
const orphan = { file: { path: 'boards/t.md', name: 't' }, note: { description: 'x' } } as unknown as Row

function setup(over: Partial<TaskWriteDeps> = {}) {
    const log: string[] = []
    const deps: TaskWriteDeps = {
        api: {
            toggleTask: async (p, l, c) => void log.push(`toggle ${p} ${l} ${c ?? ''}`),
            rowUpdate: async (p, i) => void log.push(`update ${p} ${i}`),
            rowCreate: async p => void log.push(`create ${p}`),
        },
        appendTaskLine: async (f, t) => (log.push(`append ${f} ${t}`), f),
        openStatusMenu: (_x, _y, _cur, pick) => pick('x'),
        toast: m => log.push(`toast ${m}`),
        refetchAll: async () => void log.push('refetchAll'),
        refetchRows: async () => void log.push('refetchRows'),
        today: () => '2026-09-28',
        editPath: () => 'boards/t.md',
        config: () => ({ view: { type: 'table' } }) as unknown as BaseConfig,
        view: () => ({ type: 'table', name: 'T' }) as unknown as ViewConfig,
        ownsRows: () => true,
        rowCount: () => 0,
        ...over,
    }
    return { log, w: createTaskWrites(deps) }
}
const settle = () => new Promise(r => setTimeout(r, 0))
const ev = () => ({ stopPropagation() {}, preventDefault() {}, clientX: 1, clientY: 2 }) as unknown as MouseEvent

describe('createTaskWrites', () => {
    test('toggling a scanned task line writes the note and refetches rows only', async () => {
        const { log, w } = setup()
        w.toggleTaskRow(scanned, ev())
        await settle()
        expect(log).toEqual(['toggle notes/a.md 4 ', 'refetchRows'])
    })
    test('toggling a stored row rewrites that row and refetches everything', async () => {
        const { log, w } = setup()
        w.toggleTaskRow(stored, ev())
        await settle()
        expect(log[0]).toBe('update boards/t.md 1')
        expect(log.at(-1)).toBe('refetchAll')
    })
    test('a row with no index gets no write', async () => {
        const { log, w } = setup()
        w.toggleTaskRow(orphan, ev())
        await settle()
        expect(log).toEqual([])
    })
    test('a rejected write becomes a legible toast', async () => {
        const { log, w } = setup({
            api: {
                toggleTask: async () => {
                    throw new Error('nope')
                },
                rowUpdate: async () => {},
                rowCreate: async () => {},
            },
        })
        w.toggleTaskRow(scanned, ev())
        await settle()
        expect(log[0]).toBe('toast Could not save the task: nope')
    })
    test('the status menu writes the picked char on a scanned row', async () => {
        const { log, w } = setup()
        w.setTaskRowStatus(scanned, ev())
        await settle()
        expect(log[0]).toBe('toggle notes/a.md 4 x')
    })
    test('add task on an owned base creates a row and refetches all', async () => {
        const { log, w } = setup()
        await w.addTask()
        expect(log[0]).toBe('create boards/t.md')
        expect(log.at(-1)).toBe('refetchAll')
    })
    test('add task on a sourced view appends to its taskFile, or does nothing without one', async () => {
        const withFile = setup({
            ownsRows: () => false,
            view: () => ({ type: 'list', name: 'L', taskFile: 'inbox.md' }) as unknown as ViewConfig,
        })
        await withFile.w.addTask()
        expect(withFile.log[0]).toBe('append inbox.md New task')
        expect(withFile.log.at(-1)).toBe('refetchRows')
        const without = setup({ ownsRows: () => false })
        await without.w.addTask()
        expect(without.log).toEqual([])
    })
})
