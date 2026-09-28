import { describe, expect, test } from 'bun:test'
import {
    addRow,
    condRow,
    exprOf,
    filterToForm,
    formToFilter,
    formToWhere,
    patchRow,
    rawRow,
    removeRow,
    setConj,
    toRawRow,
    whereToForm,
} from './filterForm'

describe('filterToForm ⇄ formToFilter — never lose data', () => {
    test('absent filter → no rows, untouched writes nothing back', () => {
        const f = filterToForm(undefined)
        expect(f.rows).toEqual([])
        expect(formToFilter(f)).toBeUndefined()
    })

    test('an untouched tree is handed back byte-for-byte (same object)', () => {
        const tree = {
            and: [
                'file.hasTag("book")',
                { or: ['status == "open"', 'status == "doing"'] },
                { not: ['file.hasTag("archive")'] },
            ],
        }
        const f = filterToForm(tree)
        expect(f.conj).toBe('and')
        expect(f.rows.map(r => r.kind)).toEqual(['cond', 'raw', 'raw'])
        expect(formToFilter(f)).toBe(tree)
    })

    test('editing one row keeps nested subtrees verbatim', () => {
        const or = { or: ['status == "open"', 'status == "doing"'] }
        const not = { not: ['file.hasTag("archive")'] }
        const f = filterToForm({ and: ['file.hasTag("book")', or, not] })
        const edited = patchRow(f, 0, { val: 'movie' })
        expect(formToFilter(edited)).toEqual({
            and: ['file.hasTag("movie")', or, not],
        })
        // the subtrees are the SAME objects, not re-serialized copies
        const out = formToFilter(edited) as { and: unknown[] }
        expect(out.and[1]).toBe(or)
        expect(out.and[2]).toBe(not)
    })

    test('a top-level not: is one raw row, kept when another row is added', () => {
        const not = { not: ['file.hasTag("archive")'] }
        const f = filterToForm(not)
        expect(f.rows).toHaveLength(1)
        expect(f.rows[0]).toMatchObject({
            kind: 'raw',
            text: '!((file.hasTag("archive")))',
        })
        const added = addRow(f, {
            ...condRow('price', 'number'),
            op: 'gt',
            val: '5',
        })
        expect(formToFilter(added)).toEqual({ and: [not, 'price > 5'] })
    })

    test('an or: tree keeps its connective', () => {
        const f = filterToForm({ or: ['a', 'b'] })
        expect(f.conj).toBe('or')
        expect(formToFilter(setConj(f, 'and'))).toEqual({ and: ['a', 'b'] })
    })

    test('a flat && string splits into condition rows', () => {
        const f = filterToForm('status == "done" && price > 5')
        expect(f.conj).toBe('and')
        expect(f.rows).toMatchObject([
            { kind: 'cond', prop: 'status', op: 'equals', val: 'done' },
            { kind: 'cond', prop: 'price', op: 'gt', val: '5' },
        ])
        expect(formToFilter(f)).toBe('status == "done" && price > 5')
        expect(formToFilter(removeRow(f, 1))).toBe('status == "done"')
    })

    test('a leaf the builder would rewrite differently stays raw', () => {
        // leafToRow reads this as a string-typed equals; recompiling would emit
        // `done == "true"`, a different filter — so it must NOT become a condition row.
        const f = filterToForm({ and: ['done == true', 'price > 5'] })
        expect(f.rows[0]).toMatchObject({ kind: 'raw', text: 'done == true' })
        const edited = patchRow(f, 1, { val: '9' })
        expect(formToFilter(edited)).toEqual({
            and: ['done == true', 'price > 9'],
        })
    })

    test('a string mixing && and || is one raw row', () => {
        const src = 'a && b || c'
        const f = filterToForm(src)
        expect(f.rows).toEqual([{ kind: 'raw', text: src, orig: src }])
        expect(formToFilter(addRow(f, rawRow('d')))).toEqual({
            and: [src, 'd'],
        })
    })

    test('a malformed expression survives as a raw row', () => {
        const src = 'this is not valid )('
        const f = filterToForm(src)
        expect(f.rows[0]).toMatchObject({ kind: 'raw', text: src })
        expect(formToFilter(setConj(f, 'or'))).toBe(src)
    })

    test('an incomplete condition (no value yet) is skipped on save', () => {
        const f = addRow(filterToForm('price > 5'), condRow('status', 'string'))
        expect(formToFilter(f)).toBe('price > 5')
    })

    test('removing every row removes the key', () => {
        const f = removeRow(filterToForm('price > 5'), 0)
        expect(formToFilter(f)).toBeUndefined()
    })

    test('a valueless condition writes its bare expression', () => {
        const f = addRow(filterToForm(undefined), {
            ...condRow('done', 'boolean'),
            op: 'checked',
        })
        expect(formToFilter(f)).toBe('done')
    })

    test('toRawRow turns a condition into its expression text', () => {
        const f = toRawRow(filterToForm('price > 5'), 0)
        expect(f.rows[0]).toEqual({ kind: 'raw', text: 'price > 5' })
        expect(
            formToFilter(patchRow(f, 0, { text: 'price > 5 && price < 9' })),
        ).toBe('price > 5 && price < 9')
    })
})

describe('whereToForm ⇄ formToWhere', () => {
    test('untouched where is returned verbatim', () => {
        expect(formToWhere(whereToForm('not done'))).toBe('not done')
        expect(formToWhere(whereToForm(undefined))).toBeUndefined()
    })

    test('rows join into one parenthesised expression', () => {
        const f = setConj(whereToForm('file.hasTag("book") && price > 5'), 'or')
        expect(formToWhere(f)).toBe('(file.hasTag("book")) || (price > 5)')
    })

    test('a legacy task DSL where is preserved as raw text', () => {
        const f = whereToForm('not done')
        expect(f.rows[0]).toMatchObject({ kind: 'raw', text: 'not done' })
        const g = addRow(f, rawRow('due before today'))
        expect(formToWhere(g)).toBe('(not done) && (due before today)')
    })
})

describe('exprOf', () => {
    test('renders trees as equivalent expressions', () => {
        expect(exprOf({ and: ['a', { or: ['b', 'c'] }] })).toBe(
            '(a) && ((b) || (c))',
        )
        expect(exprOf({ not: ['a', 'b'] })).toBe('!((a) || (b))')
    })
})
