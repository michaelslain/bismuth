import { describe, expect, test } from 'bun:test'
import { applyRowOps, planDeletes, planMoves } from './bookRowPlan'

describe('bookRowPlan', () => {
    test('deletes run last first and leave the rest in order', () => {
        const { ops, rows } = planDeletes(['a', 'b', 'c', 'd'], new Set(['b', 'd']))
        expect(ops).toEqual([
            { op: 'delete', index: 3 },
            { op: 'delete', index: 1 },
        ])
        expect(rows).toEqual(['a', 'c'])
        expect(applyRowOps(['a', 'b', 'c', 'd'], ops)).toEqual(['a', 'c'])
    })

    test('moves put pages in the new order', () => {
        const rows = ['a', 'b', 'c', 'new1']
        const order = ['new1', 'c', 'a', 'b']
        expect(applyRowOps(rows, planMoves(rows, order))).toEqual(order)
    })

    test('rows that are not pages keep their places', () => {
        const rows = ['a', 'note', 'b', 'c']
        const order = ['c', 'b', 'a']
        expect(applyRowOps(rows, planMoves(rows, order))).toEqual(['c', 'note', 'b', 'a'])
    })

    test('an order already in place needs no moves', () => {
        expect(planMoves(['a', 'b'], ['a', 'b'])).toEqual([])
    })
})
