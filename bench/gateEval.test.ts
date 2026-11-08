import { describe, expect, test } from 'bun:test'
import type { GateFeatures } from '../core/src/sourceGate'
import {
    bestCut,
    bootstrapDraws,
    bootstrapInterval,
    intervalOf,
    objectiveOf,
    packCapped,
    splitSessions,
    sumTallies,
    tallyBySession,
    type CaseInfo,
    type EvalRow,
} from './gateEval'

const feat = (cosine: number, kind: GateFeatures['kind'] = 'file'): GateFeatures => ({ cosine, background: 0.5, rank: 0, rerank: 0, kind, inRange: false, promptChars: 50 })
const row = (id: number, set: EvalRow['set'], session: string, cosine: number, y: 0 | 1, matched = false, kind: GateFeatures['kind'] = 'file'): EvalRow => ({
    id,
    set,
    session,
    key: `k${id}-${cosine}`,
    kind,
    cosine,
    features: feat(cosine, kind),
    matched,
    y,
})

describe('splitSessions', () => {
    const starts = new Map(Array.from({ length: 20 }, (_, i) => [`s${i}`, 1000 - i * 10] as [string, number]))
    test('puts a session in exactly one set', () => {
        const s = splitSessions(starts)
        const all = [...s.train, ...s.validation, ...s.test]
        expect(all.length).toBe(20)
        expect(new Set(all).size).toBe(20)
    })
    test('is ordered by start time: train oldest, test newest', () => {
        const s = splitSessions(starts)
        const t = (x: Set<string>) => [...x].map(id => starts.get(id)!)
        expect(Math.max(...t(s.train))).toBeLessThan(Math.min(...t(s.validation)))
        expect(Math.max(...t(s.validation))).toBeLessThan(Math.min(...t(s.test)))
        expect([s.train.size, s.validation.size, s.test.size]).toEqual([12, 4, 4])
    })
    test('does not depend on insertion order', () => {
        const shuffled = new Map([...starts].reverse())
        const a = splitSessions(starts)
        const b = splitSessions(shuffled)
        expect([...a.test].sort()).toEqual([...b.test].sort())
    })
})

describe('objective', () => {
    test('is lambda times hits minus junk', () => {
        expect(objectiveOf({ hits: 3, junk: 10 }, 16.8)).toBeCloseTo(3 * 16.8 - 10)
        expect(objectiveOf({ hits: 3, junk: 10 }, 1)).toBe(-7)
    })
})

describe('packCapped', () => {
    test('keeps the best two by cosine per case and source', () => {
        const rs = [row(1, 'labelled', 'a', 0.6, 1), row(1, 'labelled', 'a', 0.9, 1), row(1, 'labelled', 'a', 0.7, 0), row(1, 'labelled', 'a', 0.8, 1, false, 'chat'), row(2, 'labelled', 'a', 0.5, 1)]
        const kept = packCapped(rs)
        expect(kept.filter(r => r.id === 1 && r.kind === 'file').map(r => r.cosine).sort()).toEqual([0.7, 0.9])
        expect(kept.length).toBe(4)
    })
})

describe('tallyBySession', () => {
    const cases: CaseInfo[] = [
        { id: 1, set: 'labelled', session: 'a' },
        { id: 2, set: 'quiet', session: 'a' },
        { id: 3, set: 'past', session: 'b' },
    ]
    test('counts hits, junk, quiet fires and past chats per session', () => {
        const inj = [row(1, 'labelled', 'a', 0.9, 1, true), row(1, 'labelled', 'a', 0.8, 0), row(2, 'quiet', 'a', 0.7, 0), row(3, 'past', 'b', 0.7, 1, false, 'chat')]
        const t = tallyBySession(cases, inj, new Set(['a', 'b']))
        const a = t.get('a')!
        expect([a.hits, a.junk, a.quietFired, a.labelledHits, a.injected]).toEqual([1, 2, 1, 1, 3])
        const b = t.get('b')!
        expect([b.hits, b.pastChat, b.cases.past]).toEqual([1, 1, 1])
        expect(sumTallies(t.values()).hits).toBe(2)
    })
})

describe('bestCut', () => {
    const cases: CaseInfo[] = [1, 2, 3, 4].map(id => ({ id, set: 'labelled' as const, session: 'a' }))
    // one hit at p 0.9, then four junk at 0.5..0.2 and a second hit at 0.1: a hit pays for junk only if lambda is high enough
    const rows = [row(1, 'labelled', 'a', 0.9, 1, true), row(2, 'labelled', 'a', 0.8, 0), row(2, 'labelled', 'a', 0.7, 0), row(3, 'labelled', 'a', 0.6, 0), row(3, 'labelled', 'a', 0.5, 0), row(4, 'labelled', 'a', 0.4, 1, true)].map((r, i) => ({ ...r, p: [0.9, 0.5, 0.4, 0.3, 0.2, 0.1][i]! }))
    test('at 1:1 only the first hit is worth its (zero) junk', () => {
        const c = bestCut(rows, cases, 1)
        expect(c.objective).toBe(1)
        expect(c.threshold).toBeCloseTo(0.7)
    })
    test('a high exchange rate admits down to the last hit', () => {
        const c = bestCut(rows, cases, 10)
        expect(c.objective).toBe(20 - 4)
        expect(c.threshold).toBeLessThanOrEqual(0.1)
    })
    test('nothing positive shuts the gate', () => {
        const junk = rows.map(r => ({ ...r, y: 0 as const, matched: false }))
        expect(bestCut(junk, cases, 1)).toEqual({ threshold: 1, objective: 0 })
    })
})

describe('bootstrap', () => {
    test('is reproducible for a seed', () => {
        expect(bootstrapDraws(5, 3, 1)).toEqual(bootstrapDraws(5, 3, 1))
        expect(bootstrapDraws(5, 3, 1)).not.toEqual(bootstrapDraws(5, 3, 2))
    })
    test('a constant sample has a zero-width interval', () => {
        const draws = bootstrapDraws(6, 200, 3)
        const r = bootstrapInterval([4, 4, 4, 4, 4, 4], s => s.reduce((a, b) => a + b, 0), draws)
        expect(r).toEqual({ mean: 24, lo: 24, hi: 24 })
    })
    test('brackets the sample mean and widens with spread', () => {
        const units = [0, 10, 0, 10, 0, 10, 0, 10]
        const r = bootstrapInterval(units, s => s.reduce((a, b) => a + b, 0) / s.length, bootstrapDraws(8, 2000, 5))
        expect(r.lo).toBeLessThan(5)
        expect(r.hi).toBeGreaterThan(5)
        expect(r.mean).toBeGreaterThan(4.5)
        expect(r.mean).toBeLessThan(5.5)
    })
    test('intervalOf takes the central level', () => {
        const v = Array.from({ length: 100 }, (_, i) => i)
        const r = intervalOf(v, 0.9)
        expect(r.lo).toBe(5)
        expect(r.hi).toBe(95)
    })
})
