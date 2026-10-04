import { describe, expect, test } from 'bun:test'
import {
    deletePreset,
    presetMatches,
    savePreset,
    suggestPresetName,
    type ChatPreset,
} from './chatPresets'

const fast: ChatPreset = {
    name: 'fast',
    provider: 'claude',
    model: 'haiku',
    effort: 'low',
}
const deep: ChatPreset = {
    name: 'deep',
    provider: 'claude',
    model: 'opus',
    effort: 'max',
}

describe('presetMatches', () => {
    test('all three fields equal', () => {
        expect(
            presetMatches(fast, {
                provider: 'claude',
                model: 'haiku',
                effort: 'low',
            }),
        ).toBe(true)
    })
    test('a different effort, model or provider does not match', () => {
        const cur = { provider: 'claude', model: 'haiku', effort: 'low' }
        expect(presetMatches(fast, { ...cur, effort: 'high' })).toBe(false)
        expect(presetMatches(fast, { ...cur, model: 'opus' })).toBe(false)
        expect(presetMatches(fast, { ...cur, provider: 'codex' })).toBe(false)
    })
    test('an empty preset field matches anything', () => {
        const loose = { ...fast, model: '', effort: '' }
        expect(
            presetMatches(loose, {
                provider: 'claude',
                model: 'opus',
                effort: 'max',
            }),
        ).toBe(true)
    })
})

describe('savePreset', () => {
    test('appends a new name', () => {
        expect(savePreset([fast], deep)).toEqual([fast, deep])
    })
    test('replaces a preset of the same name in place, ignoring case and space', () => {
        const next = savePreset([fast, deep], { ...deep, name: ' FAST ' })
        expect(next).toEqual([{ ...deep, name: 'FAST' }, deep])
    })
    test('an empty name saves nothing', () => {
        expect(savePreset([fast], { ...deep, name: '  ' })).toEqual([fast])
    })
    test('never mutates the input list', () => {
        const list = [fast]
        savePreset(list, deep)
        expect(list).toEqual([fast])
    })
})

describe('deletePreset', () => {
    test('removes only the row at the index, even with a duplicate name', () => {
        const dup = { ...deep, name: 'fast' }
        expect(deletePreset([fast, dup, deep], 1)).toEqual([fast, deep])
    })
})

describe('suggestPresetName', () => {
    test('joins the model word and effort', () => {
        expect(suggestPresetName('opus 4.8', 'high')).toBe('opus 4.8 high')
        expect(suggestPresetName('gpt-5', '')).toBe('gpt-5')
    })
})
