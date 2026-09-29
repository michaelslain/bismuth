import { describe, expect, test } from 'bun:test'
import { parse as parseYaml } from 'yaml'
import {
    deleteFrontmatterKey,
    deleteFrontmatterViewKey,
    setFrontmatterKey,
    setFrontmatterViewKey,
} from '../../../core/src/frontmatter'
import { FRONTMATTER_RE, parseBaseFile } from '../../../core/src/bases/parse'
import {
    diffPatch,
    planSettingsWrites,
    type PlanInput,
    type WriteOp,
} from './baseSettingsPlan'

// Apply a plan through the SAME frontmatter writers the server's /set-property and
// /delete-property use, then re-parse — so every assertion is about what the base actually
// renders after SAVE, not about the op list alone.
function apply(md: string, ops: WriteOp[]): string {
    for (const o of ops) {
        if (o.op === 'set') md = setFrontmatterKey(md, o.key, o.value)
        else if (o.op === 'delete') md = deleteFrontmatterKey(md, o.key)
        else if (o.op === 'setView')
            md = setFrontmatterViewKey(md, o.index, o.key, o.value)
        else md = deleteFrontmatterViewKey(md, o.index, o.key)
    }
    return md
}

function fmOf(md: string): Record<string, unknown> {
    return parseYaml(md.match(FRONTMATTER_RE)![2]) as Record<string, unknown>
}

function save(md: string, input: Omit<PlanInput, 'frontmatter'>) {
    const plan = planSettingsWrites({ ...input, frontmatter: fmOf(md) })
    if ('error' in plan) throw new Error(plan.error)
    const out = apply(md, plan.ops)
    return {
        md: out,
        fm: fmOf(out),
        config: parseBaseFile(out, { name: 'b', path: 'b.md' }).config,
    }
}

const MULTI = `---
type: base
sort: [{ property: price, direction: ASC }]
views:
  - type: table
    name: All
  - type: cards
    name: Gallery
---
`

describe('planSettingsWrites — view scope', () => {
    test('BUG 0: saving view #2 writes view #2, not the first view', () => {
        const { config } = save(MULTI, {
            viewIndex: 1,
            view: { sort: [{ property: 'title', direction: 'DESC' }] },
            base: {},
            current: { type: 'cards', name: 'Gallery' },
        })
        expect(config.views[1].sort).toEqual([
            { property: 'title', direction: 'DESC' },
        ])
        // views[0] still carries the flat sort it had before
        expect(config.views[0].sort).toEqual([
            { property: 'price', direction: 'ASC' },
        ])
    })

    test('writing views[0] deletes the flat copy that would override it', () => {
        const { config, fm } = save(MULTI, {
            viewIndex: 0,
            view: { sort: [{ property: 'title', direction: 'DESC' }] },
            base: {},
            current: { type: 'table', name: 'All' },
        })
        expect('sort' in fm).toBe(false)
        expect(config.views[0].sort).toEqual([
            { property: 'title', direction: 'DESC' },
        ])
    })

    test('clearing a views[0] key also clears its flat copy', () => {
        const { config } = save(MULTI, {
            viewIndex: 0,
            view: { sort: undefined },
            base: {},
            current: { type: 'table', name: 'All' },
        })
        expect(config.views[0].sort).toBeUndefined()
    })

    test('rename + kind change on a multi-view base', () => {
        const { config, fm } = save(MULTI, {
            viewIndex: 1,
            view: { name: 'Board', type: 'kanban' },
            base: {},
            current: { type: 'kanban', name: 'Board' },
        })
        expect(config.views[1]).toMatchObject({ type: 'kanban', name: 'Board' })
        expect(fm.type).toBe('base')
    })

    test('an out-of-range view index is refused', () => {
        const plan = planSettingsWrites({
            frontmatter: fmOf(MULTI),
            viewIndex: 5,
            view: { limit: 3 },
            base: {},
            current: { type: 'table', name: 'x' },
        })
        expect('error' in plan).toBe(true)
    })

    test('a views: that is not a list is refused, never overwritten', () => {
        const plan = planSettingsWrites({
            frontmatter: { type: 'base', views: { a: 1 } },
            viewIndex: 0,
            view: { name: 'x' },
            base: {},
            current: { type: 'table', name: 'x' },
        })
        expect('error' in plan).toBe(true)
    })
})

const FLAT = `---
type: base
view: cards
x: date
image: cover
---
`

describe('planSettingsWrites — views-less base', () => {
    test('a foldable key stays flat', () => {
        const { fm, config } = save(FLAT, {
            viewIndex: 0,
            view: { imageFit: 'contain' },
            base: {},
            current: { type: 'cards', name: 'Cards' },
        })
        expect(fm.views).toBeUndefined()
        expect(fm.imageFit).toBe('contain')
        expect(config.views[0].imageFit).toBe('contain')
    })

    test('kind changes through the view: shorthand, never type:', () => {
        const { fm, config } = save(FLAT, {
            viewIndex: 0,
            view: { type: 'table' },
            base: {},
            current: { type: 'table', name: 'Table' },
        })
        expect(fm.type).toBe('base')
        expect(fm.view).toBe('table')
        expect(config.views[0].type).toBe('table')
    })

    test('a key that cannot live flat promotes to a views: array, keeping flat keys', () => {
        const { fm, config } = save(FLAT, {
            viewIndex: 0,
            view: { limit: 10, name: 'Covers' },
            base: {},
            current: { type: 'cards', name: 'Covers' },
        })
        expect(fm.type).toBe('base')
        expect('view' in fm).toBe(false)
        expect(config.views).toHaveLength(1)
        expect(config.views[0]).toMatchObject({
            type: 'cards',
            name: 'Covers',
            limit: 10,
            image: 'cover', // flat keys keep folding onto the promoted entry
        })
    })

    test('view filters on a views-less base do NOT overwrite the base filters', () => {
        const md = `---\ntype: base\nfilters: 'price > 5'\n---\n`
        const { config } = save(md, {
            viewIndex: 0,
            view: { filters: 'status == "open"' },
            base: {},
            current: { type: 'table', name: 'Table' },
        })
        expect(config.filters).toBe('price > 5')
        expect(config.views[0].filters).toBe('status == "open"')
    })

    test('lat/lng/zoom/center promote (they are never read flat)', () => {
        const md = `---\ntype: base\nview: map\n---\n`
        const { config } = save(md, {
            viewIndex: 0,
            view: { lat: 'latitude', zoom: 6, center: { lat: 40.7, lng: -74 } },
            base: {},
            current: { type: 'map', name: 'Map' },
        })
        expect(config.views[0]).toMatchObject({
            type: 'map',
            lat: 'latitude',
            zoom: 6,
            center: { lat: 40.7, lng: -74 },
        })
    })
})

describe('planSettingsWrites — mode + legacy calendarContent', () => {
    test('writing mode removes a flat calendarContent', () => {
        const md = `---\ntype: base\nview: list\ncalendarContent: tasks\n---\n`
        const { fm, config } = save(md, {
            viewIndex: 0,
            view: { mode: 'normal' },
            base: {},
            current: { type: 'list', name: 'List' },
        })
        expect('calendarContent' in fm).toBe(false)
        expect(config.views[0].mode).toBe('normal')
    })

    test('writing mode on views[1] removes its own calendarContent only', () => {
        const md = `---\ntype: base\ncalendarContent: tasks\nviews:\n  - type: calendar\n    name: A\n  - type: calendar\n    name: B\n    calendarContent: tasks\n---\n`
        const { config } = save(md, {
            viewIndex: 1,
            view: { mode: 'tasks' },
            base: {},
            current: { type: 'calendar', name: 'B' },
        })
        expect(config.views[1].calendarContent).toBeUndefined()
        expect(config.views[1].mode).toBe('tasks')
        expect(config.views[0].calendarContent).toBe('tasks') // untouched
    })
})

describe('planSettingsWrites — base scope', () => {
    test('source is written in object form and its string-form siblings go', () => {
        const md = `---\ntype: base\nsource: tasks\nfrom: '[[Keep]]'\nwhere: not done\n---\n`
        const { fm, config } = save(md, {
            viewIndex: 0,
            view: {},
            base: { source: { kind: 'notes', where: 'price > 5' } },
            current: { type: 'table', name: 'Table' },
        })
        expect(fm.source).toEqual({ kind: 'notes', where: 'price > 5' })
        expect('from' in fm || 'where' in fm).toBe(false)
        expect(config.source).toEqual({ kind: 'notes', where: 'price > 5' })
    })

    test('removing source returns the base to its own rows', () => {
        const md = `---\ntype: base\nsource: notes\n---\n`
        const { config } = save(md, {
            viewIndex: 0,
            view: {},
            base: { source: undefined },
            current: { type: 'table', name: 'Table' },
        })
        expect(config.source).toBeUndefined()
    })

    test('formulas + base filters are flat', () => {
        const { config } = save(MULTI, {
            viewIndex: 1,
            view: {},
            base: {
                formulas: { ppu: 'price / pages' },
                filters: { and: ['a', 'b'] },
            },
            current: { type: 'cards', name: 'Gallery' },
        })
        expect(config.formulas).toEqual({ ppu: 'price / pages' })
        expect(config.filters).toEqual({ and: ['a', 'b'] })
    })

    test('deleting an absent key is not an op', () => {
        const plan = planSettingsWrites({
            frontmatter: fmOf(MULTI),
            viewIndex: 0,
            view: { limit: undefined },
            base: { formulas: undefined },
            current: { type: 'table', name: 'All' },
        })
        expect(plan).toEqual({ ops: [] })
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
        const t = m.viewKeysFor('table', 'base')
        expect(t).toContain('summaries')
        expect(t).toContain('order')
        expect(t).not.toContain('source')
        expect(m.viewKeysFor('kanban', 'view')).toEqual(
            expect.arrayContaining(['source', 'hideLabels']),
        )
        expect(m.viewKeysFor('kanban', 'view')).not.toContain('order')
        const h = m.viewKeysFor('heatmap', 'base')
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
