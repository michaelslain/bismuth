import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURE_NAMES, gateAccepts, parseGateModel, type GateFeatures, type GateModel } from '../core/src/sourceGate'
import {
    bestThreshold,
    fitFusion,
    fitGate,
    fitLogistic,
    foldsBySession,
    labelOf,
    labelOfJudged,
    mergeModelFile,
    objectiveAt,
    predict,
    rankPool,
    rowVector,
    shipsRefit,
    shippedFitOn,
    type CandRow,
    type PoolRow,
    type Scored,
} from './fitSourceGate'

/** A small deterministic generator, so a failing fit reproduces. */
const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
}

const synth = (n: number, trueRerank: number, seed = 7): CandRow[] => {
    const r = rng(seed)
    return Array.from({ length: n }, (_, i) => {
        const features: GateFeatures = { cosine: 0.4 + 0.5 * r(), background: 0.5, rank: Math.floor(5 * r()), rerank: 12 * r() - 6, kind: r() < 0.3 ? 'chat' : 'file', inRange: false, promptChars: 60 }
        const p = 1 / (1 + Math.exp(-(trueRerank * features.rerank! - 0.5)))
        const rel = r() < p
        return { id: Math.floor(i / 5), set: 'labelled' as const, session: `s${i % 23}`, key: `note:${i}.md`, path: 'ordinary' as const, features, matched: rel, verdict: rel ? 'relevant' : 'irrelevant' }
    })
}

describe('fitLogistic', () => {
    test('recovers a known separating weight', () => {
        const rows = synth(4000, 0.8)
        const m = fitLogistic(rows.map(c => rowVector(c.features)), rows.map(c => (c.matched ? 1 : 0)), 0.01)
        const w = Object.fromEntries(FEATURE_NAMES.map((n, j) => [n, m.weights[j]!]))
        expect(w.rerank).toBeGreaterThan(0.65)
        expect(w.rerank).toBeLessThan(0.95)
        expect(Math.abs(w.cosine!)).toBeLessThan(1.5)
        expect(predict(m, rowVector({ ...rows[0]!.features, rerank: 6 }))).toBeGreaterThan(predict(m, rowVector({ ...rows[0]!.features, rerank: -6 })))
    })
    test('a constant column gets weight zero', () => {
        const m = fitLogistic([[1, 5], [2, 5], [3, 5], [4, 5]], [0, 0, 1, 1], 0.1)
        expect(m.weights[1]).toBe(0)
        expect(m.weights[0]!).toBeGreaterThan(0)
    })
})

describe('foldsBySession', () => {
    test('every session lands in exactly one fold and the folds balance', () => {
        const sessions = new Map(Array.from({ length: 40 }, (_, i) => [`s${i}`, 1 + (i % 7)] as [string, number]))
        const fold = foldsBySession(sessions, 5)
        expect(fold.size).toBe(40)
        const load = Array.from({ length: 5 }, () => 0)
        for (const [s, f] of fold) load[f]! += sessions.get(s)!
        expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(7)
        expect(new Set(fold.values()).size).toBe(5)
    })
    test('is deterministic', () => {
        const sessions = new Map([['a', 3], ['b', 3], ['c', 1]])
        expect([...foldsBySession(sessions, 2)]).toEqual([...foldsBySession(sessions, 2)])
    })
})

describe('the operating point', () => {
    const rows: Scored[] = [
        { caseId: 1, set: 'labelled', matched: true, y: 1, p: 0.9 },
        { caseId: 2, set: 'labelled', matched: true, y: 1, p: 0.7 },
        { caseId: 3, set: 'labelled', matched: false, y: 0, p: 0.6 },
        { caseId: 4, set: 'quiet', matched: false, y: 0, p: 0.4 },
        { caseId: 5, set: 'labelled', matched: true, y: 1, p: 0.3 },
        { caseId: 6, set: 'quiet', matched: false, y: 0, p: 0.2 },
    ]
    test('hits minus junk', () => {
        expect(objectiveAt(rows, 0.7)).toEqual({ objective: 2, hits: 2, junk: 0, accepted: 2 })
        expect(objectiveAt(rows, 0.3)).toMatchObject({ hits: 3, junk: 2, objective: 1 })
        expect(objectiveAt(rows, 2)).toMatchObject({ objective: 0, accepted: 0 })
    })
    test('judged-relevant chats of past and time cases count as hits, a relevant unlabelled file does not', () => {
        const r: Scored[] = [
            { caseId: 1, set: 'past', matched: false, y: 1, p: 0.8 },
            { caseId: 2, set: 'labelled', matched: false, y: 1, p: 0.8 },
        ]
        expect(objectiveAt(r, 0.5).hits).toBe(1)
    })
    test('is the probability with the best objective, nudged to the midpoint below it', () => {
        const { threshold, at } = bestThreshold(rows)
        expect(at.objective).toBe(2)
        expect(threshold).toBeCloseTo((0.7 + 0.6) / 2, 12)
    })
    test('with nothing worth injecting the gate stays shut', () => {
        const bad: Scored[] = [{ caseId: 1, set: 'quiet', matched: false, y: 0, p: 0.9 }]
        expect(bestThreshold(bad).at.objective).toBe(0)
        expect(bestThreshold(bad).threshold).toBe(1)
    })
})

describe('labels', () => {
    const base: CandRow = { id: 1, set: 'labelled', session: 's', key: 'note:a.md', path: 'ordinary', features: synth(1, 1)[0]!.features, matched: false }
    test('a fetched label or a relevant verdict is 1, irrelevant or quiet is 0, unjudged is unusable', () => {
        expect(labelOf({ ...base, matched: true })).toBe(1)
        expect(labelOf({ ...base, verdict: 'relevant' })).toBe(1)
        expect(labelOf({ ...base, verdict: 'irrelevant' })).toBe(0)
        expect(labelOf({ ...base, set: 'quiet' })).toBe(0)
        expect(labelOf(base)).toBeNull()
        expect(labelOf({ ...base, verdict: 'error' })).toBeNull()
    })
})

describe('fitGate', () => {
    test('writes a model the gate loads, whose probability follows the signal, with held-out numbers', () => {
        const { model, report } = fitGate(synth(3000, 0.8), 5)
        const m = parseGateModel(model) as GateModel
        expect(m).not.toBeNull()
        expect(m.weights.rerank!).toBeGreaterThan(0.5)
        expect(report.sessions).toBe(23)
        expect(report.perFold).toHaveLength(5)
        expect(report.heldOut.objective).toBeGreaterThan(0)
        const hi: GateFeatures = { cosine: 0.7, background: 0.5, rank: 0, rerank: 6, kind: 'file', inRange: false, promptChars: 60 }
        expect(gateAccepts(hi, m)).toBe(true)
        expect(gateAccepts({ ...hi, rerank: -6 }, m)).toBe(false)
    })
})

describe('fitFusion', () => {
    const pool = (session: string, label: string, meaning: string[], keyword: string[]): PoolRow => ({
        session,
        labels: [label],
        meaning: meaning.map(k => [`note:${k}`, `note:${k}`]),
        keyword: keyword.map(k => [`note:${k}`, `note:${k}`]),
        logit: {},
    })
    const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}.md`)
    test('ranks the label first in a list: recall counts', () => {
        const c = pool('s', 'note:t.md', ['t.md', ...filler(30, 'm')], filler(30, 'k'))
        expect(rankPool(c, { keyword: 0, k: 1, rerank: false })[0]).toBe('note:t.md')
    })
    test('a noisy keyword list gets no weight and the fit says meaning leads', () => {
        const cases = Array.from({ length: 60 }, (_, i) => pool(`s${i % 12}`, `note:t${i}.md`, [`t${i}.md`, ...filler(30, `m${i}-`)], [...filler(30, `k${i}-`)]))
        const { model, report } = fitFusion(cases, 4)
        expect(model.weights.keyword).toBeLessThanOrEqual(0.02)
        expect(report.heldOut.hybrid.recall).toBe(1)
    })
    test('a keyword list that finds what meaning misses earns a positive weight', () => {
        const cases = Array.from({ length: 60 }, (_, i) =>
            i % 2
                ? pool(`s${i % 12}`, `note:t${i}.md`, [`t${i}.md`, ...filler(30, `m${i}-`)], filler(30, `k${i}-`))
                : pool(`s${i % 12}`, `note:t${i}.md`, filler(30, `m${i}-`), [`t${i}.md`, ...filler(30, `k${i}-`)]),
        )
        const { model, report } = fitFusion(cases, 4)
        expect(model.weights.keyword).toBeGreaterThan(0)
        expect(report.heldOut.hybrid.recall).toBeGreaterThan(report.heldOut.meaningOnly.recall)
    })
    test('when no blend reaches meaning alone, the fit falls back to meaning and says so', () => {
        // keyword puts a wrong note first in every case, so any weight can only hurt
        const cases = Array.from({ length: 40 }, (_, i) => pool(`s${i % 8}`, `note:t${i}.md`, [...filler(9, `m${i}-`), `t${i}.md`], ['wrong.md', ...filler(30, `k${i}-`)]))
        const { model, report } = fitFusion(cases, 4)
        expect(report.heldOut.hybrid.recall).toBeGreaterThanOrEqual(report.heldOut.meaningOnly.recall)
        expect(model.weights.keyword).toBe(0)
        expect(model.fitOn.verdict).toBeString()
    })
})

describe('regularised fit', () => {
    const sig = (z: number) => 1 / (1 + Math.exp(-z))
    const data = (n: number, w: number) => {
        const r = rng(11)
        const X = Array.from({ length: n }, () => [4 * r() - 2, 4 * r() - 2])
        const y = X.map(x => (r() < sig(w * x[0]! - 0.3) ? 1 : 0))
        return { X, y }
    }
    test('recovers a known weight on synthetic data and leaves the noise column near zero', () => {
        const { X, y } = data(6000, 1.5)
        const m = fitLogistic(X, y, 0.01)
        expect(m.weights[0]!).toBeGreaterThan(1.3)
        expect(m.weights[0]!).toBeLessThan(1.7)
        expect(Math.abs(m.weights[1]!)).toBeLessThan(0.1)
        expect(m.bias).toBeGreaterThan(-0.5)
        expect(m.bias).toBeLessThan(-0.1)
    })
    test('a larger ridge strength shrinks the weight towards zero', () => {
        const { X, y } = data(600, 1.5)
        const small = fitLogistic(X, y, 0.01).weights[0]!
        const big = fitLogistic(X, y, 1000).weights[0]!
        expect(Math.abs(big)).toBeLessThan(Math.abs(small) * 0.5)
        expect(big).toBeGreaterThan(0)
    })
})

describe('labelOfJudged', () => {
    test('a quiet candidate is junk only when judged irrelevant', () => {
        expect(labelOfJudged({ matched: false, verdict: 'irrelevant' })).toBe(0)
        expect(labelOfJudged({ matched: false, verdict: 'relevant' })).toBe(1)
        expect(labelOfJudged({ matched: false, verdict: 'error' })).toBeNull()
        expect(labelOfJudged({ matched: true, verdict: 'irrelevant' })).toBe(1)
    })
})

describe('writing the model file', () => {
    const existing = { version: 1, weights: { cosine: 9 }, bias: -7, threshold: 0.19, fitOn: { variant: 'rate' }, fusion: { old: true } }
    const fit = { version: 1, weights: { cosine: 1 }, bias: 0, threshold: 1, fitOn: { variant: 'first' } }
    test('the shipped gate is kept and only the blend is replaced', () => {
        const next = mergeModelFile(existing, fit, { fresh: true }, false)
        expect(next.weights).toEqual({ cosine: 9 })
        expect(next.threshold).toBe(0.19)
        expect(next.fitOn).toEqual({ variant: 'rate' })
        expect(next.fusion).toEqual({ fresh: true })
    })
    test('no new blend keeps the old one', () => expect(mergeModelFile(existing, fit, null, false).fusion).toEqual({ old: true }))
    test('--gate, or a file with no gate, takes the fitted gate', () => {
        expect(mergeModelFile(existing, fit, null, true).threshold).toBe(1)
        expect(mergeModelFile({}, fit, null, false).threshold).toBe(1)
    })
})

describe('dropped columns', () => {
    test('a dropped name reads 0 in the row vector and the rest are unchanged', () => {
        const f = { cosine: 0.7, background: 0.6, rank: 2, rerank: null, kind: 'chat', inRange: true, promptChars: 100 } as GateFeatures
        const all = rowVector(f)
        const dropped = rowVector(f, ['inRange'])
        const j = FEATURE_NAMES.indexOf('inRange')
        expect(all[j]).toBe(1)
        expect(dropped[j]).toBe(0)
        expect(dropped.filter((_, i) => i !== j)).toEqual(all.filter((_, i) => i !== j))
    })
})

describe('the ship rule', () => {
    const v = (nc: number, nr: number, oc: number, or: number) => ({ atNew: { current: nc, refit: nr }, atOld: { current: oc, refit: or } })
    test('the refit has to win at both rates', () => {
        expect(shipsRefit(v(-37, 57, 160, 150))).toBe(false)
        expect(shipsRefit(v(-37, 57, 160, 170))).toBe(true)
        expect(shipsRefit(v(10, 9, 160, 170))).toBe(false)
    })
    test('a tie is not a win', () => expect(shipsRefit(v(5, 5, 5, 6))).toBe(false))
})

describe('the committed model describes itself', () => {
    const row = (o: number, h: number) => ({ threshold: o, injected: 10, hits: 3, junk: 4, quietFired: 1, quietCases: 5, pastChat: 1, pastCases: 2, hitRate: h, precision: 0.3, junkRate: 0.4, quietFireRate: 0.2, pastChatRate: 0.5, objectiveNew: { value: o + 100, lo: 1, hi: 2 }, objectiveOld: { value: o + 200, lo: 3, hi: 4 } })
    const r = (ship: boolean) => ({ ship, lambdaNew: 3.8, lambdaOld: 16.8, ridge: 0.001, refit: row(0.4, 0.9), current: row(0.19, 0.5), shippedRow: ship ? row(0.4, 0.9) : row(0.19, 0.5), validationObjective: { atNew: { current: 1, refit: 2 }, atOld: { current: 3, refit: ship ? 4 : 2 } } }) as unknown as Parameters<typeof shippedFitOn>[1]
    const m = { saved: 1439, cost: 377, at: '2026-11-08' }
    const prev = { cases: 351, objective: 'old', at: '2026-11-07', exchangeRate: 16.8, testHitRate: 0.5 } as never
    test('a shipped refit carries its own rates, the rate it was measured on and the not-held-out label', () => {
        const f = shippedFitOn(prev, r(true), { savedTokensPerHit: m.saved, junkCostTokensPerItem: m.cost, at: m.at, measuredRate: 3.8 }) as Record<string, unknown>
        expect(f.exchangeRate).toBe(3.8)
        expect(f.exchangeRateMeasuredOn).toBe('test sessions')
        expect(f.testHitRate).toBe(0.9)
        expect(f.testObjective).toBe(100.4)
        expect(f.testObjectiveHeldOut).toBe(false)
        expect((f.qualityReplay as { refitShipped: boolean }).refitShipped).toBe(true)
    })
    test('a kept model carries its own recomputed rates and its own rate', () => {
        const f = shippedFitOn(prev, r(false), { savedTokensPerHit: m.saved, junkCostTokensPerItem: m.cost, at: m.at, measuredRate: 3.8 }) as Record<string, unknown>
        expect(f.exchangeRate).toBe(16.8)
        expect(f.testHitRate).toBe(0.5)
        expect(f.testObjective).toBe(200.19)
        expect(f.testObjectiveRate).toBe(16.8)
        expect(f.testObjectiveHeldOut).toBe(false)
        expect(String(f.exchangeRateMeasuredOn)).toContain('test')
        const q = f.qualityReplay as { refitShipped: boolean; measuredRate: number; measuredRateOn: string }
        expect([q.refitShipped, q.measuredRate, q.measuredRateOn]).toEqual([false, 3.8, 'test sessions'])
    })
})

describe('the committed model file', () => {
    const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'core', 'src', 'sourceGateModel.json'), 'utf8')) as { threshold: number; fitOn: Record<string, unknown> }
    const f = raw.fitOn as Record<string, unknown> & { qualityReplay?: { refitShipped: boolean; measuredRate: number | null; measuredRateOn: string } }
    test('it parses and states what its exchange rate was measured on', () => {
        expect(parseGateModel(raw)).not.toBeNull()
        expect(typeof f.exchangeRateMeasuredOn).toBe('string')
        expect(f.testObjectiveHeldOut).toBe(false)
        expect(f.qualityReplay?.measuredRateOn).toBe('test sessions')
    })
    test('the rate and the record agree on which model is committed', () => {
        const q = f.qualityReplay!
        if (q.refitShipped) {
            expect(f.exchangeRate).toBe(q.measuredRate)
            expect(f.exchangeRateMeasuredOn).toBe('test sessions')
        } else expect(f.exchangeRate).not.toBe(q.measuredRate)
        expect(f.testObjectiveRate).toBe(f.exchangeRate)
    })
})
