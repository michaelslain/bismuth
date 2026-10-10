import { test, expect } from 'bun:test'
import { resolveTier } from '../src/daemon/tier.ts'

test('claude tiers map to claude model names', () => {
    expect(resolveTier('claude', 'fast', {})).toEqual({ model: 'haiku' })
    expect(resolveTier('claude', 'balanced', {})).toEqual({ model: 'sonnet' })
    expect(resolveTier('claude', 'deep', {})).toEqual({ model: 'opus' })
})

test('codex tiers set effort and never a model', () => {
    expect(resolveTier('codex', 'fast', {})).toEqual({ effort: 'low' })
    expect(resolveTier('codex', 'balanced', {})).toEqual({ effort: 'medium' })
    expect(resolveTier('codex', 'deep', {})).toEqual({ effort: 'high' })
})

test('explicit model and effort win over the tier', () => {
    expect(resolveTier('claude', 'deep', { model: 'haiku' })).toEqual({ model: 'haiku' })
    expect(resolveTier('codex', 'deep', { effort: 'low' })).toEqual({ effort: 'low' })
    expect(resolveTier('claude', 'fast', { model: 'x', effort: 'high' })).toEqual({ model: 'x', effort: 'high' })
})

test('no tier returns explicit unchanged', () => {
    const explicit = { model: 'sonnet' }
    expect(resolveTier('claude', undefined, explicit)).toBe(explicit)
    expect(resolveTier('claude', undefined, {})).toEqual({})
})

test('unknown backend or tier returns explicit unchanged and logs once', () => {
    const logged: string[] = []
    const orig = console.error
    console.error = (m: string) => void logged.push(m)
    try {
        const explicit = { model: 'm' }
        expect(resolveTier('gemini', 'fast', explicit)).toBe(explicit)
        expect(resolveTier('gemini', 'fast', explicit)).toBe(explicit)
        expect(resolveTier('claude', 'turbo', explicit)).toBe(explicit)
        expect(resolveTier('claude', 'turbo', explicit)).toBe(explicit)
        expect(logged.length).toBe(2)
    } finally {
        console.error = orig
    }
})
