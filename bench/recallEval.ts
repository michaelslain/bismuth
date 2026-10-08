// Recall eval: run labelled cases against a memory dir and compare rankers on what the agent
// would actually receive (rank + pack, scored on the injected note names).
//   bun bench/recallEval.ts --dir <memoryDir> --cases <file> [--semantic <module>] [--reranker <module>] [--sweep] [--json]
// cases.json: [{ prompt, context?, expect: string[] }] or [{ tool: [{tool_name, tool_input,
// tool_response?}], expect }]. `expect: []` means nothing should inject.
// --semantic <module>: the module exports createEmbedder(opts) returning
// { embed(texts: string[]): Promise<Float32Array[]>; dispose(): void }; enables the `hybrid` ranker,
// which mirrors production: chunked note vectors (max-sim), the query prefix, a top-SCORES_KEPT map.
// --reranker <module> (needs --semantic): default export createReranker({ cacheDir }) returning
// { rerank(query, passages): Promise<number[]>; dispose(): void }; enables the `rerank` ranker
// (hybrid, then the top RERANK_CANDIDATES reranked and gated; the query is `rerankQuery`, as in production). --sweep then also sweeps minLogit.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isMemoryNoteVisibleToDaemon, loadAllNotes } from '../memory/src/graph'
import type { MemoryNote } from '../memory/src/graph'
import { PACK_LIMITS, excerptText, packRecall, rankOptions } from '../memory/src/pack'
import { RERANK_CANDIDATES, RERANK_MAX_DROP, RERANK_MIN_LOGIT, gateByRerank, rerankQuery } from '../memory/src/rerankGate'
import { bismuthHome } from '../core/src/bismuthHome'
import { buildRecallIndex, rankNotes } from '../memory/src/rank'
import type { RecallIndex } from '../memory/src/rank'
import { semanticQueryText, toolQuery } from '../memory/src/queryContext'
import { capToolCalls } from '../relay/lib/recall'

export type ToolCall = { tool_name: string; tool_input: unknown; tool_response?: unknown }
export type EvalCase = {
    prompt?: string
    context?: string
    /** `subagent`: a prompt-shaped case packed with the subagent limits. */
    mode?: 'subagent'
    tool?: ToolCall[]
    /** A tool case with a full-size payload (absolute path, a real response body), reported on its
     *  own as well as inside the tool group. */
    realistic?: boolean
    expect: string[]
}
export type RankerName = 'legacy' | 'bm25' | 'hybrid' | 'rerank'
export type Reranker = { rerank(query: string, passages: string[]): Promise<number[]>; dispose(): void }
export type Embedder = { embed(texts: string[]): Promise<Float32Array[]>; dispose(): void }

// ---- legacy: the pre-plan searchMemory (memory/src/search.ts at c24b517a), copied verbatim -------
const MAX_CONTEXT_BYTES = 4096
const TYPE_BOOST: Record<string, number> = {
    preference: 1.4,
    workflow: 1.2,
    project: 1.1,
    fact: 1.0,
    person: 1.0,
    daily: 0.5,
    auto: 0.3,
}
const LEGACY_MIN_SCORE = 1.0

// the pre-plan searchMemory stop list, pasted verbatim (git c24b517a:memory/src/search.ts)
const LEGACY_STOP_WORDS = new Set([
    'the',
    'is',
    'a',
    'an',
    'it',
    'to',
    'for',
    'of',
    'in',
    'on',
    'and',
    'or',
    'but',
    'with',
    'that',
    'this',
    'from',
    'what',
    'how',
    'why',
    'when',
    'where',
    'who',
    'can',
    'do',
    'does',
    'did',
    'will',
    'would',
    'should',
    'could',
    'have',
    'has',
    'had',
    'be',
    'been',
    'was',
    'were',
    'are',
    'am',
    'not',
    'no',
    'my',
    'your',
    'i',
    'me',
    'we',
    'you',
    'he',
    'she',
    'they',
    'them',
    'its',
    'their',
    'our',
    'just',
    'also',
    'about',
    'up',
    'out',
    'so',
    'if',
    'at',
    'by',
    'let',
    'all',
    'any',
    'some',
    'very',
    'too',
    'more',
    'than',
    'then',
    'into',
    'over',
    'such',
    'after',
    'before',
    'between',
    'each',
    'few',
    'both',
    'other',
    'own',
    'same',
    'here',
    'there',
    'now',
    'only',
    'even',
    'still',
    'already',
    'well',
    'much',
    'many',
    'most',
    'often',
    'never',
    'always',
    'yet',
])

function legacyKeywords(text: string): string[] {
    const tokens = text
        .toLowerCase()
        .split(/[\s\-_\/\\,.:;!?'"()\[\]{}<>|@#$%^&*+=~`]+/)
        .filter(t => t.length >= 3 && !LEGACY_STOP_WORDS.has(t))
    return [...new Set(tokens)]
}

function legacyScore(note: MemoryNote, keywords: string[]): number {
    if (keywords.length === 0) return 0
    const nameLower = note.name.toLowerCase()
    const tagsLower = note.frontmatter.tags.map(t => t.toLowerCase())
    const bodyLower = note.content.toLowerCase()
    const bodyWords = bodyLower.split(/\W+/).filter(w => w.length >= 3)
    const nameWords = nameLower.split(/\W+/).filter(w => w.length >= 3)
    let score = 0
    let matchedKeywords = 0
    for (const kw of keywords) {
        let kwScore = 0
        if (nameLower.includes(kw)) kwScore += 3
        else if (nameWords.some(w => kw.startsWith(w) && w.length >= 4)) kwScore += 1.5
        if (tagsLower.some(t => t === kw)) kwScore += 3
        else if (tagsLower.some(t => kw.startsWith(t) && t.length >= 4)) kwScore += 1.5
        if (bodyLower.includes(kw)) kwScore += 1
        else if (bodyWords.some(w => kw.startsWith(w) && w.length >= 4)) kwScore += 0.5
        if (kwScore > 0) {
            matchedKeywords++
            score += kwScore
        }
    }
    if (matchedKeywords === 0) return 0
    score *= 1 + matchedKeywords / keywords.length
    score *= TYPE_BOOST[note.frontmatter.type.toLowerCase()] ?? 1.0
    return score
}

/** Returns what the old hook injected: notes in score order, cut by the 4096-byte budget loop.
 *  `chars` is that loop's own size estimate (name + body + tags + 50 per note). */
export function legacySearch(notes: MemoryNote[], prompt: string, maxResults = 10) {
    const keywords = legacyKeywords(prompt)
    if (keywords.length === 0) return { names: [] as string[], chars: 0 }
    const scored: { note: MemoryNote; score: number }[] = []
    for (const note of notes) {
        const score = legacyScore(note, keywords)
        if (score >= LEGACY_MIN_SCORE) scored.push({ note, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const names: string[] = []
    let totalBytes = 0
    for (const { note } of scored) {
        if (names.length >= maxResults) break
        const noteSize =
            note.name.length + note.content.length + note.frontmatter.tags.join(' ').length + 50
        if (totalBytes + noteSize > MAX_CONTEXT_BYTES && names.length > 0) break
        names.push(note.name)
        totalBytes += noteSize
    }
    return { names, chars: totalBytes }
}

// ---- eval ----------------------------------------------------------------------------------------
export type CaseRun = { injected: string[]; chars: number; ms: number }

export type Summary = {
    ranker: string
    cases: number
    recall3: number
    recall5: number
    mrr: number
    /** share of expect-nothing cases that injected anything */
    falseInject: number
    meanChars: number
    p50ms: number
    p95ms: number
}

export type Prepared = {
    notes: MemoryNote[]
    index: RecallIndex
    embedder?: Embedder
    /** One vector per chunk of each note, parallel to `notes`. */
    noteVecs?: Float32Array[][]
    queryPrefix?: string
    scoresKept?: number
    reranker?: Reranker
    /** `gateByRerank`'s minLogit for the `rerank` ranker; undefined = the production default. */
    rerankMinLogit?: number
    /** `gateByRerank`'s maxDrop for the `rerank` ranker; undefined = the production default. */
    rerankMaxDrop?: number
    /** logits by query + candidate names, so a threshold sweep scores the model once. */
    rerankCache?: Map<string, number[]>
}

const noteText = (n: MemoryNote) =>
    `${n.name}\n${n.frontmatter.description ?? ''}\n${n.frontmatter.tags.join(' ')}\n${n.content.slice(0, 1500)}`

export async function prepare(dir: string, embedder?: Embedder, reranker?: Reranker): Promise<Prepared> {
    const notes = (await loadAllNotes(dir)).filter(isMemoryNoteVisibleToDaemon)
    const prepared: Prepared = { notes, index: buildRecallIndex(notes) }
    if (embedder) {
        // dynamic: the bm25-only unit suite never loads the embedding module
        const mod: Record<string, any> = await import('../core/src/memoryEmbed')
        prepared.embedder = embedder
        prepared.queryPrefix = mod.QUERY_PREFIX
        prepared.scoresKept = mod.SCORES_KEPT
        let chunks: string[][]
        if (typeof mod.noteChunks === 'function') chunks = notes.map(n => mod.noteChunks(n) as string[])
        else {
            console.error('recallEval: memoryEmbed has no noteChunks, falling back to one chunk per note')
            chunks = notes.map(n => [noteText(n)])
        }
        const flat = chunks.flat()
        const vecs: Float32Array[] = []
        for (let i = 0; i < flat.length; i += 64) vecs.push(...(await embedder.embed(flat.slice(i, i + 64))))
        let at = 0
        prepared.noteVecs = chunks.map(c => vecs.slice(at, (at += c.length)))
    }
    if (reranker) {
        prepared.reranker = reranker
        prepared.rerankCache = new Map()
    }
    return prepared
}

function cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0
    let na = 0
    let nb = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!
        na += a[i]! * a[i]!
        nb += b[i]! * b[i]!
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0
}

function queryOf(c: EvalCase): {
    primary: string
    context?: string
    location?: string
    mode: 'prompt' | 'tool' | 'subagent'
} {
    // A tool case goes through the relay's own capping first (objects stringified, 2000 chars), so
    // the ranker sees what core receives from the hook.
    if (c.tool) return { ...toolQuery(capToolCalls(c.tool)), mode: 'tool' }
    return { primary: c.prompt ?? '', ...(c.context ? { context: c.context } : {}), mode: c.mode ?? 'prompt' }
}

export async function runCase(p: Prepared, ranker: RankerName, c: EvalCase): Promise<CaseRun> {
    const q = queryOf(c)
    const t0 = performance.now()
    if (ranker === 'legacy') {
        const r = legacySearch(p.notes, q.mode === 'tool' ? `${q.primary}\n${q.context ?? ''}` : q.primary)
        return { injected: r.names, chars: r.chars, ms: performance.now() - t0 }
    }
    let semantic: Map<string, number> | undefined
    if (ranker === 'hybrid' || ranker === 'rerank') {
        if (!p.embedder || !p.noteVecs) throw new Error(`${ranker} needs --semantic`)
        const [qv] = await p.embedder.embed([`${p.queryPrefix ?? ''}${semanticQueryText(q)}`])
        // max-sim over each note's chunks, then only the top scores are kept (as production does)
        const scored = p.notes.map((n, i) => [n.name, Math.max(0, ...p.noteVecs![i]!.map(v => cosine(qv!, v)))] as const)
        scored.sort((a, b) => b[1] - a[1])
        semantic = new Map(scored.slice(0, p.scoresKept ?? scored.length))
    }
    const ranked = rankNotes(p.index, q, rankOptions(q.mode, semantic))
    if (ranker === 'rerank') {
        if (!p.reranker) throw new Error('rerank needs --reranker')
        const candidates = ranked
            .filter(r => r.score >= (PACK_LIMITS[q.mode].semanticMinScore ?? PACK_LIMITS[q.mode].minScore))
            .slice(0, RERANK_CANDIDATES)
        let gated = candidates
        if (candidates.length > 0) {
            const rq = rerankQuery(q)
            const key = `${q.mode}\n${rq}\n${candidates.map(r => r.note.name).join('|')}`
            let logits = p.rerankCache?.get(key)
            if (!logits) {
                const passages = candidates.map(r => excerptText(r, PACK_LIMITS[q.mode].perNoteChars))
                logits = await p.reranker.rerank(rq, passages)
                p.rerankCache?.set(key, logits)
            }
            gated = gateByRerank(
                candidates,
                logits,
                {
                    ...(p.rerankMinLogit === undefined ? {} : { minLogit: p.rerankMinLogit }),
                    ...(p.rerankMaxDrop === undefined ? {} : { maxDrop: p.rerankMaxDrop }),
                },
            )
        }
        const out = packRecall(gated, q.mode, undefined, { semantic: false })
        return {
            injected: out.injected.map(i => i.name),
            chars: out.text?.length ?? 0,
            ms: performance.now() - t0,
        }
    }
    const packed = packRecall(ranked, q.mode, undefined, { semantic: !!semantic })
    return {
        injected: packed.injected.map(i => i.name),
        chars: packed.text?.length ?? 0,
        ms: performance.now() - t0,
    }
}

function pct(sorted: number[], q: number): number {
    if (sorted.length === 0) return 0
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}

export function summarize(ranker: string, cases: EvalCase[], runs: CaseRun[]): Summary {
    const positives = cases.map((c, i) => ({ c, r: runs[i]! })).filter(x => x.c.expect.length > 0)
    const negatives = cases.map((c, i) => ({ c, r: runs[i]! })).filter(x => x.c.expect.length === 0)
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    const recallAt = (k: number) =>
        mean(
            positives.map(
                ({ c, r }) => c.expect.filter(n => r.injected.slice(0, k).includes(n)).length / c.expect.length,
            ),
        )
    const mrr = mean(
        positives.map(({ c, r }) => {
            const first = r.injected.findIndex(n => c.expect.includes(n))
            return first < 0 ? 0 : 1 / (first + 1)
        }),
    )
    const ms = runs.map(r => r.ms).sort((a, b) => a - b)
    return {
        ranker,
        cases: cases.length,
        recall3: recallAt(3),
        recall5: recallAt(5),
        mrr,
        falseInject: negatives.length ? negatives.filter(x => x.r.injected.length > 0).length / negatives.length : 0,
        meanChars: mean(runs.map(r => r.chars)),
        p50ms: pct(ms, 0.5),
        p95ms: pct(ms, 0.95),
    }
}

export async function evaluate(p: Prepared, ranker: RankerName, cases: EvalCase[]) {
    const runs: CaseRun[] = []
    for (const c of cases) runs.push(await runCase(p, ranker, c))
    return { summary: summarize(ranker, cases, runs), runs }
}

export function loadCases(file: string): EvalCase[] {
    return JSON.parse(readFileSync(file, 'utf8')) as EvalCase[]
}

export const isToolCase = (c: EvalCase) => !!c.tool
export const isSubagentCase = (c: EvalCase) => c.mode === 'subagent'

function table(rows: Summary[]): string {
    const f = (n: number) => n.toFixed(3)
    const head = 'ranker   cases  recall@3  recall@5  mrr    falseInj  meanChars  p50ms  p95ms'
    const lines = rows.map(
        s =>
            `${s.ranker.padEnd(8)} ${String(s.cases).padEnd(6)} ${f(s.recall3).padEnd(9)} ${f(s.recall5).padEnd(9)} ${f(s.mrr).padEnd(6)} ${f(s.falseInject).padEnd(9)} ${String(Math.round(s.meanChars)).padEnd(10)} ${s.p50ms.toFixed(2).padEnd(6)} ${s.p95ms.toFixed(2)}`,
    )
    return [head, ...lines].join('\n')
}

async function main() {
    const argv = process.argv.slice(2)
    const arg = (name: string) => {
        const i = argv.indexOf(`--${name}`)
        return i >= 0 ? argv[i + 1] : undefined
    }
    const dir = arg('dir')
    const casesFile = arg('cases')
    if (!dir || !casesFile) {
        console.error('usage: bun bench/recallEval.ts --dir <memoryDir> --cases <file> [--semantic <module>] [--reranker <module>] [--sweep] [--json]')
        process.exit(2)
    }
    let embedder: Embedder | undefined
    const semanticModule = arg('semantic')
    if (semanticModule) {
        const mod = await import(resolve(semanticModule))
        const factory = mod.createEmbedder ?? mod.default
        embedder = await factory({ cacheDir: bismuthHome('models') })
    }
    let reranker: Reranker | undefined
    const rerankerModule = arg('reranker')
    if (rerankerModule) {
        if (!embedder) {
            console.error('--reranker needs --semantic (the rerank ranker reranks the hybrid candidates)')
            process.exit(2)
        }
        const mod = await import(resolve(rerankerModule))
        reranker = await (mod.createReranker ?? mod.default)({ cacheDir: bismuthHome('models') })
    }
    const p = await prepare(resolve(dir), embedder, reranker)
    const all = loadCases(resolve(casesFile))
    const promptCases = all.filter(c => !isToolCase(c) && !isSubagentCase(c))
    const subagentCases = all.filter(isSubagentCase)
    const toolCases = all.filter(isToolCase)
    const rankers: RankerName[] = ['legacy', 'bm25', ...(embedder ? (['hybrid'] as const) : []), ...(reranker ? (['rerank'] as const) : [])]

    const groups: { name: string; cases: EvalCase[]; rankers: RankerName[] }[] = [
        { name: 'prompt mode', cases: promptCases, rankers },
        { name: 'tool mode (legacy fed the same query string)', cases: toolCases, rankers },
        { name: 'tool mode, realistic payloads only', cases: toolCases.filter(c => c.realistic), rankers },
        { name: 'subagent mode', cases: subagentCases, rankers },
    ]
    const result: Record<string, Summary[]> = {}
    const out: string[] = [`notes: ${p.notes.length}  cases: ${all.length}`]
    for (const g of groups) {
        if (g.cases.length === 0) continue
        const rows: Summary[] = []
        for (const r of g.rankers) rows.push((await evaluate(p, r, g.cases)).summary)
        result[g.name] = rows
        out.push('', `== ${g.name} (${g.cases.length} cases)`, table(rows))
    }

    if (argv.includes('--sweep')) {
        const sweep: Record<string, Summary[]> = {}
        for (const [mode, cases] of [['prompt', promptCases], ['tool', toolCases], ['subagent', subagentCases]] as const) {
            if (cases.length === 0) continue
            const orig = PACK_LIMITS[mode].minScore
            const rows: Summary[] = []
            for (const m of [0.5, 1.5, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8]) {
                PACK_LIMITS[mode].minScore = m
                const s = (await evaluate(p, embedder ? 'hybrid' : 'bm25', cases)).summary
                rows.push({ ...s, ranker: `min${m}` })
            }
            PACK_LIMITS[mode].minScore = orig
            sweep[mode] = rows
            out.push('', `== minScore sweep, ${mode} mode (${embedder ? 'hybrid' : 'bm25'})`, table(rows))
        }
        result.sweep = Object.values(sweep).flat()
    }

    if (argv.includes('--sweep') && reranker) {
        const sweep: Summary[] = []
        for (const [mode, cases] of [['prompt', promptCases], ['subagent', subagentCases]] as const) {
            if (cases.length === 0) continue
            const rows: Summary[] = []
            for (let m = -10; m <= 4; m += 0.25) {
                p.rerankMinLogit = m
                const s = (await evaluate(p, 'rerank', cases)).summary
                rows.push({ ...s, ranker: `lg${m}` })
            }
            p.rerankMinLogit = undefined
            sweep.push(...rows)
            const drops: Summary[] = []
            for (const d of [3, 4, 6, 8, 12, 100]) {
                p.rerankMaxDrop = d
                const s = (await evaluate(p, 'rerank', cases)).summary
                drops.push({ ...s, ranker: `drop${d}` })
            }
            p.rerankMaxDrop = undefined
            out.push('', `== RERANK_MAX_DROP sweep at the default minLogit, ${mode} mode`, table(drops))
            out.push(
                '',
                `== RERANK_MIN_LOGIT sweep, ${mode} mode (production default ${RERANK_MIN_LOGIT}, maxDrop ${RERANK_MAX_DROP})`,
                table(rows),
            )
        }
        result.rerankSweep = sweep
    }

    if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
    else console.log(out.join('\n'))
    embedder?.dispose()
    reranker?.dispose()
}

if (import.meta.main) await main()
