// app/src/editor/queryBuilderEdit.test.ts
// Pure, DOM-free: proves queryFenceText()/replaceQueryBody() without mounting CodeMirror's
// view layer (an EditorState is enough — no EditorView needed to apply a TransactionSpec's
// changes and read back the resulting doc).
import { test, expect } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { queryFenceText, replaceQueryBody } from './queryBuilderEdit'

// Two ```query fences, one blank line apart — the adjacent-fence spacing blockLocate.ts's own
// doc comment calls out as the case that hides an off-by-one.
const TWO_FENCE_DOC = [
    '# Title',
    '',
    '```query',
    'of: [[A]]',
    '```',
    '',
    '```query',
    'of: [[B]]',
    '```',
    '',
    'trailing text',
].join('\n')

test('queryFenceText wraps a body in ```query fences', () => {
    expect(queryFenceText('of: [[A]]')).toBe('```query\nof: [[A]]\n```')
})

test('queryFenceText: empty body still produces a valid empty fence', () => {
    expect(queryFenceText('')).toBe('```query\n\n```')
})

test('replaceQueryBody: replaces block 0 of a two-fence doc, leaving block 1 untouched', () => {
    const state = EditorState.create({ doc: TWO_FENCE_DOC })
    const spec = replaceQueryBody(state, 0, 'of: [[Replaced]]')
    expect(spec).not.toBeNull()
    const next = state.update(spec!)
    expect(next.state.doc.toString()).toBe(
        [
            '# Title',
            '',
            '```query',
            'of: [[Replaced]]',
            '```',
            '',
            '```query',
            'of: [[B]]',
            '```',
            '',
            'trailing text',
        ].join('\n'),
    )
})

test('replaceQueryBody: replaces block 1 of a two-fence doc, leaving block 0 untouched', () => {
    const state = EditorState.create({ doc: TWO_FENCE_DOC })
    const spec = replaceQueryBody(state, 1, 'of: [[Replaced]]')
    expect(spec).not.toBeNull()
    const next = state.update(spec!)
    expect(next.state.doc.toString()).toBe(
        [
            '# Title',
            '',
            '```query',
            'of: [[A]]',
            '```',
            '',
            '```query',
            'of: [[Replaced]]',
            '```',
            '',
            'trailing text',
        ].join('\n'),
    )
})

test('replaceQueryBody: a stale/out-of-range block index returns null (no-op, never a wrong write)', () => {
    const state = EditorState.create({ doc: TWO_FENCE_DOC })
    expect(replaceQueryBody(state, 2, 'of: [[C]]')).toBeNull()
    expect(replaceQueryBody(state, -1, 'of: [[C]]')).toBeNull()
})

test('replaceQueryBody: an empty document (no fences at all) always returns null', () => {
    const state = EditorState.create({ doc: 'just some prose\n' })
    expect(replaceQueryBody(state, 0, 'of: [[C]]')).toBeNull()
})

test('replaceQueryBody: an empty replacement body collapses the fence to an empty block', () => {
    const state = EditorState.create({ doc: TWO_FENCE_DOC })
    const spec = replaceQueryBody(state, 0, '')
    expect(spec).not.toBeNull()
    const next = state.update(spec!)
    expect(next.state.doc.toString()).toContain('```query\n\n```')
})

test('replaceQueryBody: a body containing blank lines is inserted verbatim', () => {
    const state = EditorState.create({ doc: TWO_FENCE_DOC })
    const multi = 'source: notes where tags.contains("book")\n\nviews:\n  - type: table'
    const spec = replaceQueryBody(state, 0, multi)
    expect(spec).not.toBeNull()
    const next = state.update(spec!)
    expect(next.state.doc.toString()).toBe(
        [
            '# Title',
            '',
            '```query',
            multi,
            '```',
            '',
            '```query',
            'of: [[B]]',
            '```',
            '',
            'trailing text',
        ].join('\n'),
    )
})
