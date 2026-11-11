import { describe, expect, test } from 'bun:test'
import { CLOSED_GATE, FEATURE_NAMES, featureVector, gateAccepts, gateProbability, loadDocsFusionModel, loadFusionModel, loadGateModel, parseFusionModel, parseGateModel } from '../src/sourceGate'
import type { GateFeatures, GateModel } from '../src/sourceGate'

const features: GateFeatures = { cosine: 0.8, background: 0.7, rank: 1, rerank: 2, kind: 'file', inRange: false, promptChars: 99 }
const model = (over: Partial<GateModel> = {}): GateModel => ({
    version: 1,
    weights: { cosine: 2, margin: 10, logRank: -1, rerank: 0.5, noRerank: -3, chat: -0.5, docs: -2, inRange: 1.5, logPromptChars: 0.1 },
    bias: -4,
    threshold: 0.5,
    fitOn: { cases: 10, heldOut: 10, objective: 'test', at: '2026-11-07' },
    ...over,
})

describe('gateProbability', () => {
    test('is the logistic of bias plus weighted features', () => {
        const z = -4 + 2 * 0.8 + 10 * (0.8 - 0.7) - Math.log1p(1) + 0.5 * 2 + 0.1 * Math.log1p(99)
        expect(gateProbability(features, model())).toBeCloseTo(1 / (1 + Math.exp(-z)), 12)
    })
    test('kind, inRange and a missing rerank switch their own terms', () => {
        const base = gateProbability(features, model({ bias: 0 }))
        const z0 = Math.log(base / (1 - base))
        const z = (f: GateFeatures) => {
            const p = gateProbability(f, model({ bias: 0 }))
            return Math.log(p / (1 - p))
        }
        expect(z({ ...features, kind: 'chat' }) - z0).toBeCloseTo(-0.5, 9)
        expect(z({ ...features, kind: 'docs' }) - z0).toBeCloseTo(-2, 9)
        expect(z({ ...features, inRange: true }) - z0).toBeCloseTo(1.5, 9)
        expect(z({ ...features, rerank: null }) - z0).toBeCloseTo(-3 - 0.5 * 2, 9)
    })
    test('feature vector names are the model weight names', () => {
        expect(Object.keys(featureVector(features)).sort()).toEqual([...FEATURE_NAMES].sort())
    })
    test('accepts at exactly the threshold and above, not below', () => {
        const p = gateProbability(features, model())
        expect(gateAccepts(features, model({ threshold: p }))).toBe(true)
        expect(gateAccepts(features, model({ threshold: p + 1e-9 }))).toBe(false)
    })
})

describe('the committed model file', () => {
    test('a missing, empty or corrupt model fails closed: accepts nothing, whatever the features', () => {
        for (const raw of [null, 'x', {}, { ...model(), bias: 'n' }, { ...model(), threshold: 0 }, { ...model(), threshold: 2 }, { ...model(), weights: { cosine: 1 } }, { ...model(), bias: Number.NaN }, { ...model(), fitOn: { cases: 0 } }]) {
            const m = loadGateModel(raw)
            expect(m).toBe(CLOSED_GATE)
            expect(gateProbability({ ...features, cosine: 1, rerank: 50 }, m)).toBe(0)
            expect(gateAccepts({ ...features, cosine: 1, rerank: 50 }, m)).toBe(false)
        }
    })
    test('a well-formed model loads as is', () => {
        const m = model()
        expect(parseGateModel(m)).toEqual(m)
        expect(loadGateModel(m)).toEqual(m)
    })
    test('the bundled file parses, or is the closed gate', () => {
        const m = loadGateModel()
        expect(m).not.toBe(CLOSED_GATE)
        expect(Number.isFinite(m.threshold)).toBe(true)
        expect(Object.keys(m.weights).length).toBeGreaterThan(0)
        for (const w of Object.values(m.weights)) expect(Number.isFinite(w)).toBe(true)
        expect(Number.isFinite(m.bias)).toBe(true)
        expect(loadFusionModel()).not.toBeNull()
    })
    test('the fusion block needs positive finite numbers and a rerank flag', () => {
        const ok = { fusion: { version: 1, weights: { meaning: 1, keyword: 0.2 }, k: 30, rerank: false, fitOn: { cases: 3, objective: 'x', at: '' } } }
        expect(parseFusionModel(ok)).toEqual(ok.fusion)
        expect(loadFusionModel(ok)).toEqual(ok.fusion)
        for (const bad of [{}, { fusion: null }, { fusion: { ...ok.fusion, k: 0 } }, { fusion: { ...ok.fusion, weights: { meaning: 0, keyword: 0 } } }, { fusion: { ...ok.fusion, rerank: 'no' } }, { fusion: { ...ok.fusion, weights: { meaning: -1, keyword: 1 } } }])
            expect(parseFusionModel(bad)).toBeNull()
    })
    test('docs search reads its own blend under docsFusion, never the vault one', () => {
        const docs = { version: 1, weights: { meaning: 1, keyword: 0.2 }, k: 10, rerank: false, fitOn: { cases: 3, objective: 'x', at: '' } }
        expect(loadDocsFusionModel({ docsFusion: docs })).toEqual(docs)
        expect(loadDocsFusionModel({ fusion: docs })).toBeNull()
        expect(loadDocsFusionModel()).not.toBeNull()
    })
})
