import { describe, expect, test } from 'bun:test'
import {
    buildFormulas,
    duplicateFormulaNames,
    formulaColumns,
    formulaError,
    nextFormulaName,
    seedFormulaRows,
    updateFormula,
    removeFormula,
    addFormula,
} from './formulasForm'

describe('formulas form', () => {
    test('seed → build round-trips the map in order', () => {
        const m = { ppu: 'price / pages', total: 'price * qty' }
        const rows = seedFormulaRows(m)
        expect(rows.map(r => r.name)).toEqual(['ppu', 'total'])
        expect(buildFormulas(rows)).toEqual(m)
    })

    test('no formulas → undefined (remove the key)', () => {
        expect(buildFormulas(seedFormulaRows(undefined))).toBeUndefined()
        expect(buildFormulas([{ name: '  ', expr: 'x' }])).toBeUndefined()
    })

    test('rename keeps the expression under the new key', () => {
        const rows = seedFormulaRows({ ppu: 'price / pages' })
        rows[0] = { ...rows[0], name: 'per page' }
        expect(buildFormulas(rows)).toEqual({ 'per page': 'price / pages' })
    })

    test('duplicate names are flagged (the later one)', () => {
        const rows = [
            { name: 'a', expr: '1' },
            { name: 'b', expr: '2' },
            { name: 'a ', expr: '3' },
        ]
        expect([...duplicateFormulaNames(rows)]).toEqual([2])
        expect(buildFormulas(rows)).toEqual({ a: '1', b: '2' })
    })

    test('nextFormulaName is unique', () => {
        expect(nextFormulaName([])).toBe('formula')
        expect(nextFormulaName([{ name: 'formula', expr: '' }])).toBe(
            'formula 2',
        )
    })

    test('formulaError reports an unparsable expression', () => {
        expect(formulaError('price * qty')).toBeNull()
        expect(formulaError('')).toBeNull()
        expect(formulaError('price *')).not.toBeNull()
    })

    test('formulaColumns', () => {
        expect(
            formulaColumns([
                { name: 'ppu', expr: 'x' },
                { name: '', expr: 'y' },
            ]),
        ).toEqual(['formula.ppu'])
    })
})

describe('formula row reducers', () => {
    const rows = [
        { name: 'a', expr: '1' },
        { name: 'b', expr: '2' },
    ]
    test('updateFormula patches one row, leaves the rest', () => {
        expect(updateFormula(rows, 1, { expr: '3' })).toEqual([
            { name: 'a', expr: '1' },
            { name: 'b', expr: '3' },
        ])
        expect(updateFormula(rows, 0, { name: 'z' })[0]).toEqual({ name: 'z', expr: '1' })
    })
    test('removeFormula drops the indexed row', () => {
        expect(removeFormula(rows, 0)).toEqual([{ name: 'b', expr: '2' }])
    })
    test('addFormula appends a uniquely named empty row', () => {
        expect(addFormula([])).toEqual([{ name: 'formula', expr: '' }])
        expect(addFormula([{ name: 'formula', expr: '' }])[1].name).toBe('formula 2')
    })
    test('reducers do not mutate their input', () => {
        updateFormula(rows, 0, { name: 'q' })
        removeFormula(rows, 0)
        addFormula(rows)
        expect(rows).toHaveLength(2)
        expect(rows[0].name).toBe('a')
    })
})
