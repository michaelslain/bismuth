// Fit the source gate with a time-ordered split and a measured exchange rate, A/B it against the earlier
// fits on the untouched test sessions, and (with --write) ship the variant with the best validation objective among those fit without the validation sessions.
//   bun bench/gateAB.ts --from <replay dir> --judged <candidates-judged.jsonl> --logs <claude project dir>
//       --exchange <exchange-rate.json> [--out <report.json>] [--write core/src/sourceGateModel.json] [--draws 2000]
// Inputs: `cases.jsonl` + `candidates.jsonl` of a replay (bench/recallReplay.ts), the same candidates with
// every verdict from the chosen judge prompt (bench/judgeCalibrate.ts), the lambda that
// bench/exchangeRate.ts measured, and the session logs (read only, for each session's start time).
// Variants, each trained without the test sessions and scored on exactly the same test sessions:
//   wave1  the hand-set gate (re-implemented over the saved features)
//   prev   the first learned fit: old labels (quiet = junk, strict judge), 5 session folds, 1:1
//   labels prev's procedure on the corrected labels (quiet candidates judged, chosen judge prompt)
//   split  + time-ordered split, ridge chosen on validation, operating point on validation (1:1)
//   rate   + operating point at the measured exchange rate
import { existsSync, openSync, readSync, closeSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FEATURE_NAMES, gateAccepts, type GateModel } from '../core/src/sourceGate'
import { fitGate, fitSplitGate, labelOfJudged, type CandRow } from './fitSourceGate'
import {
    bootstrapDraws,
    bootstrapInterval,
    injectedBy,
    objectiveOf,
    splitSessions,
    sumTallies,
    tallyBySession,
    wave1Accepted,
    type CaseInfo,
    type EvalRow,
    type Split,
    type Tally,
} from './gateEval'

type CaseLine = { set: EvalRow['set']; session: string; at: string; cands: { section: string }[] }
type Judged = CandRow & { judgePrompt?: string }

const readJsonl = <T,>(path: string): T[] =>
    readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as T)

/** A session's start: the first timestamp in its log. */
export function sessionStart(logPath: string): number | null {
    const fd = openSync(logPath, 'r')
    try {
        const buf = Buffer.alloc(262144)
        const n = readSync(fd, buf, 0, buf.length, 0)
        for (const l of buf.subarray(0, n).toString('utf8').split('\n')) {
            const m = l.match(/"timestamp":"([^"]+)"/)
            if (m) {
                const t = Date.parse(m[1]!)
                if (!Number.isNaN(t)) return t
            }
        }
        return null
    } finally {
        closeSync(fd)
    }
}

const asModel = (m: { weights: number[]; bias: number }, threshold: number, fitOn: GateModel['fitOn']): GateModel => ({
    version: 1,
    weights: Object.fromEntries(FEATURE_NAMES.map((n, j) => [n, m.weights[j]!])),
    bias: m.bias,
    threshold,
    fitOn,
})

const rate = (a: number, b: number) => (b ? a / b : null)

/** The variants whose weights, ridge and cut never saw the validation sessions as training data. */
export const TRAINED_WITHOUT_VALIDATION = ['split', 'rate']

/** The variant with the best validation objective; the first on a tie. */
export function pickShipped<T extends { variant: string }>(candidates: T[], validationObjective: (variant: string) => number): T {
    if (!candidates.length) throw new Error('no variant to ship')
    return candidates.reduce((a, b) => (validationObjective(b.variant) > validationObjective(a.variant) ? b : a))
}

if (import.meta.main) {
    const argv = process.argv.slice(2)
    const flag = (n: string) => {
        const i = argv.indexOf(n)
        return i >= 0 ? argv[i + 1] : undefined
    }
    const from = flag('--from')
    const judgedPath = flag('--judged')
    const logs = flag('--logs')
    const exchangePath = flag('--exchange')
    if (!from || !judgedPath || !logs || !exchangePath) {
        console.error('usage: bun bench/gateAB.ts --from <replay dir> --judged <candidates-judged.jsonl> --logs <dir> --exchange <exchange-rate.json> [--out <file>] [--write <model.json>] [--draws n]')
        process.exit(2)
    }
    const dir = resolve(from)
    const lambda = (JSON.parse(readFileSync(resolve(exchangePath), 'utf8')) as { lambda: number }).lambda
    const caseLines = readJsonl<CaseLine>(join(dir, 'cases.jsonl'))
    const cases: CaseInfo[] = caseLines.map((c, i) => ({ id: i + 1, set: c.set, session: c.session }))
    const rawCounts = new Map<string, number>()
    caseLines.forEach((c, i) => {
        for (const sec of ['files', 'chats', 'docs']) rawCounts.set(`${i + 1}|${sec === 'files' ? 'file' : sec === 'chats' ? 'chat' : 'docs'}`, c.cands.filter(x => x.section === sec).length)
    })
    const oldCands = readJsonl<CandRow>(join(dir, 'candidates.jsonl'))
    const newCands = readJsonl<Judged>(resolve(judgedPath))
    const judgePrompt = newCands[0]?.judgePrompt ?? 'unknown'

    const sessions = [...new Set(cases.map(c => c.session))]
    const starts = new Map<string, number>()
    for (const s of sessions) {
        const f = join(resolve(logs), `${s}.jsonl`)
        // the log's first timestamp; a session whose log is gone starts at its earliest replayed prompt
        const t = existsSync(f) ? sessionStart(f) : null
        const firstPrompt = Math.min(...caseLines.filter(c => c.session === s).map(c => Date.parse(c.at)))
        starts.set(s, t ?? firstPrompt)
    }
    const split: Split = splitSessions(starts)
    const splitOf = (s: string) => (split.train.has(s) ? 'train' : split.validation.has(s) ? 'validation' : 'test')

    const rows: EvalRow[] = newCands.map(c => ({ id: c.id, set: c.set, session: c.session, key: c.key, kind: c.features.kind, cosine: c.features.cosine, features: c.features, matched: c.matched, y: labelOfJudged(c) }))
    const testRows = rows.filter(r => split.test.has(r.session))
    const testSessions = [...split.test].sort()
    const trainValue = (c: { session: string }) => !split.test.has(c.session)

    // ---- the variants ----
    const prev = fitGate(oldCands.filter(trainValue), 5)
    const labels = fitGate(newCands.filter(trainValue), 5, labelOfJudged)
    const common = { cases: cases.length, at: new Date().toISOString().slice(0, 10) }
    const mk = (fitOn: Record<string, unknown>) => ({ ...common, heldOut: 0, objective: '', ...fitOn }) as GateModel['fitOn']
    const splitFit1 = fitSplitGate(rows, split, cases, 1)
    const splitFitR = fitSplitGate(rows, split, cases, lambda)
    const models: Record<string, GateModel | null> = {
        wave1: null,
        prev: prev.model as GateModel,
        labels: labels.model as GateModel,
        split: asModel({ weights: splitFit1.model.weights, bias: splitFit1.model.bias }, splitFit1.threshold, mk({})),
        rate: asModel({ weights: splitFitR.model.weights, bias: splitFitR.model.bias }, splitFitR.threshold, mk({})),
    }
        const wave1 = wave1Accepted(testRows, rawCounts)
    const injected = (name: string) => injectedBy(testRows, r => (name === 'wave1' ? wave1.has(r) : gateAccepts(r.features, models[name]!)))

    const names = ['wave1', 'prev', 'labels', 'split', 'rate']
    const tallies = Object.fromEntries(names.map(n => [n, tallyBySession(cases, injected(n), split.test)])) as Record<string, Map<string, Tally>>
    const draws = bootstrapDraws(testSessions.length, Number(flag('--draws') ?? 2000), 20261107)
    const unitsOf = (n: string) => testSessions.map(s => tallies[n]!.get(s)!)
    const objOf = (lam: number) => (sample: Tally[]) => objectiveOf(sumTallies(sample), lam)
    const results = names.map(n => {
        const t = sumTallies(tallies[n]!.values())
        const units = unitsOf(n)
        return {
            variant: n,
            threshold: models[n]?.threshold ?? null,
            injected: t.injected,
            labelledHitRate: rate(t.labelledHits, t.cases.labelled),
            precision: rate(t.labelledMatched, t.labelledInjected),
            judgedJunkRate: rate(t.junk, t.injected),
            quietFireRate: rate(t.quietFired, t.cases.quiet),
            pastChatRate: rate(t.pastChat, t.cases.past),
            hits: t.hits,
            junk: t.junk,
            objectiveMeasured: objectiveOf(t, lambda),
            objectiveMeasuredInterval: bootstrapInterval(units, objOf(lambda), draws),
            objectiveOneToOne: objectiveOf(t, 1),
            objectiveOneToOneInterval: bootstrapInterval(units, objOf(1), draws),
        }
    })
    // paired differences on the same resamples, and the rule: the new interval must clear the previous point value
    const chain = [['prev', 'labels'], ['labels', 'split'], ['split', 'rate'], ['prev', 'rate']] as const
    const steps = chain.map(([a, b]) => {
        const ra = results.find(r => r.variant === a)!
        const rb = results.find(r => r.variant === b)!
        const paired = bootstrapInterval(testSessions.map((_, i) => i), sample => objOf(lambda)(sample.map(i => unitsOf(b)[i]!)) - objOf(lambda)(sample.map(i => unitsOf(a)[i]!)), draws)
        const rule = rb.objectiveMeasuredInterval.lo > ra.objectiveMeasured
        return { from: a, to: b, previousValue: ra.objectiveMeasured, newInterval: [rb.objectiveMeasuredInterval.lo, rb.objectiveMeasuredInterval.hi], improvesByRule: rule, pairedDifference: paired, improvesPaired: paired.lo > 0 }
    })

    // ---- split statistics ----
    const splitStats = Object.fromEntries(
        (['train', 'validation', 'test'] as const).map(k => {
            const ss = new Set([...starts.keys()].filter(s => splitOf(s) === k))
            const rs = rows.filter(r => ss.has(r.session))
            const cs = cases.filter(c => ss.has(c.session))
            const t = [...ss].map(s => starts.get(s)!)
            return [k, { sessions: ss.size, cases: cs.length, candidates: rs.length, positives: rs.filter(r => r.y === 1).length, fetchedMatches: rs.filter(r => r.matched).length, labelledCases: cs.filter(c => c.set === 'labelled').length, from: new Date(Math.min(...t)).toISOString().slice(0, 10), to: new Date(Math.max(...t)).toISOString().slice(0, 10) }]
        }),
    )
    const report = {
        judgePrompt,
        measuredExchangeRate: lambda,
        split: splitStats,
        ridgeCurve1to1: splitFit1.curve,
        ridgeChosen: splitFit1.ridge,
        ridgeCurveMeasured: splitFitR.curve,
        ridgeChosenMeasured: splitFitR.ridge,
        thresholds: { prev: prev.model.threshold, labels: labels.model.threshold, split: splitFit1.threshold, rate: splitFitR.threshold },
        validationObjective: { split: splitFit1.validationObjective, rate: splitFitR.validationObjective },
        prevReport: { lambda: prev.report.lambda, heldOut: prev.report.heldOut, positives: prev.report.positives },
        labelsReport: { lambda: labels.report.lambda, heldOut: labels.report.heldOut, positives: labels.report.positives },
        testCases: sumTallies(tallies.wave1!.values()).cases,
        results,
        steps,
    }
    console.log(JSON.stringify(report, null, 2))
    const out = flag('--out')
    if (out) writeFileSync(resolve(out), JSON.stringify(report, null, 2) + '\n')

    const write = flag('--write')
    if (write) {
        // The variant is chosen on the validation sessions, at the measured exchange rate; the test sessions only report.
        const valRows = rows.filter(r => split.validation.has(r.session))
        const valObjective = (n: string) => objectiveOf(sumTallies(tallyBySession(cases, injectedBy(valRows, r => gateAccepts(r.features, models[n]!)), split.validation).values()), lambda)
        const shippable = results.filter(r => r.variant !== 'wave1')
        // only variants fit without the validation sessions compete: `prev` and `labels` train on train + validation, so their
        // validation objective is in-sample and would win on that alone
        const winner = pickShipped(shippable.filter(r => TRAINED_WITHOUT_VALIDATION.includes(r.variant)), valObjective)
        const m = models[winner.variant]!
        const shut = winner.injected === 0
        const target = resolve(write)
        const existing = existsSync(target) ? (JSON.parse(readFileSync(target, 'utf8')) as { fusion?: unknown }) : {}
        const stats = splitStats
        const ridge = winner.variant === 'rate' ? splitFitR.ridge : winner.variant === 'split' ? splitFit1.ridge : winner.variant === 'labels' ? labels.report.lambda : prev.report.lambda
        const fitOn = {
            cases: cases.length,
            heldOut: stats.test.candidates,
            objective: `exchange rate · hits − junk, over the test sessions; a hit is a labelled case with an injected candidate a fetched label matches (past-chat and time cases: one the judge marks relevant), junk an injected candidate the judge marks irrelevant; the operating point maximises it on the validation sessions`,
            at: new Date().toISOString().slice(0, 10),
            variant: winner.variant,
            judgePrompt,
            exchangeRate: lambda,
            exchangeRateMeasuredOn: 'all replayed sessions (train, validation and test)',
            ridge,
            split: { train: stats.train, validation: stats.validation, test: stats.test },
            testHitRate: winner.labelledHitRate,
            testPrecision: winner.precision,
            testJunkRate: winner.judgedJunkRate,
            testQuietFireRate: winner.quietFireRate,
            testPastChatRate: winner.pastChatRate,
            testObjective: winner.objectiveMeasured,
            testObjectiveInterval: [winner.objectiveMeasuredInterval.lo, winner.objectiveMeasuredInterval.hi],
            testObjectiveHeldOut: false,
            shut,
        }
        writeFileSync(target, JSON.stringify({ version: 1, weights: m.weights, bias: m.bias, threshold: shut ? 1 : m.threshold, fitOn, ...(existing.fusion ? { fusion: existing.fusion } : {}) }, null, 2) + '\n')
        console.log(`wrote ${target} (variant ${winner.variant}${shut ? ', shut' : ''})`)
    }
    process.exit(0)
}
