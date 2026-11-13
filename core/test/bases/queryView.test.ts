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

// ---- a ```query block written as a base config (`source: base` + `ref:`) ----

import { mergeQueryConfig } from '../../src/bases/queryView'
import { configLayoutGiven, parseBase } from '../../src/bases/parse'

const habitsBase = parseBase(
    [
        'view: heatmap',
        'source: notes',
        'filters: file.inFolder("days")',
        'x: date',
        'y: sleep',
        'aggregate: sum',
        'formulas:',
        '  short: sleep < 6',
    ].join('\n'),
)

const configBlock = (text: string) =>
    mergeQueryConfig(habitsBase, parseBase(text), configLayoutGiven(text))

test('a config block naming the layout draws the base axes, aggregate and filters', () => {
    const c = configBlock('source: base\nref: "[[Habits]]"\nview: heatmap')
    expect(c.view.type).toBe('heatmap')
    expect(c.view.x).toBe('date')
    expect(c.view.y).toBe('sleep')
    expect(c.view.aggregate).toBe('sum')
    expect(c.filters).toBe('file.inFolder("days")')
    expect(c.formulas).toEqual({ short: 'sleep < 6' })
    expect(c.source).toEqual({ kind: 'base', ref: '[[Habits]]' })
})

test('a config block with no view keeps the base layout', () => {
    const c = configBlock('source: base\nref: "[[Habits]]"')
    expect(c.view.type).toBe('heatmap')
    expect(c.view.y).toBe('sleep')
})

test('keys the config block writes win, and its filters narrow the base filters', () => {
    const c = configBlock(
        'source: base\nref: "[[Habits]]"\nview: bar\ny: mood\naggregate: avg\nfilters: mood > 2',
    )
    expect(c.view.type).toBe('bar')
    expect(c.view.x).toBe('date')
    expect(c.view.y).toBe('mood')
    expect(c.view.aggregate).toBe('avg')
    expect(c.filters).toEqual({ and: ['file.inFolder("days")', 'mood > 2'] })
})

test('configLayoutGiven reads view: and a legacy views entry, not the parser default', () => {
    expect(configLayoutGiven('source: base\nref: "[[H]]"')).toBe(false)
    expect(configLayoutGiven('source: base\nview: heatmap')).toBe(true)
    expect(configLayoutGiven('source: base\nview: nonsense')).toBe(false)
    expect(configLayoutGiven('source: base\nviews:\n  - type: bar')).toBe(true)
})
