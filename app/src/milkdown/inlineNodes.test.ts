import { describe, expect, test } from 'bun:test'
import { wikilinkChipParts } from './inlineNodes'

describe('wikilinkChipParts', () => {
    test('empty alias falls back to the target basename', () => {
        expect(wikilinkChipParts('Note|')).toEqual({
            display: 'Note',
            target: 'Note',
            heading: '',
        })
    })
    test('alias wins for display', () => {
        expect(wikilinkChipParts('folder/Note#Intro|shown')).toEqual({
            display: 'shown',
            target: 'folder/Note',
            heading: 'Intro',
        })
    })
    test('heading without alias', () => {
        expect(wikilinkChipParts('a/b/Note#Sec')).toEqual({
            display: 'Note',
            target: 'a/b/Note',
            heading: 'Sec',
        })
    })
    test('plain target has no heading', () => {
        expect(wikilinkChipParts('Note').heading).toBe('')
    })
})
