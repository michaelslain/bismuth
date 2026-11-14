import { describe, expect, test } from 'bun:test'
import { alphaOf, pairByPrompt, pairSearch, pickExport, shipVerdict, type EvalReport } from './finetuneVerdict'

const beir = (x: number) => ({ scifact: x, nfcorpus: x, fiqa: x, arguana: x })
const report = (mrr: Record<string, number>, ndcg: Record<string, number>): EvalReport => ({
    heldoutMrr10: mrr,
    beir: Object.fromEntries(Object.entries(ndcg).map(([k, v]) => [k, beir(v)])),
})

describe('alphaOf', () => {
    test('bare name is 1, -mN is N/100, base is 0', () => {
        expect(alphaOf('gen1')).toBe(1)
        expect(alphaOf('gen1-m70')).toBe(0.7)
        expect(alphaOf('gen1-base')).toBe(0)
        expect(alphaOf('base')).toBe(0)
    })
})

describe('pickExport', () => {
    test('highest held-out MRR among exports that keep nDCG wins', () => {
        const e = report(
            { base: 0.4, gen1: 0.7, 'gen1-m70': 0.65, 'gen1-m50': 0.6, 'gen1-m30': 0.5 },
            { base: 0.5, gen1: 0.4, 'gen1-m70': 0.5, 'gen1-m50': 0.52, 'gen1-m30': 0.5 },
        )
        expect(pickExport(e).name).toBe('gen1-m70')
    })
    test('every merge forgets: base comes back', () => {
        const e = report({ base: 0.4, gen1: 0.7, 'gen1-m70': 0.65 }, { base: 0.5, gen1: 0.3, 'gen1-m70': 0.49 })
        expect(pickExport(e).name).toBe('base')
    })
    test('a tie on MRR goes to the lower alpha', () => {
        const e = report({ base: 0.4, gen1: 0.6, 'gen1-m50': 0.6, 'gen1-m70': 0.6 }, { base: 0.5, gen1: 0.5, 'gen1-m50': 0.5, 'gen1-m70': 0.5 })
        expect(pickExport(e).name).toBe('gen1-m50')
    })
    test('nDCG equal to the base qualifies, base-named exports never get picked', () => {
        const e = report({ base: 0.4, 'gen1-base': 0.9, gen1: 0.5 }, { base: 0.5, 'gen1-base': 0.5, gen1: 0.5 })
        expect(pickExport(e).name).toBe('gen1')
    })
    test('a set missing from the base row is left out of every mean', () => {
        const e: EvalReport = {
            heldoutMrr10: { base: 0.4, gen1: 0.5 },
            beir: { base: { scifact: 0.5, nfcorpus: 0.5, fiqa: 0.5 }, gen1: { scifact: 0.5, nfcorpus: 0.5, fiqa: 0.5, arguana: 0.1 } },
        }
        expect(pickExport(e).name).toBe('gen1')
    })
})

const d = (diff: number, lo = diff - 0.01, hi = diff + 0.01) => ({ diff, lo, hi })
describe('shipVerdict', () => {
    const good = { searchMrr: d(0.02, 0.005, 0.03), searchRecall: d(0.01), recallTop10: d(0.01) }
    test('all three hold', () => expect(shipVerdict(good)).toEqual({ ship: true, failed: [] }))
    test('search mrr interval touching 0 fails alone', () => {
        const v = shipVerdict({ ...good, searchMrr: d(0.02, 0, 0.04) })
        expect(v.ship).toBe(false)
        expect(v.failed).toHaveLength(1)
        expect(v.failed[0]).toContain('search mrr')
    })
    test('search recall below 0 fails alone', () => {
        const v = shipVerdict({ ...good, searchRecall: d(-0.001) })
        expect(v.failed).toHaveLength(1)
        expect(v.failed[0]).toContain('search recall')
    })
    test('recall top 10 below 0 fails alone, 0 passes', () => {
        const v = shipVerdict({ ...good, recallTop10: d(-0.002) })
        expect(v.failed).toHaveLength(1)
        expect(v.failed[0]).toContain('raw top 10')
        expect(shipVerdict({ ...good, recallTop10: d(0) }).ship).toBe(true)
    })
})

describe('pairing', () => {
    test('search pools pair by id and count the drops', () => {
        const p = (id: number) => ({ id }) as never
        const r = pairSearch([p(1), p(2), p(3)], [p(2), p(3), p(4)])
        expect(r.base.map((x: { id: number }) => x.id)).toEqual([2, 3])
        expect(r.tuned.map((x: { id: number }) => x.id)).toEqual([2, 3])
        expect(r.dropped).toBe(2)
    })
    test('recall pairs by prompt within session, repeats by occurrence, file labels only', () => {
        const row = (session: string, prompt: string, hit: boolean, labelRetrieved: boolean, labels = ['note:a.md']) => ({ session, prompt, labels, hit, labelRetrieved })
        const base = [row('s', 'p', false, false), row('s', 'p', true, true), row('s', 'q', false, true), row('s', 'docs', false, false, ['docs:x'])]
        const tuned = [row('s', 'q', false, true), row('s', 'p', true, true), row('s', 'p', true, false)]
        const r = pairByPrompt(base, tuned)
        expect(r.base).toHaveLength(3)
        expect(r.tuned.map(x => x.rr)).toEqual([1, 0, 1])
        expect(r.dropped).toBe(0)
    })
})
