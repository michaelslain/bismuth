// Offline evaluation of a source gate on a replay's saved candidates: the time-ordered session split, the
// pack caps, per-session tallies, the lambda-weighted objective and its bootstrap interval. Pure; the
// fit (bench/fitSourceGate.ts) and the A/B both build on it.
import type { GateFeatures } from '../core/src/sourceGate'

// ---- the split ---------------------------------------------------------------------------------

export type Split = { train: Set<string>; validation: Set<string>; test: Set<string> }

/** Sessions ordered by start time (ties by id): the oldest `trainShare` train, the next `validationShare`
 *  validation, the newest test. Every session lands in exactly one set, and a later session never
 *  trains a model that is tested on an earlier one. */
export function splitSessions(starts: Map<string, number>, trainShare = 0.6, validationShare = 0.2): Split {
    const order = [...starts].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(e => e[0])
    const nTrain = Math.round(order.length * trainShare)
    const nVal = Math.round(order.length * validationShare)
    return { train: new Set(order.slice(0, nTrain)), validation: new Set(order.slice(nTrain, nTrain + nVal)), test: new Set(order.slice(nTrain + nVal)) }
}

// ---- rows and tallies --------------------------------------------------------------------------

export type EvalRow = {
    /** Replay case number. */
    id: number
    set: 'labelled' | 'past' | 'time' | 'quiet'
    session: string
    key: string
    kind: GateFeatures['kind']
    cosine: number
    features: GateFeatures
    /** A fetched label matched this candidate. */
    matched: boolean
    /** 1 = worth injecting (fetched, or judged relevant), 0 = junk (judged irrelevant), null = unjudged. */
    y: 0 | 1 | null
}

export type CaseInfo = { id: number; set: EvalRow['set']; session: string }

/** Items per source a packed block holds (core/src/sourcePack.ts `SOURCE_LIMITS.prompt`). */
export const PACK_CAP = 2

const sectionOfKind = (k: GateFeatures['kind']) => (k === 'chat' ? 'chats' : k === 'docs' ? 'docs' : 'files')

/** The candidates a pack would keep: per case and source, the `cap` accepted with the best cosine. */
export function packCapped(accepted: EvalRow[], cap = PACK_CAP): EvalRow[] {
    const groups = new Map<string, EvalRow[]>()
    for (const r of accepted) {
        const g = `${r.id}|${sectionOfKind(r.kind)}`
        const list = groups.get(g)
        if (list) list.push(r)
        else groups.set(g, [r])
    }
    return [...groups.values()].flatMap(list => list.sort((a, b) => b.cosine - a.cosine).slice(0, cap))
}

export type Tally = {
    cases: Record<EvalRow['set'], number>
    /** Cases with an injected candidate a fetched label matched, or (past, time) one the judge marked relevant. */
    hits: number
    labelledHits: number
    junk: number
    injected: number
    /** Injected candidates in labelled cases, and those a fetched label matched. */
    labelledInjected: number
    labelledMatched: number
    quietFired: number
    pastChat: number
}

const emptyTally = (): Tally => ({ cases: { labelled: 0, past: 0, time: 0, quiet: 0 }, hits: 0, labelledHits: 0, junk: 0, injected: 0, labelledInjected: 0, labelledMatched: 0, quietFired: 0, pastChat: 0 })

export const addTally = (a: Tally, b: Tally): Tally => ({
    cases: { labelled: a.cases.labelled + b.cases.labelled, past: a.cases.past + b.cases.past, time: a.cases.time + b.cases.time, quiet: a.cases.quiet + b.cases.quiet },
    hits: a.hits + b.hits,
    labelledHits: a.labelledHits + b.labelledHits,
    junk: a.junk + b.junk,
    injected: a.injected + b.injected,
    labelledInjected: a.labelledInjected + b.labelledInjected,
    labelledMatched: a.labelledMatched + b.labelledMatched,
    quietFired: a.quietFired + b.quietFired,
    pastChat: a.pastChat + b.pastChat,
})

/** Per-session tallies of the injected candidates (already pack-capped). `cases` holds every case of the
 *  sessions, with or without candidates, so rates have the right denominators. */
export function tallyBySession(cases: CaseInfo[], injected: EvalRow[], sessions: Set<string>): Map<string, Tally> {
    const out = new Map<string, Tally>()
    const tally = (s: string) => {
        let t = out.get(s)
        if (!t) out.set(s, (t = emptyTally()))
        return t
    }
    for (const s of sessions) tally(s)
    const setOf = new Map<number, EvalRow['set']>()
    for (const c of cases) {
        if (!sessions.has(c.session)) continue
        tally(c.session).cases[c.set]++
        setOf.set(c.id, c.set)
    }
    const byCase = new Map<number, EvalRow[]>()
    for (const r of injected) {
        if (!sessions.has(r.session)) continue
        const list = byCase.get(r.id)
        if (list) list.push(r)
        else byCase.set(r.id, [r])
    }
    for (const [id, rs] of byCase) {
        const t = tally(rs[0]!.session)
        const set = rs[0]!.set
        t.injected += rs.length
        t.junk += rs.filter(r => r.y === 0).length
        if (set === 'labelled') {
            t.labelledInjected += rs.length
            t.labelledMatched += rs.filter(r => r.matched).length
            if (rs.some(r => r.matched)) {
                t.hits++
                t.labelledHits++
            }
        } else if (set === 'past' || set === 'time') {
            if (rs.some(r => r.y === 1)) t.hits++
            if (set === 'past' && rs.some(r => r.kind === 'chat')) t.pastChat++
        } else if (set === 'quiet') t.quietFired++
        void id
    }
    return out
}

/** `lambda`·hits − junk. */
export const objectiveOf = (t: Pick<Tally, 'hits' | 'junk'>, lambda: number): number => lambda * t.hits - t.junk

export const sumTallies = (m: Iterable<Tally>): Tally => [...m].reduce(addTally, emptyTally())

/** The accepted, pack-capped candidates among `rows` for an acceptance rule. */
export const injectedBy = (rows: EvalRow[], accepts: (r: EvalRow) => boolean): EvalRow[] => packCapped(rows.filter(accepts))

// ---- the operating point -----------------------------------------------------------------------

/** The probability cut that maximises `lambda`·hits − junk over `rows` (each with a probability `p`), with
 *  the pack caps applied. Ties go to the higher cut (fewer injections). The returned cut is the midpoint
 *  between the best row's probability and the next lower one; 1 means nothing is injected. */
export function bestCut(rows: (EvalRow & { p: number })[], cases: CaseInfo[], lambda: number): { threshold: number; objective: number } {
    const sessions = new Set(rows.map(r => r.session))
    const value = (t: number) => objectiveOf(sumTallies(tallyBySession(cases, injectedBy(rows, r => (r as EvalRow & { p: number }).p >= t), sessions).values()), lambda)
    const ps = [...new Set(rows.map(r => r.p))].sort((a, b) => b - a)
    let best = { at: -1, objective: 0 }
    ps.forEach((p, i) => {
        const o = value(p)
        if (o > best.objective) best = { at: i, objective: o }
    })
    if (best.at < 0) return { threshold: 1, objective: 0 }
    const next = ps[best.at + 1]
    return { threshold: next === undefined ? ps[best.at]! : (ps[best.at]! + next) / 2, objective: best.objective }
}

// ---- bootstrap ---------------------------------------------------------------------------------

/** A small deterministic generator (mulberry32), so an interval reproduces. */
export function rngOf(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Percentile bootstrap: `iterations` resamples of `n` units with replacement; for each, `stat` gets the
 *  resampled unit indexes. Returns the mean and the central `level` interval. Passing one `draws` list to
 *  several stats pairs them on the same resamples. */
export function bootstrapDraws(n: number, iterations: number, seed: number): number[][] {
    const rand = rngOf(seed)
    return Array.from({ length: iterations }, () => Array.from({ length: n }, () => Math.floor(rand() * n)))
}

export function intervalOf(values: number[], level = 0.95): { mean: number; lo: number; hi: number } {
    const v = [...values].sort((a, b) => a - b)
    const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * v.length + 1e-9)))]!
    return { mean: v.reduce((a, b) => a + b, 0) / Math.max(1, v.length), lo: q((1 - level) / 2), hi: q(1 - (1 - level) / 2) }
}

/** The interval of `stat` over resampled units. */
export function bootstrapInterval<T>(units: T[], stat: (sample: T[]) => number, draws: number[][], level = 0.95) {
    return intervalOf(draws.map(d => stat(d.map(i => units[i]!))), level)
}

// ---- the wave-1 hand-set gate, re-implemented over saved features --------------------------------

/** The cutoffs of the hand-set gate the learned one replaced (core/src/memoryRecall.ts at ef71b3c6), kept
 *  here only so the A/B can score it on the same candidates. */
export const WAVE1 = { minCosine: 0.55, backgroundMargin: 0.07, sourceK: 10, reranked: 3, minLogit: -6, maxDrop: 8, chatExtra: 2, docsExtra: 6, fileAdmit: 0.8, fileMargin: 0.05, fileTake: 2 }

/** Which candidates the wave-1 gate injected. `rawCounts` is the number of hits each case's source returned
 *  (a source with fewer than ten hits has no tenth-best, so no relative floor and no background). */
export function wave1Accepted(rows: EvalRow[], rawCounts: Map<string, number>): Set<EvalRow> {
    const W = WAVE1
    const accepted = new Set<EvalRow>()
    const groups = new Map<string, EvalRow[]>()
    for (const r of rows) {
        if (r.features.rerank === null) {
            // the dated-chat path: an in-range chat above the cosine floor
            if (r.features.inRange && r.cosine >= W.minCosine) accepted.add(r)
            continue
        }
        const g = `${r.id}|${r.kind}`
        const list = groups.get(g)
        if (list) list.push(r)
        else groups.set(g, [r])
    }
    for (const [g, list] of groups) {
        list.sort((a, b) => b.cosine - a.cosine)
        const kind = list[0]!.kind
        const full = (rawCounts.get(g) ?? 0) >= W.sourceK
        const background = full ? list[0]!.features.background : 0
        const floor = full && kind !== 'docs' ? Math.max(W.minCosine, background + W.backgroundMargin) : W.minCosine
        if (kind === 'file') for (const r of list.slice(0, W.fileTake)) if (r.cosine >= W.fileAdmit && r.cosine - background >= W.fileMargin) accepted.add(r)
        const cands = list.filter(r => r.cosine >= floor).slice(0, W.reranked)
        if (!cands.length) continue
        const top = Math.max(...cands.map(r => r.features.rerank!))
        const minLogit = W.minLogit + (kind === 'chat' ? W.chatExtra : kind === 'docs' ? W.docsExtra : 0)
        for (const r of cands) if (r.features.rerank! >= minLogit && r.features.rerank! >= top - W.maxDrop) accepted.add(r)
    }
    return accepted
}
