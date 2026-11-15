import { test, expect, describe } from 'bun:test'
import rowsOnDoc, { type BaseDoc, type ResolvedRows } from './rowsOnDoc'
import type { BaseConfig, Row } from '../../../core/src/bases/types'

const config = (order: string[]) => ({ view: { type: 'table', order } }) as unknown as BaseConfig
const row = (path: string) => ({ file: { path } }) as unknown as Row

describe('rowsOnDoc', () => {
    test('a notes base takes the current config and keeps its resolved rows', () => {
        const stale = config(['note.sleep'])
        const fresh = config(['note.sleepTime', 'note.wakeTime'])
        const rows = [row('days/a.md')]
        const resolved: ResolvedRows = { config: stale, spec: { kind: 'notes' } as never, rows, basePath: 'Habit Tracker.md' }
        const doc: BaseDoc = { config: fresh, rows: [], basePath: 'Habit Tracker.md' }
        const out = rowsOnDoc(resolved, doc)!
        expect(out.config).toBe(fresh)
        expect(out.rows).toBe(rows)
        expect(out.spec).toBe(resolved.spec)
    })

    test("a base that owns its rows takes the current document's rows", () => {
        const oldRows = [row('a')]
        const newRows = [row('a'), row('b')]
        const resolved: ResolvedRows = { config: config([]), spec: { kind: 'base' } as never, rows: oldRows }
        const doc: BaseDoc = { config: config([]), rows: newRows }
        expect(rowsOnDoc(resolved, doc)!.rows).toBe(newRows)
    })

    test('a composed base keeps the rows its ref resolved', () => {
        const refRows = [row('x')]
        const resolved: ResolvedRows = { config: config([]), spec: { kind: 'base', ref: 'Other' } as never, rows: refRows }
        expect(rowsOnDoc(resolved, { config: config([]), rows: [] })!.rows).toBe(refRows)
    })

    test('returns the same object when nothing differs', () => {
        const c = config(['a'])
        const rows = [row('a')]
        const resolved: ResolvedRows = { config: c, spec: { kind: 'notes' } as never, rows, basePath: 'b.md' }
        expect(rowsOnDoc(resolved, { config: c, rows: [], basePath: 'b.md' })).toBe(resolved)
    })

    test('passes undefined through', () => {
        expect(rowsOnDoc(undefined, { config: config([]), rows: [] })).toBeUndefined()
        const resolved: ResolvedRows = { config: config([]), rows: [] }
        expect(rowsOnDoc(resolved, undefined)).toBe(resolved)
    })
})
