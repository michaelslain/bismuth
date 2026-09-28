import { describe, expect, test } from 'bun:test'
import { mergeColumns, orderOf, seedColumns, toggleColumn } from './columnsForm'

describe('columns form', () => {
    test('no order → everything visible, and orderOf lists it all', () => {
        const s = seedColumns(undefined, ['file.name', 'price'])
        expect(s.every(c => c.visible)).toBe(true)
        expect(orderOf(s)).toEqual(['file.name', 'price'])
    })

    test('order entries the rows do not carry are kept (never dropped on save)', () => {
        const s = seedColumns(
            ['file.name', 'formula.ppu', 'note.price'],
            ['file.name', 'price', 'qty'],
        )
        expect(orderOf(s)).toEqual(['file.name', 'formula.ppu', 'note.price'])
        // `price` is the same column as `note.price` — not listed twice
        expect(s.map(c => c.col)).toEqual([
            'file.name',
            'formula.ppu',
            'note.price',
            'qty',
        ])
    })

    test('a newly available column is appended hidden; a vanished one dropped', () => {
        const s = seedColumns(['a'], ['a', 'b'])
        const m = mergeColumns(s, ['a', 'b', 'formula.x'])
        expect(m).toEqual([
            { col: 'a', visible: true },
            { col: 'b', visible: false },
            { col: 'formula.x', visible: false },
        ])
        expect(mergeColumns(m, ['a', 'b']).map(c => c.col)).toEqual(['a', 'b'])
    })

    test('the last visible column cannot be hidden', () => {
        const s = seedColumns(['a'], ['a', 'b'])
        expect(toggleColumn(s, 'a')).toEqual(s)
        expect(orderOf(toggleColumn(s, 'b'))).toEqual(['a', 'b'])
    })
})
