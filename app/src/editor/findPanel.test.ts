// Tests for the pure `nextMatchFrom` helper behind the in-note find bar (findPanel.ts). The
// CodeMirror panel + view can't mount under bun (no live EditorView / DOM), so we unit-test the
// factored-out match-target logic that drives the find bar's SELECTION on every keystroke —
// i.e. the "Cmd+F selects the match" behavior (bug #21). SearchQuery.getCursor works on a plain
// EditorState, so this needs no view.
//
// #31: the find bar no longer flips a table to raw source when a match lands inside it — that whole
// reveal/revert path (tableBlockAtRange/tableRevealDecision/nextOwnedTable/reconcileTableReveal) was
// DELETED. Matches inside a rendered table are now highlighted in place by tableFindHighlight (see
// editor/tableWidget.test.ts for the mounted-widget proof). So this file only covers `nextMatchFrom`.

import { test, expect, describe } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { SearchQuery } from '@codemirror/search'
import { findCountLabel, nextMatchFrom, stepAiIndex } from './findPanel'

const q = (search: string, caseSensitive = false) =>
    new SearchQuery({ search, caseSensitive, literal: true })

describe('nextMatchFrom', () => {
    // indices:            0   4   8   12  16
    const state = EditorState.create({ doc: 'foo bar foo baz FOO' })

    test('selects the first match from the doc start', () => {
        expect(nextMatchFrom(state, q('foo'), 0)).toEqual({ from: 0, to: 3 })
    })

    test("advances to the next match when searching past the current one's start", () => {
        // From pos 1 the first "foo" (starts at 0) is behind us → the second "foo" at 8.
        expect(nextMatchFrom(state, q('foo'), 1)).toEqual({ from: 8, to: 11 })
    })

    test('searching from a match START stays on that match (query refinement)', () => {
        // Refining the query re-runs from the current match's start — it must not skip it.
        expect(nextMatchFrom(state, q('foo'), 8)).toEqual({ from: 8, to: 11 })
    })

    test('wraps to the top when nothing matches at/after pos', () => {
        // "bar" only occurs at 4; searching from 10 finds nothing forward → wraps to it.
        expect(nextMatchFrom(state, q('bar'), 10)).toEqual({ from: 4, to: 7 })
    })

    test('is case-insensitive by default (matches FOO)', () => {
        expect(nextMatchFrom(state, q('foo'), 12)).toEqual({ from: 16, to: 19 })
    })

    test('case-sensitive skips FOO and wraps to a lowercase foo', () => {
        // From 12 the only forward occurrence is "FOO"@16, excluded when case-sensitive →
        // wraps to the first lowercase "foo" at 0.
        expect(nextMatchFrom(state, q('foo', true), 12)).toEqual({
            from: 0,
            to: 3,
        })
    })

    test('returns null when the query has no match anywhere', () => {
        expect(nextMatchFrom(state, q('qux'), 0)).toBeNull()
    })

    test('returns null for an empty / invalid query', () => {
        expect(nextMatchFrom(state, q(''), 0)).toBeNull()
    })
})

describe('findCountLabel', () => {
    const lit = (query: string, total: number, current = 0) => ({ query, total, current })

    test('literal counts are unchanged', () => {
        expect(findCountLabel(null, lit('', 0), true)).toEqual({ text: '', danger: false })
        expect(findCountLabel(null, lit('a', 3, 2), true)).toEqual({ text: '2/3', danger: false })
        expect(findCountLabel(null, lit('a', 3, 0), true)).toEqual({ text: '–/3', danger: false })
    })

    test('no literal match offers asking only when the editor can ask', () => {
        expect(findCountLabel(null, lit('a', 0), true)).toEqual({ text: 'no results', danger: true, hint: '↵ ask' })
        expect(findCountLabel(null, lit('a', 0), false)).toEqual({ text: 'No results', danger: true })
        expect(findCountLabel(null, lit('a', 0), true, true)).toEqual({ text: 'no results', danger: true })
    })

    test('the ai passages shown win over the literal count', () => {
        expect(findCountLabel({ total: 3, current: 1 }, lit('a', 0), true)).toEqual({ text: 'ai 1/3', danger: false })
        expect(findCountLabel({ total: 0, current: 0 }, lit('a', 0), true).text).toBe('no results')
    })
})

describe('stepAiIndex', () => {
    test('wraps both ways', () => {
        expect(stepAiIndex(0, 3, 1)).toBe(1)
        expect(stepAiIndex(2, 3, 1)).toBe(0)
        expect(stepAiIndex(0, 3, -1)).toBe(2)
        expect(stepAiIndex(0, 0, 1)).toBe(0)
    })
})
