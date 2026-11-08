// The learned source gate: whether a past chat, a vault file or a docs page that recall retrieved is
// worth injecting. A logistic model over the features of one candidate, its weights, bias and the one
// operating point (`threshold`) all fit by `bench/fitSourceGate.ts` on measured prompts; nothing here
// is a hand-picked cutoff. Pure: no framework, file or model imports. The same file carries the fit of
// the search blend (`FusionModel`), so one refit command writes both.
import bundled from './sourceGateModel.json'

export type GateFeatures = {
    /** Cosine of the candidate's best chunk against the query. */
    cosine: number
    /** The source's k-th best cosine: the level a hit unrelated to the query reaches. */
    background: number
    /** 0-based position among the source's candidates, best cosine first. */
    rank: number
    /** Cross-encoder logit, null when the candidate was not reranked. */
    rerank: number | null
    kind: 'file' | 'chat' | 'docs'
    /** Time path: the session's date falls inside a range the prompt names. */
    inRange: boolean
    promptChars: number
}

export type GateFit = { cases: number; heldOut: number; objective: string; at: string; [more: string]: unknown }

export type GateModel = {
    version: number
    weights: Record<string, number>
    bias: number
    /** Minimum probability that injects; chosen by the objective on held-out folds. */
    threshold: number
    fitOn: GateFit
}

/** How the two result lists of `bismuth search` are blended: weighted reciprocal-rank fusion. */
export type FusionModel = {
    version: number
    /** Weight of each list's `1 / (k + rank)` term. */
    weights: { meaning: number; keyword: number }
    k: number
    /** Reorder the fused head with the cross-encoder. */
    rerank: boolean
    fitOn: { cases: number; objective: string; at: string; [more: string]: unknown }
}

/** The model's inputs, in the order the fit writes them. */
export const FEATURE_NAMES = ['cosine', 'margin', 'logRank', 'rerank', 'noRerank', 'chat', 'docs', 'inRange', 'logPromptChars'] as const

export function featureVector(f: GateFeatures): Record<(typeof FEATURE_NAMES)[number], number> {
    return {
        cosine: f.cosine,
        margin: f.cosine - f.background,
        logRank: Math.log1p(f.rank),
        rerank: f.rerank ?? 0,
        noRerank: f.rerank === null ? 1 : 0,
        chat: f.kind === 'chat' ? 1 : 0,
        docs: f.kind === 'docs' ? 1 : 0,
        inRange: f.inRange ? 1 : 0,
        logPromptChars: Math.log1p(f.promptChars),
    }
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

export function gateProbability(f: GateFeatures, m: GateModel): number {
    const x = featureVector(f)
    let z = m.bias
    for (const name of FEATURE_NAMES) z += (m.weights[name] ?? 0) * x[name]
    return sigmoid(z)
}

/** probability >= threshold */
export function gateAccepts(f: GateFeatures, m: GateModel): boolean {
    return gateProbability(f, m) >= m.threshold
}

/** One candidate the gate scored, handed to `RecallDeps.gateTrace` so the bench can fit on exactly
 *  what production computes. */
export type GateTraceRow = {
    /** `sourceKey` of the hit. */
    key: string
    path: 'ordinary' | 'time'
    features: GateFeatures
    probability: number
    accepted: boolean
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A model read from JSON, or null when any number is missing, non-finite or out of range. */
export function parseGateModel(raw: unknown): GateModel | null {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const w = r.weights as Record<string, unknown> | undefined
    if (!finite(r.version) || !finite(r.bias) || !finite(r.threshold) || !w || typeof w !== 'object') return null
    if (r.threshold <= 0 || r.threshold > 1) return null
    for (const name of FEATURE_NAMES) if (!finite(w[name])) return null
    const fit = r.fitOn as Record<string, unknown> | undefined
    if (!fit || typeof fit !== 'object' || !finite(fit.cases) || fit.cases <= 0) return null
    return r as unknown as GateModel
}

/** Accepts nothing: what a missing or corrupt model file becomes, so recall injects no sources. */
export const CLOSED_GATE: GateModel = {
    version: 0,
    weights: {},
    bias: Number.NEGATIVE_INFINITY,
    threshold: 1,
    fitOn: { cases: 0, heldOut: 0, objective: 'closed: model file missing or corrupt', at: '' },
}

/** The committed `sourceGateModel.json`; `raw` is a test seam. Fails closed. */
export function loadGateModel(raw: unknown = bundled): GateModel {
    return parseGateModel(raw) ?? CLOSED_GATE
}

/** The committed search blend, null when its numbers are missing or corrupt. */
export function parseFusionModel(raw: unknown): FusionModel | null {
    const f = (raw as { fusion?: unknown } | null)?.fusion as Record<string, unknown> | undefined
    if (!f || typeof f !== 'object') return null
    const w = f.weights as Record<string, unknown> | undefined
    if (!w || !finite(w.meaning) || !finite(w.keyword) || w.meaning < 0 || w.keyword < 0 || w.meaning + w.keyword <= 0) return null
    if (!finite(f.k) || f.k <= 0 || typeof f.rerank !== 'boolean' || !finite(f.version)) return null
    return f as unknown as FusionModel
}

export function loadFusionModel(raw: unknown = bundled): FusionModel | null {
    return parseFusionModel(raw)
}
