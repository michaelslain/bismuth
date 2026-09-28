import { describe, expect, it } from 'bun:test'
import {
    completionInsert,
    rankSuggestions,
    tagsToText,
    textToTags,
    tokenAtCaret,
    withTrailingSeparator,
} from './tagsFieldText'

describe('tagsToText / textToTags', () => {
    it('hash mode reads like the read-only cell, one trailing separator each', () => {
        expect(tagsToText(['alpha', '#beta'], true)).toBe('#alpha #beta ')
        expect(tagsToText([], true)).toBe('')
    })
    it('plain mode joins with commas so values may hold spaces', () => {
        expect(tagsToText(['In progress', 'Done'], false)).toBe('In progress, Done, ')
    })
    it('an unfocused field shows no trailing separator', () => {
        expect(tagsToText(['alpha', 'beta'], true, false)).toBe('#alpha #beta')
        expect(tagsToText(['Done'], false, false)).toBe('Done')
    })
    it('focusing adds the separator once', () => {
        expect(withTrailingSeparator('#alpha', true)).toBe('#alpha ')
        expect(withTrailingSeparator('#alpha ', true)).toBe('#alpha ')
        expect(withTrailingSeparator('Done', false)).toBe('Done, ')
        expect(withTrailingSeparator('Done, ', false)).toBe('Done, ')
        expect(withTrailingSeparator('', false)).toBe('')
    })
    it('hash mode parses whitespace or commas, strips #, dedupes, keeps order', () => {
        expect(textToTags('#alpha  beta,#gamma #alpha ', true)).toEqual([
            'alpha',
            'beta',
            'gamma',
        ])
        expect(textToTags('   ', true)).toEqual([])
    })
    it('plain mode splits on commas only', () => {
        expect(textToTags('In progress, Done,, ', false)).toEqual(['In progress', 'Done'])
    })
    it('round-trips', () => {
        const tags = ['planning', 'chicken', 'a/b']
        expect(textToTags(tagsToText(tags, true), true)).toEqual(tags)
    })
})

describe('tokenAtCaret', () => {
    it('hash mode: the token starts AT its # so accepting replaces it', () => {
        expect(tokenAtCaret('#planning #ch', true)).toEqual({ from: 10, query: 'ch' })
        expect(tokenAtCaret('#planning ch', true)).toEqual({ from: 10, query: 'ch' })
        expect(tokenAtCaret('#planning ', true)).toEqual({ from: 10, query: '' })
        expect(tokenAtCaret('', true)).toEqual({ from: 0, query: '' })
    })
    it('plain mode: the segment after the last comma, leading space skipped', () => {
        expect(tokenAtCaret('Done, In pr', false)).toEqual({ from: 6, query: 'In pr' })
        expect(tokenAtCaret('Do', false)).toEqual({ from: 0, query: 'Do' })
    })
})

describe('rankSuggestions', () => {
    const options = ['planning', 'chores', 'chicken', 'launch', 'Chill']
    it('prefix matches only, case-insensitive, option order kept — like the yaml tags completion', () => {
        expect(rankSuggestions(options, 'ch', [])).toEqual(['chores', 'chicken', 'Chill'])
        expect(rankSuggestions(options, 'la', [])).toEqual(['launch'])
    })
    it('leaves out values already in the field (case-insensitive)', () => {
        expect(rankSuggestions(options, 'ch', ['CHORES'])).toEqual(['chicken', 'Chill'])
    })
    it('an empty query offers every unused option', () => {
        expect(rankSuggestions(options, '', ['planning'])).toEqual([
            'chores',
            'chicken',
            'launch',
            'Chill',
        ])
    })
})

describe('completionInsert', () => {
    it('adds the mode separator so the caret is ready for the next token', () => {
        expect(completionInsert('chicken', true)).toBe('#chicken ')
        expect(completionInsert('In progress', false)).toBe('In progress, ')
    })
})
