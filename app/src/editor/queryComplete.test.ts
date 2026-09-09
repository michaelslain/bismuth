// app/src/editor/queryComplete.test.ts
import { test, expect } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import {
    lineInQueryBlock,
    classifyQueryLine,
    querySource,
} from './queryComplete'

// Drive the real CompletionSource against a constructed EditorState (no browser).
function complete(doc: string, pos: number, explicit = false) {
    const state = EditorState.create({ doc })
    return querySource()(new CompletionContext(state, pos, explicit))
}

// ── lineInQueryBlock ────────────────────────────────────────────────────────
test('inside a closed query block body', () => {
    const lines = ['# Note', '```query', 'of: [[Books]]', '```', 'after']
    expect(lineInQueryBlock(lines, 2)).toBe(true)
})

test('inside an UNclosed query block (still being typed)', () => {
    const lines = ['```query', 'of: '] // no closing fence yet
    expect(lineInQueryBlock(lines, 1)).toBe(true)
})

test('the opening and closing fence lines are not body', () => {
    const lines = ['```query', 'of: [[X]]', '```']
    expect(lineInQueryBlock(lines, 0)).toBe(false) // opener
    expect(lineInQueryBlock(lines, 2)).toBe(false) // closer
})

test('a non-query fence is not a query block', () => {
    const lines = ['```js', 'const x = 1', '```']
    expect(lineInQueryBlock(lines, 1)).toBe(false)
})

test('plain prose is not in a query block', () => {
    expect(lineInQueryBlock(['just text', 'more'], 1)).toBe(false)
})

test('after a closed block, back to prose', () => {
    const lines = ['```query', 'of: [[X]]', '```', 'tail']
    expect(lineInQueryBlock(lines, 3)).toBe(false)
})

// ── classifyQueryLine ───────────────────────────────────────────────────────
test('empty line is a key position', () => {
    expect(classifyQueryLine('')).toEqual({ kind: 'key', from: 0, query: '' })
})

test('partial key word', () => {
    expect(classifyQueryLine('vi')).toEqual({
        kind: 'key',
        from: 0,
        query: 'vi',
    })
})

test('indented key position keeps the indent in `from`', () => {
    expect(classifyQueryLine('  ')).toEqual({ kind: 'key', from: 2, query: '' })
})

test('view value (empty)', () => {
    expect(classifyQueryLine('view: ')).toEqual({
        kind: 'view',
        from: 6,
        query: '',
    })
})

test('view value (partial)', () => {
    expect(classifyQueryLine('view: ta')).toEqual({
        kind: 'view',
        from: 6,
        query: 'ta',
    })
})

test('legacy `as:` is treated as view', () => {
    expect(classifyQueryLine('as: car')).toEqual({
        kind: 'view',
        from: 4,
        query: 'car',
    })
})

test('group value', () => {
    expect(classifyQueryLine('group: file.')).toEqual({
        kind: 'group',
        from: 7,
        query: 'file.',
    })
})

test('tasks: has no dedicated completion (the DSL starters are gone)', () => {
    expect(classifyQueryLine('tasks: not d')).toBeNull()
})

test('where value keeps spaces', () => {
    expect(classifyQueryLine('where: !note.res')).toEqual({
        kind: 'where',
        from: 7,
        query: '!note.res',
    })
})

test('empty of: offers a ref', () => {
    expect(classifyQueryLine('of: ')).toEqual({
        kind: 'ref',
        from: 4,
        refKey: 'of',
    })
})

test('empty from: offers a ref', () => {
    expect(classifyQueryLine('from: ')).toEqual({
        kind: 'ref',
        from: 6,
        refKey: 'from',
    })
})

test('of: with a [[ defers to the wikilink source (null)', () => {
    expect(classifyQueryLine('of: [[Bo')).toBeNull()
})


// ── querySource (integration) ───────────────────────────────────────────────
test('source offers query keys at a fresh body line', () => {
    const doc = '```query\n\n```'
    const res = complete(doc, 9) // start of the empty body line
    expect(res?.options.map(o => o.label)).toEqual([
        'of',
        'tasks',
        'from',
        'where',
        'sort',
        'view',
        'group',
        'limit',
    ])
})

test('source offers all view types after `view: `', () => {
    const doc = '```query\nview: \n```'
    const res = complete(doc, 15) // just after "view: "
    expect(res?.options.map(o => o.label)).toContain('kanban')
    expect(res?.options).toHaveLength(12)
})

test('source offers the bases filter vocabulary after `where: `', () => {
    const doc = '```query\nwhere: \n```'
    const res = complete(doc, 16)
    expect(res?.options.map(o => o.label)).toContain('!note.resolved')
})

test('source stays silent after `tasks: ` (the DSL starters are gone)', () => {
    const doc = '```query\ntasks: \n```'
    expect(complete(doc, 16)).toBeNull()
})

test('source stays silent outside a query block', () => {
    expect(complete('just prose here', 5)).toBeNull()
})
