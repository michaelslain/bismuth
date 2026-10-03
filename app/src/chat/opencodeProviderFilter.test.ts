import { describe, expect, test } from 'bun:test'
import { filterAvailable, type AvailableProvider } from './opencodeProviderFilter'

const p = (name: string): AvailableProvider => ({
    id: name,
    name,
    methods: [{ type: 'api', label: 'API key' }],
})

describe('filterAvailable', () => {
    test('sorts by name and matches case-insensitively on a substring', () => {
        const all = [p('xai'), p('Groq'), p('openai'), p('azure')]
        expect(filterAvailable(all, '').shown.map(x => x.name)).toEqual([
            'azure',
            'Groq',
            'openai',
            'xai',
        ])
        expect(filterAvailable(all, ' AI ').shown.map(x => x.name)).toEqual([
            'openai',
            'xai',
        ])
    })
    test('caps at 8 and reports how many were left out', () => {
        const all = Array.from({ length: 12 }, (_, i) => p(`p${String(i).padStart(2, '0')}`))
        const r = filterAvailable(all, '')
        expect(r.shown).toHaveLength(8)
        expect(r.more).toBe(4)
        expect(filterAvailable(all, 'p1').more).toBe(0)
    })
    test('no match is an empty page, not an error', () => {
        expect(filterAvailable([p('azure')], 'zzz')).toEqual({ shown: [], more: 0 })
    })
})
