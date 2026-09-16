// app/src/chat/modelWord.test.ts
import { describe, expect, test } from 'bun:test'
import { modelWord } from './modelWord'

describe('modelWord', () => {
    test('lowercases a plain label', () => {
        expect(modelWord('Opus 4.8')).toBe('opus 4.8')
    })

    test('shortens a 1M context-window parenthetical', () => {
        expect(modelWord('Opus (1M context)')).toBe('opus (1m)')
    })

    test('shortens a 200K context-window parenthetical after other text', () => {
        expect(modelWord('Sonnet 4.5 (200K context)')).toBe('sonnet 4.5 (200k)')
    })

    test('shortens a "context window" parenthetical, not just "context"', () => {
        expect(modelWord('Claude Opus 4.8 (1M context window)')).toBe(
            'claude opus 4.8 (1m)',
        )
    })

    test('leaves a non-context parenthetical alone, only lowercasing it', () => {
        expect(modelWord('Sonnet (Legacy)')).toBe('sonnet (legacy)')
    })

    test('does not touch a raw vendor-prefixed id beyond lowercasing', () => {
        expect(modelWord('claude-opus-4-8')).toBe('claude-opus-4-8')
    })

    test('passes an empty string through unchanged', () => {
        expect(modelWord('')).toBe('')
    })
})
