import { describe, expect, test } from 'bun:test'
import { prefixRank } from './prefixRank'

describe('prefixRank', () => {
    const order = ['planning', 'mochi', 'chicken', 'Chores', 'docs']
    test('empty query keeps every row in order', () => {
        expect(prefixRank(order, '')).toEqual(order)
        expect(prefixRank(order, '   ')).toEqual(order)
    })
    test('prefix matches lead (case-insensitive), in input order', () => {
        expect(prefixRank(order, 'ch')).toEqual(['chicken', 'Chores', 'mochi'])
    })
    test('substring-only matches follow the prefix ones', () => {
        expect(prefixRank(order, 'o')).toEqual(['mochi', 'Chores', 'docs'])
    })
    test('no match → empty', () => {
        expect(prefixRank(order, 'zz')).toEqual([])
    })
})
