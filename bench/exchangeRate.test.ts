import { describe, expect, test } from 'bun:test'
import { entryChars, exchangeRate, sessionFetches } from './exchangeRate'
import { balancedAccuracy } from './recallJudge'
import { sampleBy } from './judgeCalibrate'

describe('exchangeRate', () => {
    test('is fetch tokens over item tokens: the junk items one saved fetch pays for', () => {
        expect(exchangeRate(2600, 155)).toBeCloseTo(16.77, 1)
        expect(exchangeRate(300, 100)).toBe(3)
    })
    test('is undefined without an item cost', () => {
        expect(exchangeRate(10, 0)).toBeNaN()
    })
})

describe('sessionFetches', () => {
    const line = (o: unknown) => JSON.stringify(o)
    const files = new Set(['notes/a.md'])
    const log = [
        line({ type: 'user', message: { content: 'hi' } }),
        line({ type: 'assistant', message: { id: 'm1', usage: { output_tokens: 100 }, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/v/notes/a.md' } }] } }),
        line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(900) }] } }),
        line({ type: 'assistant', message: { id: 'm2', usage: { output_tokens: 50, input_tokens: 2, cache_creation_input_tokens: 400 }, content: [{ type: 'text', text: 'ok' }] } }),
    ].join('\n')
    test('finds a labelled fetch, its result size and the tokens the next turn reports', () => {
        const s = sessionFetches(log, '/v', files)
        expect(s.samples.length).toBe(1)
        expect(s.samples[0]!.resultChars).toBe(900)
        expect(s.samples[0]!.turnResultTokens).toBe(302)
        expect(s.ratio).toEqual([{ chars: 900, tokens: 302 }])
        expect(s.turns).toEqual([100, 50])
    })
    test('a second fetch of the same file is not a second sample', () => {
        expect(sessionFetches(log + '\n' + log, '/v', files).samples.length).toBe(1)
    })
    test('a call that names no vault file is not a fetch', () => {
        const other = log.replace('/v/notes/a.md', '/etc/hosts')
        expect(sessionFetches(other, '/v', files).samples.length).toBe(0)
    })
})

describe('balancedAccuracy', () => {
    test('is the mean of recall on fetched and specificity on the unfetched sample', () => {
        const r = balancedAccuracy(49, 105, 17, 200)
        expect(r.recall).toBeCloseTo(0.4667, 3)
        expect(r.specificity).toBeCloseTo(0.915, 3)
        expect(r.balanced).toBeCloseTo((0.4667 + 0.915) / 2, 3)
    })
})

describe('sampleBy', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `x${i}` }))
    test('is reproducible and independent of input order', () => {
        const a = sampleBy(items, i => i.id, 10).map(i => i.id)
        const b = sampleBy([...items].reverse(), i => i.id, 10).map(i => i.id)
        expect(a).toEqual(b)
        expect(new Set(a).size).toBe(10)
    })
})

describe('entryChars', () => {
    test('counts the entry line alone, not the lead line and heading the block shares', () => {
        const hit = { kind: 'note', id: 'a.md', score: 0, excerpt: 'the bees live in the north field.', title: 'Hive', hash: '' } as never
        const line = '- a.md (note) — Hive (open: `/v/a.md`)'
        expect(entryChars(hit, '/v')).toBe(line.length)
    })
})
