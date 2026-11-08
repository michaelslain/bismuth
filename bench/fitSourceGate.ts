// Fit the learned source gate and the search blend from a recall replay's output.
//   bun bench/fitSourceGate.ts --from <replay out dir> [--folds 5] [--write core/src/sourceGateModel.json [--gate]]
// Reads `candidates.jsonl` (every candidate the gate scored, with its features, whether a fetched label
// matched it and the judge's verdict) and `search-pools.jsonl` (the two lists a search blends), both
// written by `bench/recallReplay.ts --judge --search`. Nothing here is a hand-picked cutoff:
//   - the gate is a logistic regression; its ridge strength is the value with the lowest held-out log loss;
//   - its one operating point (`threshold`) is the probability that maximises hits minus junk on the
//     held-out folds;
//   - the blend's weights, k and whether the cross-encoder reorders the head are the grid point with the
//     best recall@10 on the training folds, scored on the held-out ones.
// Folds split by session, never by prompt: prompts of one session share context and would leak.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FEATURE_NAMES, featureVector, gateAccepts, type FusionModel, type GateFeatures, type GateModel } from '../core/src/sourceGate'
import { bestCut, bootstrapInterval, injectedBy, objectiveOf, sumTallies, tallyBySession, type CaseInfo, type EvalRow, type Split, type Tally } from './gateEval'
import { intervalNotBelow } from './qualityReplayCases'
import { searchScore } from './recallReplayCases'

export type CandRow = {
    id: number
    set: 'labelled' | 'past' | 'time' | 'quiet'
    session: string
    key: string
    path: 'ordinary' | 'time'
    features: GateFeatures
    accepted?: boolean
    matched: boolean
    verdict?: 'relevant' | 'irrelevant' | 'error'
}

/** 1 = worth injecting (a fetched label, or the judge says relevant), 0 = junk (judged irrelevant, or
 *  any candidate of a quiet case); null = never judged, so unusable. */
export function labelOf(c: CandRow): 0 | 1 | null {
    if (c.matched) return 1
    if (c.set === 'quiet') return 0
    if (c.verdict === 'relevant') return 1
    if (c.verdict === 'irrelevant') return 0
    return null
}

/** The label with every candidate judged, a quiet case's included: 1 = a fetched label matched it or the
 *  judge says relevant, 0 = the judge says irrelevant, null = no verdict. */
export function labelOfJudged(c: Pick<CandRow, 'matched' | 'verdict'>): 0 | 1 | null {
    if (c.matched) return 1
    if (c.verdict === 'relevant') return 1
    if (c.verdict === 'irrelevant') return 0
    return null
}

// ---- folds -----------------------------------------------------------------------------------

/** Session -> fold. Sessions go heaviest first to the lightest fold, so folds balance by row count and
 *  the assignment needs no random seed. A session sits in exactly one fold. */
export function foldsBySession(rowsPerSession: Map<string, number>, folds: number): Map<string, number> {
    const load = Array.from({ length: folds }, () => 0)
    const out = new Map<string, number>()
    const order = [...rowsPerSession].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    for (const [session, n] of order) {
        let f = 0
        for (let i = 1; i < folds; i++) if (load[i]! < load[f]!) f = i
        out.set(session, f)
        load[f]! += n
    }
    return out
}

// ---- logistic regression ---------------------------------------------------------------------

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

function solve(A: number[][], b: number[]): number[] {
    const n = b.length
    const M = A.map((r, i) => [...r, b[i]!])
    for (let c = 0; c < n; c++) {
        let p = c
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r
        ;[M[c], M[p]] = [M[p]!, M[c]!]
        const d = M[c]![c]!
        if (Math.abs(d) < 1e-12) continue
        for (let r = 0; r < n; r++) {
            if (r === c) continue
            const f = M[r]![c]! / d
            if (f) for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!
        }
    }
    return M.map((r, i) => (Math.abs(r[i]!) < 1e-12 ? 0 : r[n]! / r[i]!))
}

export type Logistic = { weights: number[]; bias: number }

/** Ridge logistic regression by Newton's method. Columns are standardised for the fit and the result is
 *  mapped back to the raw feature scale; a constant column gets weight 0. `lambda` penalises the
 *  standardised weights, never the bias. */
export function fitLogistic(X: number[][], y: number[], lambda: number, iterations = 60): Logistic {
    const n = X.length
    const p = X[0]?.length ?? 0
    const mean = Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[j]!, 0) / n)
    const sd = Array.from({ length: p }, (_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j]! - mean[j]!) ** 2, 0) / n))
    const Z = X.map(r => r.map((v, j) => (sd[j]! > 1e-9 ? (v - mean[j]!) / sd[j]! : 0)))
    let beta = Array.from({ length: p + 1 }, () => 0)
    for (let it = 0; it < iterations; it++) {
        const g = Array.from({ length: p + 1 }, () => 0)
        const H = Array.from({ length: p + 1 }, () => Array.from({ length: p + 1 }, () => 0))
        for (let i = 0; i < n; i++) {
            const z = [1, ...Z[i]!]
            const pr = sigmoid(z.reduce((a, v, j) => a + v * beta[j]!, 0))
            const w = Math.max(pr * (1 - pr), 1e-6)
            for (let a = 0; a <= p; a++) {
                g[a]! += (pr - y[i]!) * z[a]!
                for (let b = 0; b <= a; b++) H[a]![b]! += w * z[a]! * z[b]!
            }
        }
        for (let a = 1; a <= p; a++) {
            g[a]! += lambda * beta[a]!
            H[a]![a]! += lambda
        }
        for (let a = 0; a <= p; a++) for (let b = a + 1; b <= p; b++) H[a]![b] = H[b]![a]!
        H[0]![0]! += 1e-9
        const step = solve(H, g)
        let move = 0
        beta = beta.map((v, j) => {
            move = Math.max(move, Math.abs(step[j]!))
            return v - step[j]!
        })
        if (move < 1e-8) break
    }
    const weights = Array.from({ length: p }, (_, j) => (sd[j]! > 1e-9 ? beta[j + 1]! / sd[j]! : 0))
    const bias = beta[0]! - weights.reduce((a, w, j) => a + w * mean[j]!, 0)
    return { weights, bias }
}

export const predict = (m: Logistic, x: number[]): number => sigmoid(m.bias + m.weights.reduce((a, w, j) => a + w * x[j]!, 0))

/** The model inputs of one candidate. A name in `drop` reads 0, so the fit gives it weight 0. */
export const rowVector = (f: GateFeatures, drop: readonly string[] = []): number[] => {
    const v = featureVector(f)
    return FEATURE_NAMES.map(n => (drop.includes(n) ? 0 : v[n]))
}

/** `inRange` and `noRerank` are the same column in every replayed row (a dated chat is the only candidate with
 *  no rerank answer, and it is always in range), so the two cannot be told apart and a ridge fit splits one
 *  effect between them. The refit keeps `noRerank`, which is also the time path's own intercept, and drops `inRange`. */
export const DROPPED_COLUMNS = ['inRange'] as const

const logLoss = (p: number[], y: number[]) => p.reduce((a, q, i) => a - (y[i]! ? Math.log(Math.max(q, 1e-12)) : Math.log(Math.max(1 - q, 1e-12))), 0) / Math.max(1, p.length)

// ---- the operating point ---------------------------------------------------------------------

export type Scored = { caseId: number; set: CandRow['set']; matched: boolean; y: 0 | 1; p: number }

/** hits minus junk at threshold `t`. A hit is a case with an accepted candidate that a fetched label
 *  matched; for a past-chat or time case, which has no labels, an accepted candidate the judge marked
 *  relevant. Junk is an accepted candidate that is judged irrelevant, or that sits in a quiet case. */
export function objectiveAt(rows: Scored[], t: number): { objective: number; hits: number; junk: number; accepted: number } {
    const hit = new Set<number>()
    let junk = 0
    let accepted = 0
    for (const r of rows) {
        if (r.p < t) continue
        accepted++
        if (r.y === 0) junk++
        else if (r.matched || r.set === 'past' || r.set === 'time') hit.add(r.caseId)
    }
    return { objective: hit.size - junk, hits: hit.size, junk, accepted }
}

/** The probability that maximises the objective over these held-out rows: the midpoint between the
 *  best row's probability and the next lower one, so the cut does not sit on a sample point. */
export function bestThreshold(rows: Scored[]): { threshold: number; at: ReturnType<typeof objectiveAt> } {
    const ps = [...new Set(rows.map(r => r.p))].sort((a, b) => b - a)
    let best = { threshold: 1, at: objectiveAt(rows, 1.0000001) }
    let bestAt = ps.length ? -1 : 0
    ps.forEach((p, i) => {
        const at = objectiveAt(rows, p)
        if (at.objective > best.at.objective) {
            best = { threshold: p, at }
            bestAt = i
        }
    })
    if (bestAt >= 0 && bestAt + 1 < ps.length) best.threshold = (ps[bestAt]! + ps[bestAt + 1]!) / 2
    return best
}

export type GateReport = {
    candidates: number
    cases: number
    sessions: number
    positives: number
    lambda: number
    lambdaGrid: { lambda: number; logLoss: number }[]
    threshold: number
    heldOut: ReturnType<typeof objectiveAt> & { rows: number }
    perFold: ReturnType<typeof objectiveAt>[]
    /** The same held-out rows if every candidate were injected, for scale. */
    acceptAll: ReturnType<typeof objectiveAt>
    weights: Record<string, number>
    bias: number
}

export const LAMBDA_GRID = [0.01, 0.1, 1, 10, 100]

export function fitGate(all: CandRow[], folds: number, label: (c: CandRow) => 0 | 1 | null = labelOf): { model: Omit<GateModel, 'fitOn'> & { fitOn: Partial<GateModel['fitOn']> }; report: GateReport } {
    const rows = all.flatMap(c => {
        const y = label(c)
        return y === null ? [] : [{ c, y, x: rowVector(c.features) }]
    })
    if (!rows.length) throw new Error('no judged candidates to fit')
    const perSession = new Map<string, number>()
    for (const r of rows) perSession.set(r.c.session, (perSession.get(r.c.session) ?? 0) + 1)
    const fold = foldsBySession(perSession, Math.min(folds, perSession.size))
    const nFolds = Math.max(...fold.values()) + 1
    const foldOf = rows.map(r => fold.get(r.c.session)!)
    const heldOutProbs = (lambda: number): number[] => {
        const p = Array.from({ length: rows.length }, () => 0)
        for (let f = 0; f < nFolds; f++) {
            const tr = rows.filter((_, i) => foldOf[i] !== f)
            if (!tr.some(r => r.y === 1) || !tr.some(r => r.y === 0)) continue
            const m = fitLogistic(tr.map(r => r.x), tr.map(r => r.y), lambda)
            rows.forEach((r, i) => {
                if (foldOf[i] === f) p[i] = predict(m, r.x)
            })
        }
        return p
    }
    const y = rows.map(r => r.y)
    const lambdaGrid = LAMBDA_GRID.map(lambda => ({ lambda, logLoss: logLoss(heldOutProbs(lambda), y) }))
    const lambda = lambdaGrid.reduce((a, b) => (b.logLoss < a.logLoss ? b : a)).lambda
    const probs = heldOutProbs(lambda)
    const scored: Scored[] = rows.map((r, i) => ({ caseId: r.c.id, set: r.c.set, matched: r.c.matched, y: r.y, p: probs[i]! }))
    const { threshold, at } = bestThreshold(scored)
    const perFold = Array.from({ length: nFolds }, (_, f) => objectiveAt(scored.filter((_, i) => foldOf[i] === f), threshold))
    const m = fitLogistic(rows.map(r => r.x), y, lambda)
    const weights = Object.fromEntries(FEATURE_NAMES.map((n, j) => [n, m.weights[j]!]))
    return {
        model: {
            version: 1,
            weights,
            bias: m.bias,
            threshold,
            fitOn: {
                cases: new Set(rows.map(r => r.c.id)).size,
                heldOut: rows.length,
                objective:
                    'hits minus junk on held-out session folds: a hit is a labelled case with an injected candidate its fetched label matches (or, for past-chat and time cases, one the judge marks relevant); junk is an injected candidate the judge marks irrelevant or any injected candidate of a quiet case',
                at: new Date().toISOString().slice(0, 10),
                folds: nFolds,
                lambda,
                heldOutObjective: at.objective,
                heldOutHits: at.hits,
                heldOutJunk: at.junk,
                heldOutAccepted: at.accepted,
            },
        },
        report: {
            candidates: rows.length,
            cases: new Set(rows.map(r => r.c.id)).size,
            sessions: perSession.size,
            positives: y.filter(v => v === 1).length,
            lambda,
            lambdaGrid,
            threshold,
            heldOut: { ...at, rows: rows.length },
            perFold,
            acceptAll: objectiveAt(scored, 0),
            weights,
            bias: m.bias,
        },
    }
}

// ---- the split fit ---------------------------------------------------------------------------

/** Ridge strengths tried, a log grid (half a decade apart) over the range where a standardised logistic
 *  fit moves from nearly unpenalised to nearly constant. Search resolution, not a decision: validation picks. */
export const RIDGE_GRID = Array.from({ length: 17 }, (_, i) => 10 ** (-4 + i / 2))

export type SplitFit = {
    model: Logistic
    ridge: number
    curve: { lambda: number; validationLogLoss: number; trainLogLoss: number }[]
    threshold: number
    validationObjective: number
}

/** Fit on the train sessions, choose the ridge strength by validation log loss, and choose the operating
 *  point by `exchange`·hits − junk on the validation sessions (pack caps applied). The test sessions are
 *  never read. */
export function fitSplitGate(rows: EvalRow[], split: Split, cases: CaseInfo[], exchange: number, drop: readonly string[] = []): SplitFit {
    const usable = rows.filter(r => r.y !== null)
    const train = usable.filter(r => split.train.has(r.session))
    const val = usable.filter(r => split.validation.has(r.session))
    if (!train.some(r => r.y === 1) || !train.some(r => r.y === 0)) throw new Error('train split needs both classes')
    const X = (rs: EvalRow[]) => rs.map(r => rowVector(r.features, drop))
    const Y = (rs: EvalRow[]) => rs.map(r => r.y as number)
    const fits = RIDGE_GRID.map(lambda => {
        const m = fitLogistic(X(train), Y(train), lambda)
        return { lambda, m, validationLogLoss: logLoss(X(val).map(x => predict(m, x)), Y(val)), trainLogLoss: logLoss(X(train).map(x => predict(m, x)), Y(train)) }
    })
    const best = fits.reduce((a, b) => (b.validationLogLoss < a.validationLogLoss ? b : a))
    const scored = val.map(r => ({ ...r, p: predict(best.m, rowVector(r.features, drop)) }))
    const cut = bestCut(scored, cases, exchange)
    return {
        model: best.m,
        ridge: best.lambda,
        curve: fits.map(f => ({ lambda: f.lambda, validationLogLoss: f.validationLogLoss, trainLogLoss: f.trainLogLoss })),
        threshold: cut.threshold,
        validationObjective: cut.objective,
    }
}

/** A fitted logistic as a gate model at an operating point. */
export const toGateModel = (m: Logistic, threshold: number, fitOn: GateModel['fitOn']): GateModel => ({
    version: 1,
    weights: Object.fromEntries(FEATURE_NAMES.map((n, j) => [n, m.weights[j]!])) as GateModel['weights'],
    bias: m.bias,
    threshold,
    fitOn,
})

/** The ship rule: the refit beats the shipped model on the validation sessions at the new rate and at the old one. */
export const shipsRefit = (v: { atNew: { current: number; refit: number }; atOld: { current: number; refit: number } }): boolean => v.atNew.refit > v.atNew.current && v.atOld.refit > v.atOld.current

/** Refit the gate's operating point on the full cost of a junk item and score both models on the test
 *  sessions. `lambdaNew` is the fetch tokens over the junk item's full cost (bench/qualityReplay.ts derives
 *  it from the quality replay, from the test-split agent runs); `lambdaOld` is the exchange rate the shipped
 *  model was fit with. Weights and ridge are refit on the train sessions, the cut is re-picked on the
 *  validation sessions at `lambdaNew`, and the test sessions are read only to score. Both models are scored
 *  at `lambdaNew` and at `lambdaOld`, with 95% session-bootstrap intervals on shared draws and the paired
 *  difference.
 *
 *  `ship` is decided on the validation sessions and needs the refit to BEAT the shipped model there at both
 *  rates, the old one and the new one. The new rate comes from the test sessions, so a rule on the new rate
 *  alone would let a number measured on test pick the model; at the old rate the shipped model's cut was
 *  already picked, so the refit has to win where the shipped model is at its best too. The test sessions only
 *  report; `testNotBelow` says whether the refit's test interval is not below the shipped model's.
 *  `shipped` is the model to commit and `shippedRow` the numbers that describe it. */
export function refitOnJunkCost(a: { rows: EvalRow[]; split: Split; cases: CaseInfo[]; current: GateModel; lambdaOld: number; lambdaNew: number; draws: number[][] }) {
    const fit = fitSplitGate(a.rows, a.split, a.cases, a.lambdaNew, DROPPED_COLUMNS)
    const refit = toGateModel(fit.model, fit.threshold, a.current.fitOn)
    const valRows = a.rows.filter(r => a.split.validation.has(r.session))
    const valObjective = (m: GateModel, lam: number) => objectiveOf(sumTallies(tallyBySession(a.cases, injectedBy(valRows, r => gateAccepts(r.features, m)), a.split.validation).values()), lam)
    const validation = {
        atNew: { current: valObjective(a.current, a.lambdaNew), refit: valObjective(refit, a.lambdaNew) },
        atOld: { current: valObjective(a.current, a.lambdaOld), refit: valObjective(refit, a.lambdaOld) },
    }
    const testRows = a.rows.filter(r => a.split.test.has(r.session))
    const sessions = [...a.split.test].sort()
    const models = { current: a.current, refit }
    const units = Object.fromEntries(
        (Object.keys(models) as (keyof typeof models)[]).map(k => [k, tallyBySession(a.cases, injectedBy(testRows, r => gateAccepts(r.features, models[k])), a.split.test)]),
    ) as Record<keyof typeof models, Map<string, Tally>>
    const of = (k: keyof typeof models) => sessions.map(s => units[k].get(s)!)
    const obj = (lam: number) => (sample: Tally[]) => objectiveOf(sumTallies(sample), lam)
    const ratio = (n: number, d: number) => (d ? n / d : null)
    const row = (k: keyof typeof models) => {
        const t = sumTallies(units[k].values())
        return {
            threshold: models[k].threshold,
            injected: t.injected,
            hits: t.hits,
            junk: t.junk,
            quietFired: t.quietFired,
            quietCases: t.cases.quiet,
            pastChat: t.pastChat,
            pastCases: t.cases.past,
            hitRate: ratio(t.labelledHits, t.cases.labelled),
            precision: ratio(t.labelledMatched, t.labelledInjected),
            junkRate: ratio(t.junk, t.injected),
            quietFireRate: ratio(t.quietFired, t.cases.quiet),
            pastChatRate: ratio(t.pastChat, t.cases.past),
            objectiveNew: { value: objectiveOf(t, a.lambdaNew), ...bootstrapInterval(of(k), obj(a.lambdaNew), a.draws) },
            objectiveOld: { value: objectiveOf(t, a.lambdaOld), ...bootstrapInterval(of(k), obj(a.lambdaOld), a.draws) },
        }
    }
    const current = row('current')
    const refitRow = row('refit')
    const idx = sessions.map((_, i) => i)
    const paired = (lam: number) => bootstrapInterval(idx, s => obj(lam)(s.map(i => of('refit')[i]!)) - obj(lam)(s.map(i => of('current')[i]!)), a.draws)
    const ship = shipsRefit(validation)
    return {
        lambdaOld: a.lambdaOld,
        lambdaNew: a.lambdaNew,
        ridge: fit.ridge,
        validationObjective: validation,
        current,
        refit: refitRow,
        pairedDifferenceNew: paired(a.lambdaNew),
        pairedDifferenceOld: paired(a.lambdaOld),
        changed: current.threshold !== refitRow.threshold,
        ship,
        testNotBelow: intervalNotBelow(refitRow.objectiveNew, current.objectiveNew),
        model: refit,
        shipped: ship ? refit : a.current,
        shippedRow: ship ? refitRow : current,
    }
}

/** The `fitOn` of the model the quality replay commits: the shipped model's own test numbers, recomputed for it,
 *  and what its rate was measured on (a refit's, the test sessions; the kept model's, every replayed session, test included). `previous` is the model file's fitOn before the replay. The rate is
 *  measured on the test sessions' agent runs, so the test objective is not held out with respect to it. */
export function shippedFitOn(previous: GateModel['fitOn'], r: ReturnType<typeof refitOnJunkCost>, measured: { savedTokensPerHit: number; junkCostTokensPerItem: number; at: string; measuredRate: number | null }): GateModel['fitOn'] {
    const row = r.shippedRow
    const rate = r.ship ? r.lambdaNew : r.lambdaOld
    const objective = r.ship ? row.objectiveNew : row.objectiveOld
    return {
        ...previous,
        at: measured.at,
        ...(r.ship
            ? {
                  exchangeRate: r.lambdaNew,
                  exchangeRateWas: r.lambdaOld,
                  exchangeRateInputs: { savedTokensPerHit: measured.savedTokensPerHit, junkCostTokensPerItem: measured.junkCostTokensPerItem },
                  exchangeRateMeasuredOn: 'test sessions',
                  objective: 'exchange rate · hits − junk, over the test sessions, the exchange rate taken from the quality replay (fetch tokens over the full token cost of a junk item); a hit is a labelled case with an injected candidate a fetched label matches (past-chat and time cases: one the judge marks relevant), junk an injected candidate the judge marks irrelevant; the operating point maximises it on the validation sessions',
                  droppedColumns: DROPPED_COLUMNS,
                  ridge: r.ridge,
              }
            : { exchangeRateMeasuredOn: 'all replayed sessions (train, validation and test)' }),
        testHitRate: row.hitRate,
        testPrecision: row.precision,
        testJunkRate: row.junkRate,
        testQuietFireRate: row.quietFireRate,
        testPastChatRate: row.pastChatRate,
        testObjective: objective.value,
        testObjectiveInterval: [objective.lo, objective.hi],
        testObjectiveRate: rate,
        testObjectiveHeldOut: false,
        qualityReplay: {
            at: measured.at,
            measuredRate: measured.measuredRate,
            measuredRateOn: 'test sessions',
            ...(measured.measuredRate === null ? { note: 'the saving per hit over the cost per junk item has no positive value here (the cost interval reaches zero), so no rate was measured and no refit was made' } : {}),
            measuredRateInputs: { savedTokensPerHit: measured.savedTokensPerHit, junkCostTokensPerItem: measured.junkCostTokensPerItem },
            refitShipped: r.ship,
            ...(measured.measuredRate === null ? {} : { refitThreshold: r.refit.threshold, validation: r.validationObjective }),
        },
    } as GateModel['fitOn']
}

// ---- the search blend ------------------------------------------------------------------------

export type PoolRow = {
    session: string
    labels: string[]
    meaning: [string, string | null][]
    keyword: [string, string | null][]
    logit: Record<string, number>
}

export type FusionConfig = { keyword: number; k: number; rerank: boolean }
/** Search resolution of the blend fit, not a decision: the data picks the point. Weight of the meaning
 *  list is 1; only the ratio to the keyword weight matters. */
export const KEYWORD_WEIGHTS = [0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 4]
export const FUSION_KS = [1, 3, 10, 30, 60, 100, 200]
/** Head the cross-encoder reorders, as in `core/src/hybridSearch.ts`. */
const RERANK_HEAD = 20

/** What a search with this blend would list for a pooled case, scoring keys in order (chats dropped, as
 *  the bench scores files only). */
export function rankPool(c: PoolRow, cfg: FusionConfig, limit = 10): string[] {
    const score = new Map<string, number>()
    const scoreKey = new Map<string, string | null>()
    const add = (list: [string, string | null][], w: number) =>
        list.forEach(([id, sk], i) => {
            score.set(id, (score.get(id) ?? 0) + w / (cfg.k + i + 1))
            if (!scoreKey.has(id)) scoreKey.set(id, sk)
        })
    add(c.meaning, 1)
    add(c.keyword, cfg.keyword)
    let order = [...score].sort((a, b) => b[1] - a[1]).map(e => e[0])
    if (cfg.rerank && order.length >= 2) {
        const head = order.slice(0, RERANK_HEAD)
        const re = head
            .map((id, i) => ({ id, i, l: c.logit[id] ?? Number.NEGATIVE_INFINITY }))
            .sort((a, b) => b.l - a.l || a.i - b.i)
            .map(o => o.id)
        order = [...re, ...order.slice(RERANK_HEAD)]
    }
    return order
        .filter(id => !id.startsWith('chat:'))
        .map(id => scoreKey.get(id) ?? null)
        .filter((k): k is string => !!k)
        .slice(0, limit)
}

const scoreCases = (cs: PoolRow[], cfg: FusionConfig) =>
    searchScore(cs.map(c => ({ ranked: rankPool(c, cfg), labels: c.labels })))

const better = (a: { recall: number; mrr: number }, b: { recall: number; mrr: number }) => a.recall > b.recall || (a.recall === b.recall && a.mrr > b.mrr)

export function bestConfig(cs: PoolRow[], only?: (cfg: FusionConfig) => boolean): FusionConfig {
    let best: { cfg: FusionConfig; s: { recall: number; mrr: number } } | null = null
    for (const keyword of KEYWORD_WEIGHTS)
        for (const k of FUSION_KS)
            for (const rerank of [false, true]) {
                const cfg = { keyword, k, rerank }
                if (only && !only(cfg)) continue
                // at keyword weight 0 the list order ignores k
                if (keyword === 0 && k !== FUSION_KS[0]) continue
                const s = scoreCases(cs, cfg)
                if (!best || better(s, best.s)) best = { cfg, s }
            }
    return best!.cfg
}

export type FusionReport = {
    cases: number
    folds: number
    heldOut: { hybrid: { recall: number; mrr: number }; meaningOnly: { recall: number; mrr: number }; equalWeight: { recall: number; mrr: number } }
    chosen: FusionConfig
    verdict: string
    allData: { chosen: { recall: number; mrr: number }; meaningOnly: { recall: number; mrr: number } }
}

export function fitFusion(all: PoolRow[], folds: number): { model: FusionModel; report: FusionReport } {
    const perSession = new Map<string, number>()
    for (const c of all) perSession.set(c.session, (perSession.get(c.session) ?? 0) + 1)
    const fold = foldsBySession(perSession, Math.min(folds, perSession.size))
    const nFolds = Math.max(...fold.values()) + 1
    const meaningOnly = (cfg: FusionConfig) => cfg.keyword === 0
    const held = { hybrid: [] as { ranked: string[]; labels: string[] }[], meaning: [] as { ranked: string[]; labels: string[] }[], equal: [] as { ranked: string[]; labels: string[] }[] }
    for (let f = 0; f < nFolds; f++) {
        const tr = all.filter(c => fold.get(c.session) !== f)
        const te = all.filter(c => fold.get(c.session) === f)
        const h = bestConfig(tr)
        const m = bestConfig(tr, meaningOnly)
        for (const c of te) {
            held.hybrid.push({ ranked: rankPool(c, h), labels: c.labels })
            held.meaning.push({ ranked: rankPool(c, m), labels: c.labels })
            held.equal.push({ ranked: rankPool(c, { keyword: 1, k: 60, rerank: true }), labels: c.labels })
        }
    }
    const hybrid = searchScore(held.hybrid)
    const meaning = searchScore(held.meaning)
    const equal = searchScore(held.equal)
    const useHybrid = hybrid.recall >= meaning.recall
    const chosen = useHybrid ? bestConfig(all) : bestConfig(all, meaningOnly)
    const verdict = useHybrid
        ? `blending keyword and meaning reaches held-out recall@10 ${hybrid.recall.toFixed(3)}, at least meaning alone (${meaning.recall.toFixed(3)}): the fitted blend ships`
        : `no blend reached meaning alone on held-out folds (${hybrid.recall.toFixed(3)} vs ${meaning.recall.toFixed(3)}): search ships meaning-ordered, keyword list kept for the keyword-only fallback`
    const model: FusionModel = {
        version: 1,
        weights: { meaning: 1, keyword: chosen.keyword },
        k: chosen.k,
        rerank: chosen.rerank,
        fitOn: {
            cases: all.length,
            objective: 'recall@10 of the labelled files on held-out session folds; the grid point with the best training-fold recall@10 is scored on its held-out fold',
            at: new Date().toISOString().slice(0, 10),
            folds: nFolds,
            heldOutRecall: hybrid.recall,
            heldOutMeaningOnlyRecall: meaning.recall,
            verdict,
        },
    }
    return {
        model,
        report: {
            cases: all.length,
            folds: nFolds,
            heldOut: { hybrid, meaningOnly: meaning, equalWeight: equal },
            chosen,
            verdict,
            allData: { chosen: scoreCases(all, chosen), meaningOnly: scoreCases(all, bestConfig(all, meaningOnly)) },
        },
    }
}

// ---- cli -------------------------------------------------------------------------------------

const readJsonl = <T,>(path: string): T[] =>
    readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as T)

/** The model file after this CLI's fit: the existing gate stays (weights, bias, threshold, fitOn) unless `replaceGate`
 *  or the file has none; the blend is replaced when this run fit one. */
export function mergeModelFile(existing: Record<string, unknown>, gate: object, fusion: object | null, replaceGate: boolean): Record<string, unknown> {
    const next = replaceGate || !existing.weights ? { ...existing, ...gate } : { ...existing }
    if (fusion) next.fusion = fusion
    return next
}

if (import.meta.main) {
    const argv = process.argv.slice(2)
    const flag = (n: string) => {
        const i = argv.indexOf(n)
        return i >= 0 ? argv[i + 1] : undefined
    }
    const from = flag('--from')
    if (!from) {
        console.error('usage: bun bench/fitSourceGate.ts --from <replay out dir> [--folds 5] [--write core/src/sourceGateModel.json [--gate]]')
        process.exit(2)
    }
    const dir = resolve(from)
    const folds = Number(flag('--folds') ?? 5)
    const gate = fitGate(readJsonl<CandRow>(join(dir, 'candidates.jsonl')), folds)
    console.log(JSON.stringify(gate.report, null, 2))
    const poolsPath = join(dir, 'search-pools.jsonl')
    const fusion = existsSync(poolsPath) ? fitFusion(readJsonl<PoolRow>(poolsPath), folds) : null
    if (fusion) console.log(JSON.stringify(fusion.report, null, 2))
    writeFileSync(join(dir, 'fit-report.json'), JSON.stringify({ gate: gate.report, fusion: fusion?.report ?? null }, null, 2))
    const write = flag('--write')
    if (write) {
        // The model file holds the shipped gate (a time-ordered fit, bench/gateAB.ts) and the blend. This CLI fits the
        // first-generation gate on session folds, so it replaces only `fusion`; `--gate` also replaces the gate.
        const target = resolve(write)
        const existing = existsSync(target) ? (JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>) : {}
        const next = mergeModelFile(existing, gate.model, fusion?.model ?? null, argv.includes('--gate'))
        writeFileSync(target, JSON.stringify(next, null, 2) + '\n')
        console.log(`wrote ${target} (${argv.includes('--gate') || !existing.weights ? 'gate + ' : 'blend only, '}fusion ${fusion ? 'replaced' : 'kept'})`)
    }
}
