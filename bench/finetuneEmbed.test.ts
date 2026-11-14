import { describe, expect, test } from 'bun:test'
import { caseFold, foldOf, heldOutDoc, heldOutPairs, mergePools, mergeRecall, parseQueries, sampleChunks, trainPairs, type ChunkRow, type QueryRow } from './finetuneEmbed'
import type { SearchPool } from './searchReplay'
import { embedSpecFor, EMBED_SPECS } from '../core/src/embedModel'

const pool = (id: number, labels: string[], tag = ''): SearchPool => ({
    id,
    session: 's',
    at: '2026-11-01T00:00:00Z',
    prompt: `p${id}`,
    labels,
    meaning: [[`note:${tag}`, null]],
    keyword: [],
    texts: {},
})

describe('foldOf', () => {
    test('is stable and splits keys roughly in half', () => {
        expect(foldOf('note:Calendar.md')).toBe(foldOf('note:Calendar.md'))
        const keys = Array.from({ length: 1000 }, (_, i) => `note:n${i}.md`)
        const a = keys.filter(k => foldOf(k) === 'a').length
        expect(a).toBeGreaterThan(400)
        expect(a).toBeLessThan(600)
    })
})

describe('caseFold', () => {
    test('one fold for labels that agree, null when they span both', () => {
        const keys = Array.from({ length: 50 }, (_, i) => `note:n${i}.md`)
        const a = keys.filter(k => foldOf(k) === 'a')
        const b = keys.filter(k => foldOf(k) === 'b')
        expect(caseFold([a[0]!, a[1]!])).toBe('a')
        expect(caseFold([b[0]!])).toBe('b')
        expect(caseFold([a[0]!, b[0]!])).toBeNull()
    })
})

describe('sampleChunks', () => {
    const files = [
        { file: 'x.md', texts: ['x'.repeat(300), 'y'.repeat(300), 'z'.repeat(300), 'short'] },
        { file: 'y.md', texts: ['q'.repeat(300)] },
        { file: 'z.md', texts: ['tiny'] },
    ]
    test('every file gets one before any gets a second, short texts dropped', () => {
        const two = sampleChunks(files, { total: 2, perFile: 3, minChars: 200, seed: 1 })
        expect(new Set(two.map(c => c.file))).toEqual(new Set(['x.md', 'y.md']))
        const all = sampleChunks(files, { total: 100, perFile: 2, minChars: 200, seed: 1 })
        expect(all.filter(c => c.file === 'x.md')).toHaveLength(2)
        expect(all.some(c => c.file === 'z.md')).toBe(false)
    })
})

describe('parseQueries', () => {
    const one = { ask: 'whats due', question: 'What is due?', keywords: 'due dates' }
    const at = (n: number | string, extra: object = {}) => ({ n, ...one, ...extra })
    test('takes the object numbered for each passage and refuses an empty reply', () => {
        expect(parseQueries('here:\n' + JSON.stringify([at(1), at(2)]), 2)).toEqual([one, one])
        expect(parseQueries(JSON.stringify([at(1)]), 2)).toEqual([one, null])
        expect(parseQueries(JSON.stringify([at(1, { ask: ' ' })]), 1)).toEqual([null])
        expect(parseQueries(JSON.stringify([at(1, { keywords: ['due', 'dates'] })]), 1)).toEqual([one])
        expect(parseQueries('no json', 1)).toBeNull()
    })
    test('keeps the first object for a passage and ignores extras and out-of-range numbers', () => {
        const first = { ...one, ask: 'first' }
        const r = parseQueries(JSON.stringify([at(1, { ask: 'first' }), at(1, { ask: 'second' }), at(5), at(0), at(2)]), 2)
        expect(r).toEqual([first, one])
    })
    test('a missing passage number is a null entry', () => {
        expect(parseQueries(JSON.stringify([at(1), at(3)]), 3)).toEqual([one, null, one])
    })
    test('accepts n as a string', () => {
        expect(parseQueries(JSON.stringify([at('2'), at('1')]), 2)).toEqual([one, one])
    })
})

describe('trainPairs and heldOutPairs', () => {
    const keys = Array.from({ length: 50 }, (_, i) => `note:n${i}.md`)
    const ka = keys.find(k => foldOf(k) === 'a')!
    const kb = keys.find(k => foldOf(k) === 'b')!
    const chunks: ChunkRow[] = [
        { id: 0, file: ka.slice(5), key: ka, fold: 'a', text: 'A text' },
        { id: 1, file: kb.slice(5), key: kb, fold: 'b', text: 'B text' },
    ]
    const qs: QueryRow[] = [
        { id: 0, ask: 'a1', question: 'a2', keywords: 'a3' },
        { id: 1, ask: 'b1', question: 'b2', keywords: 'b3' },
    ]
    test('the model for fold a trains only on fold b and is checked only on fold a', () => {
        const tr = trainPairs(chunks, qs, 'a', 'P: ')
        expect(tr.map(p => p.query)).toEqual(['P: b1', 'P: b2', 'P: b3'])
        expect(tr.every(p => p.passage === 'B text')).toBe(true)
        expect(heldOutPairs(chunks, qs, 'a', 'P: ')).toEqual([{ query: 'P: a1', passage: 'A text', group: 0 }])
        expect(trainPairs(chunks, qs, 'none', 'P: ')).toEqual([])
    })
})

describe('mergePools', () => {
    const keys = Array.from({ length: 50 }, (_, i) => `note:n${i}.md`)
    const ka = keys.find(k => foldOf(k) === 'a')!
    const kb = keys.find(k => foldOf(k) === 'b')!
    test("each case's tuned row comes from its labels' fold; spanning and missing cases leave both sides", () => {
        const base = [pool(1, [ka]), pool(2, [kb]), pool(3, [ka, kb]), pool(4, [kb])]
        const a = [pool(1, [ka], 'A'), pool(2, [kb], 'A'), pool(4, [kb], 'A')]
        const b = [pool(1, [ka], 'B'), pool(2, [kb], 'B')]
        const m = mergePools(base, a, b)
        expect(m.base.map(p => p.id)).toEqual([1, 2])
        expect(m.tuned.map(p => p.meaning[0]![0])).toEqual(['note:A', 'note:B'])
        expect(m.dropped).toEqual({ spanning: 1, missing: 1 })
    })
})

describe('embedSpecFor', () => {
    test('ft:<name> is the default model with a fine-tuned id; unknown names are the default', () => {
        expect(embedSpecFor('ft:run1-a')).toEqual({ ...EMBED_SPECS.default!, id: 'bismuth-ft/run1-a' })
        expect(embedSpecFor('ft:../x')).toEqual(EMBED_SPECS.default!)
        expect(embedSpecFor('bge-base')).toEqual(EMBED_SPECS['bge-base']!)
        expect(embedSpecFor(undefined)).toEqual(EMBED_SPECS.default!)
    })
})

describe('mergeRecall', () => {
    const keys = Array.from({ length: 50 }, (_, i) => `note:n${i}.md`)
    const ka = keys.find(k => foldOf(k) === 'a')!
    const kb = keys.find(k => foldOf(k) === 'b')!
    const r = (id: number, labels: string[], hit: boolean) => ({ prompt: `p${id}`, session: 's', labels, hit, labelRetrieved: hit })
    test('docs labels are ignored; the tuned row comes from the fold of the file labels', () => {
        const base = [r(1, [ka, 'docs:x.md'], false), r(2, [kb], false), r(3, ['docs:y.md'], false), r(4, [ka, kb], false)]
        const m = mergeRecall(base, [r(1, [ka], true), r(2, [kb], true), r(3, [], true), r(4, [], true)], [r(1, [ka], false), r(2, [kb], false), r(3, [], false), r(9, [], false)])
        expect(m.base).toEqual([{ session: 's', hit: 0, rr: 0 }, { session: 's', hit: 0, rr: 0 }])
        expect(m.tuned).toEqual([{ session: 's', hit: 1, rr: 1 }, { session: 's', hit: 0, rr: 0 }])
    })
})

describe('heldOutDoc and the general fold', () => {
    const keys = Array.from({ length: 10000 }, (_, i) => `pub:libretexts/doc${i}`)
    test('about a tenth of keys, stable per key', () => {
        const n = keys.filter(heldOutDoc).length
        expect(n).toBeGreaterThan(850)
        expect(n).toBeLessThan(1150)
        expect(heldOutDoc(keys[7]!)).toBe(heldOutDoc(keys[7]!))
    })
    test('train and held-out pairs are disjoint by document', () => {
        const chunks: ChunkRow[] = keys.slice(0, 300).map((key, id) => ({ id, file: key.slice(4), key, fold: foldOf(key), text: `t${id}` }))
        const qs: QueryRow[] = chunks.map(c => ({ id: c.id, ask: `a${c.id}`, question: `q${c.id}`, keywords: `k${c.id}` }))
        const tr = trainPairs(chunks, qs, 'general', 'P: ')
        const ho = heldOutPairs(chunks, qs, 'general', 'P: ')
        const heldIds = new Set(chunks.filter(c => heldOutDoc(c.key)).map(c => c.id))
        expect(ho.length).toBe(heldIds.size)
        expect(ho.every(p => heldIds.has(p.group))).toBe(true)
        expect(tr.every(p => !heldIds.has(p.group))).toBe(true)
        expect(tr).toHaveLength((chunks.length - heldIds.size) * 3)
        expect(tr[0]!.file).toBe(chunks.find(c => c.id === tr[0]!.group)!.file)
    })
})
