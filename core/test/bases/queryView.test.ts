import { test, expect } from 'bun:test'
import { parseQueryBlock } from '../../src/bases/queryBlock'
import { mergeQueryView } from '../../src/bases/queryView'
import type { ViewConfig } from '../../src/bases/types'

const base: ViewConfig = { type: 'heatmap', x: 'date', y: 'sleep', aggregate: 'sum', limit: 90 }

test('a block with no view keeps the base layout and its axes', () => {
    const v = mergeQueryView(base, parseQueryBlock('of: [[sleep]]'))
    expect(v.type).toBe('heatmap')
    expect(v.x).toBe('date')
    expect(v.y).toBe('sleep')
    expect(v.aggregate).toBe('sum')
    expect(v.limit).toBe(90)
})

test('a block view overrides the layout but keeps the base axes', () => {
    const v = mergeQueryView(base, parseQueryBlock('of: [[sleep]]\nview: bar'))
    expect(v.type).toBe('bar')
    expect(v.x).toBe('date')
    expect(v.y).toBe('sleep')
})

test('block sort, group and limit override the base when written', () => {
    const v = mergeQueryView(
        base,
        parseQueryBlock('of: [[sleep]]\nsort: date desc\ngroup: mood\nlimit: 7'),
    )
    expect(v.sort).toEqual([{ property: 'date', direction: 'DESC' }])
    expect(v.groupBy).toEqual({ property: 'mood' })
    expect(v.limit).toBe(7)
})
