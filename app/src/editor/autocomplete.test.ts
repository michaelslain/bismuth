// app/src/editor/autocomplete.test.ts
import { test, expect } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import {
    matchPropertyKeyPrefix,
    matchTagListItem,
    matchIconValue,
    wikilinkSource,
} from './autocomplete'
import type { NoteCandidate } from './wikilink'

// A property key is being typed at the very start of a frontmatter line (no value yet).
test('matchPropertyKeyPrefix: bare key prefix at line start', () => {
    expect(matchPropertyKeyPrefix('rat')).toEqual({ from: 0, query: 'rat' })
})

test('matchPropertyKeyPrefix: empty line matches an empty key query', () => {
    expect(matchPropertyKeyPrefix('')).toEqual({ from: 0, query: '' })
})

test('matchPropertyKeyPrefix: null once a colon (value section) is present', () => {
    expect(matchPropertyKeyPrefix('rating: 4')).toBeNull()
})

test('matchPropertyKeyPrefix: null when indented (list item, not a top-level key)', () => {
    expect(matchPropertyKeyPrefix('  nested')).toBeNull()
})

// Comma-aware tag list: completes the segment after the last comma in a `tags:` value.
test('matchTagListItem: first tag right after the key', () => {
    expect(matchTagListItem('tags: fic')).toEqual({ from: 6, query: 'fic' })
})

test('matchTagListItem: completes the segment after the last comma', () => {
    expect(matchTagListItem('tags: fiction, rus')).toEqual({
        from: 15,
        query: 'rus',
    })
})

test('matchTagListItem: trims leading whitespace of the segment', () => {
    // 'tags: a,  b' — cursor after 'b'; segment starts at the 'b' (offset 10), not the spaces.
    expect(matchTagListItem('tags: a,  b')).toEqual({ from: 10, query: 'b' })
})

test('matchTagListItem: null for a non-tags key', () => {
    expect(matchTagListItem('status: do')).toBeNull()
})

// Icon value: completes the icon name after `icon:`.
test('matchIconValue: bare prefix right after the key', () => {
    expect(matchIconValue('icon: Hou')).toEqual({ from: 6, query: 'Hou' })
})

test('matchIconValue: empty value matches an empty query (offer all)', () => {
    expect(matchIconValue('icon: ')).toEqual({ from: 6, query: '' })
})

test('matchIconValue: skips the whitespace after the colon (from points at the name)', () => {
    // "icon:   Car" — three spaces consumed by \s*, so `from` is the 'C' at index 8.
    expect(matchIconValue('icon:   Car')).toEqual({ from: 8, query: 'Car' })
})

test('matchIconValue: null for a non-icon key', () => {
    expect(matchIconValue('status: do')).toBeNull()
})

// `[[wikilink]]` apply: a unique note inserts the bare name, a note sharing its basename
// with another inserts a path-qualified target instead (core/src/linkTarget.ts's contract).
function runWikilink(doc: string, notes: NoteCandidate[]): CompletionResult {
    const state = EditorState.create({ doc })
    const ctx = new CompletionContext(state, doc.length, false)
    return wikilinkSource(() => notes)(ctx) as CompletionResult
}

// `find` defaults to matching by label; pass `{ detail }` to disambiguate options that
// share a label (duplicate-name notes — see the test below).
function applyPick(
    result: CompletionResult,
    find: string | { detail: string },
    docLength: number,
): { insert: string } {
    const opt =
        typeof find === 'string'
            ? result.options.find(o => o.label === find)
            : result.options.find(o => o.detail === find.detail)
    if (!opt) throw new Error(`no option matching ${JSON.stringify(find)}`)
    let dispatched: { changes: { insert: string } } | null = null
    const fakeView = {
        state: EditorState.create({ doc: '' }),
        dispatch: (tr: { changes: { insert: string } }) => {
            dispatched = tr
        },
    } as unknown as EditorView
    ;(
        opt.apply as (
            view: EditorView,
            completion: typeof opt,
            from: number,
            to: number,
        ) => void
    )(fakeView, opt, result.from, docLength)
    if (!dispatched) throw new Error('apply did not dispatch')
    return { insert: (dispatched as { changes: { insert: string } }).changes.insert }
}

test('wikilinkSource: applying a unique note inserts [[Name]]', () => {
    const notes: NoteCandidate[] = [{ label: 'Solo', path: 'notes/Solo' }]
    const doc = '[[So'
    const result = runWikilink(doc, notes)
    const { insert } = applyPick(result, 'Solo', doc.length)
    expect(doc.slice(0, result.from) + insert).toBe('[[Solo]]')
})

test('wikilinkSource: applying a duplicate-name note inserts the full path [[Archive/Plan]]', () => {
    const notes: NoteCandidate[] = [
        { label: 'Plan', path: 'Projects/Alpha/Plan' },
        { label: 'Plan', path: 'Archive/Plan' },
    ]
    const doc = '[[Pl'
    const result = runWikilink(doc, notes)
    // Both options share the label 'Plan' — disambiguate by detail (the parent dir).
    const { insert } = applyPick(result, { detail: 'Archive' }, doc.length)
    expect(doc.slice(0, result.from) + insert).toBe('[[Archive/Plan]]')
})
