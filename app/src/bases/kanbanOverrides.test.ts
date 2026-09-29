import { describe, expect, test } from 'bun:test'
import {
    applyOverrides,
    bareKey,
    coerceMeta,
    reconcileOverrides,
    withOverride,
} from './kanbanOverrides'
import type { BaseConfig, Row } from '../../../core/src/bases/types'

const row = (note: Record<string, unknown>): Row =>
    ({
        file: { name: 'a', path: 'a.md' },
        note,
        formula: {},
    }) as unknown as Row

describe('bareKey', () => {
    test('strips only a leading note. prefix', () => {
        expect(bareKey('note.status')).toBe('status')
        expect(bareKey('status')).toBe('status')
        expect(bareKey('file.name')).toBe('file.name')
    })
})

describe('applyOverrides', () => {
    test('returns the same row when nothing is pending', () => {
        const r = row({ a: 1 })
        expect(applyOverrides(r, {})).toBe(r)
    })
    test('patches row.note under the bare key for either id spelling', () => {
        const r = row({ a: 1, b: 2 })
        const out = applyOverrides(r, { 'note.a': 9, b: null })
        expect(out.note).toEqual({ a: 9, b: null })
        expect(r.note).toEqual({ a: 1, b: 2 })
    })
})

describe('reconcileOverrides', () => {
    test('drops an override once the live row matches it', () => {
        const next = reconcileOverrides({ 'note.a': 9, b: 3 }, row({ a: 9, b: 2 }))
        expect(next).toEqual({ b: 3 })
    })
    test('null override matches a missing key', () => {
        expect(reconcileOverrides({ a: null }, row({}))).toEqual({})
    })
    test('returns the same object when nothing changed', () => {
        const cur = { a: 1 }
        expect(reconcileOverrides(cur, row({ a: 2 }))).toBe(cur)
    })
})

describe('withOverride', () => {
    test('adds without mutating', () => {
        const cur = { a: 1 }
        expect(withOverride(cur, 'b', 2)).toEqual({ a: 1, b: 2 })
        expect(cur).toEqual({ a: 1 })
    })
})

describe('coerceMeta', () => {
    const config = {
        properties: { n: { type: { kind: 'number' } } },
    } as unknown as BaseConfig
    test('coerces through a declared type', () => {
        expect(coerceMeta(config, 'n', '4')).toBe(4)
        expect(coerceMeta(config, 'note.n', '  ')).toBeNull()
    })
    test('undeclared passes through, undefined becomes null', () => {
        expect(coerceMeta(config, 'x', 'hi')).toBe('hi')
        expect(coerceMeta(config, 'x', undefined)).toBeNull()
    })
})
