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
    it('comma-separated, so a value may hold spaces', () => {
        expect(tagsToText(['planning', 'In progress'])).toBe('planning, In progress, ')
        expect(tagsToText([])).toBe('')
    })
    it('an unfocused field shows no trailing separator', () => {
        expect(tagsToText(['alpha', 'beta'], false)).toBe('alpha, beta')
    })
    it('parses on commas, trims, dedupes, keeps order', () => {
        expect(textToTags(' alpha ,beta,, alpha, Jane Doe ')).toEqual([
            'alpha',
            'beta',
            'Jane Doe',
        ])
        expect(textToTags('   ')).toEqual([])
    })
    it('a tag list drops a leading # typed out of habit; other lists keep it', () => {
        expect(textToTags('#alpha, beta', true)).toEqual(['alpha', 'beta'])
        expect(textToTags('#1 fan', false)).toEqual(['#1 fan'])
    })
    it('round-trips', () => {
        const values = ['planning', 'area/research', 'Jane Doe']
        expect(textToTags(tagsToText(values))).toEqual(values)
    })
    it('focusing adds the separator once', () => {
        expect(withTrailingSeparator('alpha')).toBe('alpha, ')
        expect(withTrailingSeparator('alpha, ')).toBe('alpha, ')
        expect(withTrailingSeparator('')).toBe('')
    })
})

describe('tokenAtCaret', () => {
    it('the value after the last comma, leading space and # skipped', () => {
        expect(tokenAtCaret('planning, ch')).toEqual({ from: 10, query: 'ch' })
        expect(tokenAtCaret('planning, #ch')).toEqual({ from: 10, query: 'ch' })
        expect(tokenAtCaret('planning, ')).toEqual({ from: 10, query: '' })
        expect(tokenAtCaret('In pr')).toEqual({ from: 0, query: 'In pr' })
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
    it('adds the separator so the caret is ready for the next value', () => {
        expect(completionInsert('In progress')).toBe('In progress, ')
    })
})
