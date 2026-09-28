import { describe, expect, test } from 'bun:test'
import {
    formToSource,
    patchSource,
    sourceToForm,
    toWikilink,
} from './sourceForm'
import { addRow, rawRow, setConj } from './filterForm'

describe('sourceToForm ⇄ formToSource', () => {
    test('no source = the base owns its rows; untouched writes nothing', () => {
        const f = sourceToForm(undefined)
        expect(f.kind).toBe('own')
        expect(formToSource(f)).toBeUndefined()
    })

    test('an untouched spec is returned as the same object', () => {
        const spec = {
            kind: 'tasks' as const,
            from: '[[Keep]]',
            where: 'not done',
        }
        expect(formToSource(sourceToForm(spec))).toBe(spec)
    })

    test('switching kind writes the canonical object shape', () => {
        const f = patchSource(sourceToForm(undefined), {
            kind: 'tasks',
            from: '[[Keep]]',
        })
        expect(formToSource(f)).toEqual({ kind: 'tasks', from: '[[Keep]]' })
    })

    test('notes where edited through the filter rows', () => {
        const f0 = sourceToForm({ kind: 'notes', where: 'price > 5' })
        const f = {
            ...f0,
            where: addRow(f0.where, rawRow('file.hasTag("book")')),
        }
        expect(formToSource(f)).toEqual({
            kind: 'notes',
            where: '(price > 5) && (file.hasTag("book"))',
        })
    })

    test('a where edit alone (kind untouched) still writes', () => {
        const f0 = sourceToForm({ kind: 'notes', where: 'a && b' })
        const f = { ...f0, where: setConj(f0.where, 'or') }
        expect(formToSource(f)).toEqual({ kind: 'notes', where: '(a) || (b)' })
    })

    test('base kind keeps only ref', () => {
        const f = patchSource(sourceToForm({ kind: 'notes', where: 'x' }), {
            kind: 'base',
            ref: '[[Books]]',
        })
        expect(formToSource(f)).toEqual({ kind: 'base', ref: '[[Books]]' })
    })

    test('switching to own removes the source', () => {
        const f = patchSource(sourceToForm({ kind: 'notes' }), { kind: 'own' })
        expect(formToSource(f)).toBeUndefined()
    })

    test('empty from is dropped', () => {
        const f = patchSource(sourceToForm({ kind: 'tasks', from: '[[X]]' }), {
            from: '',
        })
        expect(formToSource(f)).toEqual({ kind: 'tasks' })
    })
})

test('toWikilink', () => {
    expect(toWikilink('reading/Books.md')).toBe('[[Books]]')
    expect(toWikilink('[[Books]]')).toBe('[[Books]]')
    expect(toWikilink('')).toBe('')
})
