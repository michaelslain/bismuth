import { describe, expect, test } from 'bun:test'
import { mergeTagOptions, vaultTagNames } from './tagSuggestions'

describe('vaultTagNames', () => {
    test('reads tag nodes only, strips the leading #', () => {
        expect(
            vaultTagNames({
                nodes: [
                    { kind: 'note', label: 'Groceries' },
                    { kind: 'tag', label: '#chicken' },
                    { kind: 'tag', label: '#project/alpha' },
                    { kind: 'memory', label: '#not-a-tag' },
                ],
            }),
        ).toEqual(['chicken', 'project/alpha'])
    })
    test('empty / missing graph → no tags', () => {
        expect(vaultTagNames(null)).toEqual([])
        expect(vaultTagNames({ nodes: [] })).toEqual([])
    })
    test('dedupes and drops a bare #', () => {
        expect(
            vaultTagNames({
                nodes: [
                    { kind: 'tag', label: '#a' },
                    { kind: 'tag', label: '#' },
                    { kind: 'tag', label: '#a' },
                ],
            }),
        ).toEqual(['a'])
    })
})

describe('mergeTagOptions', () => {
    test('first-seen order across lists, exact dedup', () => {
        expect(
            mergeTagOptions(['beta', 'alpha'], ['alpha', 'chicken'], ['beta', 'docs']),
        ).toEqual(['beta', 'alpha', 'chicken', 'docs'])
    })
    test('skips empty strings', () => {
        expect(mergeTagOptions(['', 'a'], [''])).toEqual(['a'])
    })
})
