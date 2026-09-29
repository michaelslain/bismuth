import { describe, expect, test } from 'bun:test'
import { parse as parseYaml } from 'yaml'
import {
    deleteFrontmatterKey,
    setFrontmatterKey,
} from '../../../core/src/frontmatter'
import { flattenBaseViews } from '../../../core/src/bases/flattenViews'
import { FRONTMATTER_RE, parseBaseFile } from '../../../core/src/bases/parse'
import { diffPatch, planSettingsWrites, type Patch } from './baseSettingsPlan'

// Apply a patch the way the server's /set-property and /delete-property do — flatten a legacy
// `views:` list first, then one top-level key write per op — and re-parse, so every assertion is
// about what the base actually renders after SAVE, not about the op list alone.
function save(md: string, patch: Patch) {
    let out = flattenBaseViews(md)
    for (const o of planSettingsWrites(patch))
        out =
            o.op === 'set'
                ? setFrontmatterKey(out, o.key, o.value)
                : deleteFrontmatterKey(out, o.key)
    return {
        md: out,
        fm: parseYaml(out.match(FRONTMATTER_RE)![2]) as Record<string, unknown>,
        config: parseBaseFile(out, { name: 'b', path: 'b.md' }).config,
    }
}

const FLAT = `---
type: base
view: cards
x: date
image: cover
---
`

describe('planSettingsWrites — flat keys', () => {
    test('a view key is a top-level key', () => {
        const { fm, config } = save(FLAT, { imageFit: 'contain', limit: 10 })
        expect(fm.views).toBeUndefined()
        expect(fm.imageFit).toBe('contain')
        expect(config.view).toMatchObject({
            type: 'cards',
            imageFit: 'contain',
            limit: 10,
            image: 'cover',
        })
    })

    test('the kind is written as view:, never type:', () => {
        const { fm, config } = save(FLAT, { view: 'table' })
        expect(fm.type).toBe('base')
        expect(fm.view).toBe('table')
        expect(config.view.type).toBe('table')
    })

    test('clearing a key deletes it', () => {
        const { fm } = save(FLAT, { image: undefined })
        expect('image' in fm).toBe(false)
    })

    test('filters, formulas and lat/lng/zoom/center are flat too', () => {
        const md = `---\ntype: base\nview: map\nfilters: 'price > 5'\n---\n`
        const { config } = save(md, {
            filters: { and: ['a', 'b'] },
            formulas: { ppu: 'price / pages' },
            lat: 'latitude',
            zoom: 6,
            center: { lat: 40.7, lng: -74 },
        })
        expect(config.filters).toEqual({ and: ['a', 'b'] })
        expect(config.formulas).toEqual({ ppu: 'price / pages' })
        expect(config.view).toMatchObject({
            type: 'map',
            lat: 'latitude',
            zoom: 6,
            center: { lat: 40.7, lng: -74 },
        })
    })

    test('an empty patch writes nothing', () => {
        expect(planSettingsWrites({})).toEqual([])
    })
})

describe('planSettingsWrites — mode + legacy calendarContent', () => {
    test('writing mode removes a flat calendarContent', () => {
        const md = `---\ntype: base\nview: list\ncalendarContent: tasks\n---\n`
        const { fm, config } = save(md, { mode: 'normal' })
        expect('calendarContent' in fm).toBe(false)
        expect(config.view.mode).toBe('normal')
    })
})

describe('planSettingsWrites — source', () => {
    test('source is written in object form and its string-form siblings go', () => {
        const md = `---\ntype: base\nsource: tasks\nfrom: '[[Keep]]'\nwhere: not done\n---\n`
        const { fm, config } = save(md, {
            source: { kind: 'notes', where: 'price > 5' },
        })
        expect(fm.source).toEqual({ kind: 'notes', where: 'price > 5' })
        expect('from' in fm || 'where' in fm).toBe(false)
        expect(config.source).toEqual({ kind: 'notes', where: 'price > 5' })
    })

    test('removing source returns the base to its own rows', () => {
        const md = `---\ntype: base\nsource: notes\n---\n`
        const { config } = save(md, { source: undefined })
        expect(config.source).toBeUndefined()
    })
})

describe('planSettingsWrites — a legacy single-entry views: file', () => {
    const LEGACY = `---
type: base
filters: 'price > 5'
source:
  kind: notes
  where: 'a > 1'
views:
  - type: cards
    name: Gallery
    image: cover
    filters: 'status == "open"'
    sort:
      - property: price
        direction: ASC
---
`

    test('saving through the plan flattens it and parses to the intended config', () => {
        const before = parseBaseFile(LEGACY, { name: 'b', path: 'b.md' }).config
        const { fm, config } = save(LEGACY, {
            sort: [{ property: 'title', direction: 'DESC' }],
            view: 'table',
        })
        expect('views' in fm).toBe(false)
        expect(fm.type).toBe('base')
        expect(config.view).toMatchObject({
            type: 'table',
            image: 'cover',
            sort: [{ property: 'title', direction: 'DESC' }],
        })
        // untouched keys keep what the legacy file parsed to
        expect(config.filters).toEqual(before.filters)
        expect(config.source).toEqual(before.source)
    })
})

test('diffPatch only reports changed keys among those asked for', () => {
    expect(
        diffPatch(
            { a: 1, b: [1], c: 'x' },
            { a: 1, b: [2], c: undefined, d: 5 },
            ['a', 'b', 'c'],
        ),
    ).toEqual({ b: [2], c: undefined })
})

describe('form text → values', () => {
    test('numbers, limits, centers', async () => {
        const m = await import('./baseSettingsPlan')
        expect(m.numberOrUndefined('')).toBeUndefined()
        expect(m.numberOrUndefined('abc')).toBeUndefined()
        expect(m.numberOrUndefined('6')).toBe(6)
        expect(m.limitOrUndefined('0')).toBeUndefined()
        expect(m.limitOrUndefined('12.7')).toBe(12)
        expect(m.centerOrUndefined('40.7', '')).toBeUndefined()
        expect(m.centerOrUndefined('40.7', '-74')).toEqual({
            lat: 40.7,
            lng: -74,
        })
        expect(m.orUndefined('')).toBeUndefined()
        expect(m.orUndefined('body')).toBe('body')
    })
})

describe('settings plan — kinds, field bindings, column options', () => {
    test('record and chart kinds', async () => {
        const m = await import('./baseSettingsPlan')
        expect(m.isRecordKind('table')).toBe(true)
        expect(m.isRecordKind('bar')).toBe(false)
        expect(m.isChartKind('heatmap')).toBe(true)
        expect(m.isChartKind('kanban')).toBe(false)
        expect(m.showsColumns('table')).toBe(true)
        expect(m.showsColumns('kanban')).toBe(false)
        expect(m.showsMode('calendar')).toBe(true)
        expect(m.showsMode('bar')).toBe(false)
    })

    test('field bindings per kind, and the shared union', async () => {
        const m = await import('./baseSettingsPlan')
        expect(m.fieldsFor('flashcards').map(f => f.key)).toEqual([
            'frontField',
            'backField',
            'dueField',
            'easeField',
            'intervalField',
        ])
        expect(m.fieldsFor('table')).toEqual([])
        expect(m.fieldsFor('bar')).toBe(m.fieldsFor('line'))
        // x/y are shared by four chart kinds but listed once
        const keys = m.ALL_FIELDS.map(f => f.key)
        expect(keys.filter(k => k === 'x')).toHaveLength(1)
        expect(keys).toContain('image')
    })

    test('column options union the current value + default, optional gets none', async () => {
        const m = await import('./baseSettingsPlan')
        const image = m.fieldsFor('cards')[0]
        const opts = m.columnBindingOptions(image, 'cover', ['status'])
        expect(opts.map(o => o.value)).toEqual(['', 'status', 'cover'])
        expect(opts[0].label).toBe('text cover')
        const front = m.fieldsFor('flashcards')[0]
        expect(
            m.columnBindingOptions(front, 'status', ['status']).map(o => o.value),
        ).toEqual(['status', 'front'])
    })

    test('view keys follow the kind', async () => {
        const m = await import('./baseSettingsPlan')
        const t = m.viewKeysFor('table')
        expect(t).toContain('summaries')
        expect(t).toContain('order')
        expect(t).toEqual(expect.arrayContaining(['view', 'filters', 'source']))
        expect(m.viewKeysFor('kanban')).toContain('hideLabels')
        expect(m.viewKeysFor('kanban')).not.toContain('order')
        const h = m.viewKeysFor('heatmap')
        expect(h).toContain('aggregate')
        expect(h).not.toContain('bin')
    })

    test('the open property row follows its content through remove and move', async () => {
        const m = await import('./baseSettingsPlan')
        expect(m.indexAfterRemove(null, 1)).toBeNull()
        expect(m.indexAfterRemove(1, 1)).toBeNull()
        expect(m.indexAfterRemove(3, 1)).toBe(2)
        expect(m.indexAfterRemove(0, 1)).toBe(0)
        expect(m.indexAfterMove(2, 2, 3)).toBe(3)
        expect(m.indexAfterMove(3, 2, 3)).toBe(2)
        expect(m.indexAfterMove(0, 2, 3)).toBe(0)
        expect(m.indexAfterMove(null, 2, 3)).toBeNull()
    })
})
