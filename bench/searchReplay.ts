// Search replay: does a change to `bismuth search` (the embedder, the chunk text, the cross-encoder, the
// blend) put the files an agent went and fetched nearer the top? Every prompt of the vault's Claude Code
// session logs that was followed by reading a vault file is a case (bench/recallReplayCases.ts): the query
// is the prompt, the labels are the notes, PDFs and images read before the next prompt.
//   bun bench/searchReplay.ts pools  --vault <dir> [--logs <dir>] --out <dir> [--embed <name>] [--context none|headings|summaries]
//   bun bench/searchReplay.ts rerank --out <dir> --reranker <name>
//   bun bench/searchReplay.ts fit    --dir <dir> [--reranker <name>] --key fusion|docsFusion [--write core/src/sourceGateModel.json]
//   bun bench/searchReplay.ts score  --base <dir> [--base-reranker <name>] [--fixed kw,k,rerank] --variant <dir> [--reranker <name>] [--folds 5] [--draws 2000]
// `pools` builds the vault and chat indexes with that embedder (`EMBED_SPECS` in core/src/embedModel.ts)
// under `<out>/vectors-*`, never the app's cache, and writes `<out>/pools.jsonl`: per case, the meaning and
// keyword lists a search blends (60 deep, chats that started after the prompt dropped) and the excerpts of
// both heads. `rerank` adds `<out>/logits-<name>.jsonl`: the cross-encoder's logit for every head excerpt
// (`RERANK_MODELS` in core/src/rerankWorker.ts) and its time for a 20-passage head. `score` fits the blend
// (keyword weight, k, rerank on or off) on training session folds exactly as bench/fitSourceGate.ts does,
// scores each held-out case's recall@10 and reciprocal rank, and reports the variant minus the base with a
// 95% interval from resampling sessions. The vault and the logs are only read; `--out` holds your prompts
// and an index of your vault, so keep it out of the repo.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Glob } from 'bun'
import { encodeProjectDir } from '../memory/src/sessionHistory'
import { fileKey, parseReplaySession, rankMetrics, type ReplayCase } from './recallReplayCases'
import { bestConfig, fitFusion, foldsBySession, rankPool, type FusionConfig, type PoolRow } from './fitSourceGate'

/** One pooled case: what `fitSourceGate`'s `PoolRow` holds, plus the prompt time and the head excerpts. */
export type SearchPool = Omit<PoolRow, 'logit'> & { id: number; at: string; prompt: string; texts: Record<string, string> }

/** Head of each list the cross-encoder scores: the fit reranks at most the fused top 20, which never
 *  reaches past the 40th of either list. */
export const HEAD = 40

/** Cases whose labels include a file (docs pages are scored by the docs bench, not here). */
export const fileLabels = (c: Pick<ReplayCase, 'labels'>) => c.labels.filter(l => !l.startsWith('docs:'))

/** Drop the chats that had not started when the prompt was sent, and the prompt's own session. */
export function seenBy<T extends { kind: string; session?: string; path: string }>(
    hits: T[],
    c: Pick<ReplayCase, 'session' | 'at'>,
    started: ReadonlyMap<string, number>,
): T[] {
    const at = Date.parse(c.at)
    return hits.filter(h => {
        if (h.kind !== 'chat') return true
        const id = h.session ?? h.path.replace(/^chat /, '')
        const s = started.get(id)
        return id !== c.session && s !== undefined && s < at
    })
}

/** Per-case held-out scores of a pooled set: each session fold is ranked by the blend the other folds
 *  pick. Returns the chosen blend of each fold too. */
export function heldOut(rows: PoolRow[], folds: number, fixed?: FusionConfig): { session: string; hit: number; rr: number }[] {
    const per = new Map<string, number>()
    for (const r of rows) per.set(r.session, (per.get(r.session) ?? 0) + 1)
    const fold = foldsBySession(per, Math.min(folds, per.size))
    const n = Math.max(...fold.values()) + 1
    const out: { session: string; hit: number; rr: number }[] = []
    for (let f = 0; f < n; f++) {
        const tr = rows.filter(r => fold.get(r.session) !== f)
        const cfg: FusionConfig = fixed ?? bestConfig(tr)
        for (const r of rows.filter(r => fold.get(r.session) === f)) {
            const m = rankMetrics(rankPool(r, cfg), r.labels, 10)
            out.push({ session: r.session, hit: m.hit ? 1 : 0, rr: m.rr })
        }
    }
    return out
}

/** Paired difference variant − base of mean hit and rr, with a 95% interval from resampling sessions. */
export function pairedDiff(
    base: { session: string; hit: number; rr: number }[],
    variant: { session: string; hit: number; rr: number }[],
    draws: number,
    seed = 1,
) {
    const bySession = new Map<string, { dh: number; dr: number; n: number }>()
    // the two runs score the same cases; pair them by position within a session
    const key = (xs: typeof base) => {
        const m = new Map<string, typeof base>()
        for (const x of xs) m.set(x.session, [...(m.get(x.session) ?? []), x])
        return m
    }
    const b = key(base)
    const v = key(variant)
    for (const [s, bs] of b) {
        const vs = v.get(s)
        if (!vs || vs.length !== bs.length) continue
        bySession.set(s, {
            dh: vs.reduce((a, x) => a + x.hit, 0) - bs.reduce((a, x) => a + x.hit, 0),
            dr: vs.reduce((a, x) => a + x.rr, 0) - bs.reduce((a, x) => a + x.rr, 0),
            n: bs.length,
        })
    }
    const ss = [...bySession.values()]
    const mean = (xs: typeof ss) => {
        const n = xs.reduce((a, x) => a + x.n, 0) || 1
        return { recall: xs.reduce((a, x) => a + x.dh, 0) / n, mrr: xs.reduce((a, x) => a + x.dr, 0) / n }
    }
    let r = seed >>> 0 || 1
    const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    const rec: number[] = []
    const mrr: number[] = []
    for (let d = 0; d < draws; d++) {
        const pick = ss.map(() => ss[Math.floor(rand() * ss.length)]!)
        const m = mean(pick)
        rec.push(m.recall)
        mrr.push(m.mrr)
    }
    const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]!
    const all = mean(ss)
    return {
        sessions: ss.length,
        cases: ss.reduce((a, x) => a + x.n, 0),
        recall: { diff: all.recall, lo: q(rec, 0.025), hi: q(rec, 0.975) },
        mrr: { diff: all.mrr, lo: q(mrr, 0.025), hi: q(mrr, 0.975) },
    }
}

export const readJsonl = <T,>(path: string): T[] =>
    readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as T)

/** Pools joined with a reranker's logits (absent: no logits, so the fit can only choose rerank off). */
export function withLogits(pools: SearchPool[], logits: { id: number; logit: Record<string, number> }[] | null): PoolRow[] {
    const by = new Map((logits ?? []).map(l => [l.id, l.logit]))
    return pools.map(p => ({ session: p.session, labels: p.labels, meaning: p.meaning, keyword: p.keyword, logit: by.get(p.id) ?? {} }))
}

// ---- the command line -----------------------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
}
const need = (name: string) => {
    const v = flag(name)
    if (!v) {
        console.error(`missing ${name}`)
        process.exit(2)
    }
    return v
}

async function pools() {
    const vault = resolve(need('--vault'))
    const out = resolve(need('--out'))
    // read at import by core's embedder and store: set before anything below loads them
    if (flag('--embed')) process.env.BISMUTH_EMBED_MODEL = flag('--embed')
    const context = flag('--context')
    if (context) {
        if (!['none', 'headings', 'summaries'].includes(context)) throw new Error('--context must be none, headings or summaries')
        process.env.BISMUTH_CHUNK_CONTEXT = context
        // summaries come from `bismuth summary build --vault <vault>`: without them the variant is the base
        const { hasSummaries } = await import('../core/src/noteSummaryStore')
        if (context === 'summaries' && !hasSummaries(vault))
            throw new Error(`no note summaries for ${vault}: run bismuth summary build --vault <vault> first`)
    }
    const logs = flag('--logs') ?? join(homedir(), '.claude', 'projects', encodeProjectDir(vault))
    mkdirSync(out, { recursive: true })
    const files = new Set<string>()
    for (const g of ['**/*.md', '**/*.pdf', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp'])
        for (const f of new Glob(g).scanSync({ cwd: vault, dot: false })) files.add(f)
    const started = new Map<string, number>()
    const cases: ReplayCase[] = []
    for (const name of readdirSync(logs).filter(f => f.endsWith('.jsonl'))) {
        const id = name.slice(0, -'.jsonl'.length)
        const s = parseReplaySession(id, readFileSync(join(logs, name), 'utf8'), vault, files)
        if (s.started) started.set(id, Date.parse(s.started))
        cases.push(...s.cases.filter(c => fileLabels(c).length > 0))
    }
    console.log(`${started.size} sessions, ${cases.length} cases with a file label`)

    const [mem, vaultEmbed, chatEmbed, hybrid] = await Promise.all([
        import('../core/src/memoryEmbed'),
        import('../core/src/vaultEmbed'),
        import('../core/src/chatEmbed'),
        import('../core/src/hybridSearch'),
    ])
    const channel = mem.sharedSemanticChannel()
    vaultEmbed.configureVaultEmbed({ channel, vectorsDir: join(out, 'vectors-vault') })
    chatEmbed.configureChatEmbed({ channel, vectorsDir: join(out, 'vectors-chat') })
    const t0 = Date.now()
    for (;;) {
        const r = await vaultEmbed.vaultSemanticSearch(vault, 'warm up', { build: true, waitMs: 120_000 })
        if (!vaultEmbed.isSemanticUnavailable(r)) break
        console.log(`  vault: ${r.unavailable} ${Math.round((Date.now() - t0) / 1000)}s`)
    }
    for (;;) {
        const r = await chatEmbed.chatSemanticSearch(vault, 'warm up', { channel: 'chat', build: true, waitMs: 120_000 })
        if (Array.isArray(r)) break
        console.log(`  chats: building ${Math.round((Date.now() - t0) / 1000)}s`)
    }
    const buildS = Math.round((Date.now() - t0) / 1000)
    console.log(`indexes ready in ${buildS}s (${mem.STORE_MODEL})`)

    const rows: SearchPool[] = []
    const q0 = Date.now()
    for (const [id, c] of cases.entries()) {
        const p = await hybrid.searchPools(vault, c.prompt, { limit: 60, deny: [], channel: 'chat', waitMs: 60_000 })
        if ('unavailable' in p) {
            console.log(`  case ${id}: ${p.unavailable}`)
            continue
        }
        const idOf = (h: { kind: string; path: string }) => `${h.kind}:${h.path}`
        const scoreKey = (h: { kind: string; path: string }) => (h.kind === 'chat' ? null : fileKey(h.path))
        const meaning = seenBy(p.meaning, c, started)
        const texts: Record<string, string> = {}
        for (const h of [...meaning.slice(0, HEAD), ...p.keyword.slice(0, HEAD)]) texts[idOf(h)] ??= h.excerpt
        rows.push({
            id,
            session: c.session,
            at: c.at,
            prompt: c.prompt,
            labels: fileLabels(c),
            meaning: meaning.map(h => [idOf(h), scoreKey(h)]),
            keyword: p.keyword.map(h => [idOf(h), scoreKey(h)]),
            texts,
        })
    }
    writeFileSync(join(out, 'pools.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    writeFileSync(
        join(out, 'build.json'),
        JSON.stringify({ model: mem.STORE_MODEL, buildSeconds: buildS, cases: rows.length, queryMsMean: Math.round((Date.now() - q0) / Math.max(1, rows.length)) }, null, 2),
    )
    console.log(`wrote ${rows.length} pools to ${out}`)
    process.exit(0)
}

async function rerank() {
    const out = resolve(need('--out'))
    const name = need('--reranker')
    process.env.BISMUTH_RERANK_MODEL = name
    const { sharedReranker, RERANK_MODEL } = await import('../core/src/memoryRerank')
    const rr = sharedReranker()
    if (!rr) throw new Error('reranker cannot run in this build')
    const rows = readJsonl<SearchPool>(join(out, 'pools.jsonl'))
    const path = join(out, `logits-${name}.jsonl`)
    const done = new Set(existsSync(path) ? readJsonl<{ id: number }>(path).map(r => r.id) : [])
    const times: number[] = []
    for (const p of rows) {
        if (done.has(p.id)) continue
        const ids = Object.keys(p.texts)
        // the runtime's call: the fused head of 20, timed alone
        const t = performance.now()
        await rr.rerank(p.prompt, ids.slice(0, 20).map(i => p.texts[i]!))
        times.push(performance.now() - t)
        // in slices of 20, the runtime's call size, so a large model stays inside the worker's run timeout
        const lg: number[] = []
        for (let i = 0; i < ids.length; i += 20) lg.push(...(await rr.rerank(p.prompt, ids.slice(i, i + 20).map(i => p.texts[i]!))))
        appendFileSync(path, JSON.stringify({ id: p.id, logit: Object.fromEntries(ids.map((i, j) => [i, lg[j]!])) }) + '\n')
    }
    times.sort((a, b) => a - b)
    const pct = (q: number) => Math.round(times[Math.floor(q * (times.length - 1))] ?? 0)
    writeFileSync(join(out, `rerank-${name}.json`), JSON.stringify({ model: RERANK_MODEL, head20Ms: { p50: pct(0.5), p90: pct(0.9), max: pct(1) } }, null, 2))
    console.log(`${name} (${RERANK_MODEL}): head of 20 p50 ${pct(0.5)} ms, p90 ${pct(0.9)} ms`)
    process.exit(0)
}

function score() {
    const folds = Number(flag('--folds') ?? 5)
    const draws = Number(flag('--draws') ?? 2000)
    const load = (dir: string, reranker: string | undefined) => {
        const pools = readJsonl<SearchPool>(join(resolve(dir), 'pools.jsonl'))
        const lp = reranker ? join(resolve(dir), `logits-${reranker}.jsonl`) : null
        return withLogits(pools, lp ? readJsonl(lp) : null)
    }
    const base = load(need('--base'), flag('--base-reranker'))
    const variant = load(need('--variant'), flag('--reranker'))
    // `--fixed kw,k,rerank`: the base as it ships, not refit (e.g. docs search's equal weights: 1,60,false)
    const fx = flag('--fixed')?.split(',')
    const fixed = fx ? { keyword: Number(fx[0]), k: Number(fx[1]), rerank: fx[2] === 'true' } : undefined
    const b = heldOut(base, folds, fixed)
    const v = heldOut(variant, folds)
    const mean = (xs: typeof b) => ({ recall: xs.reduce((a, x) => a + x.hit, 0) / xs.length, mrr: xs.reduce((a, x) => a + x.rr, 0) / xs.length })
    const d = pairedDiff(b, v, draws)
    const f = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3)
    console.log(
        JSON.stringify({
            base: mean(b),
            variant: mean(v),
            chosen: { base: fixed ?? bestConfig(base), variant: bestConfig(variant) },
            diff: d,
        }),
    )
    console.log(
        `recall@10 ${mean(b).recall.toFixed(3)} → ${mean(v).recall.toFixed(3)} (${f(d.recall.diff)}, ${f(d.recall.lo)} to ${f(d.recall.hi)})  ` +
            `MRR ${mean(b).mrr.toFixed(3)} → ${mean(v).mrr.toFixed(3)} (${f(d.mrr.diff)}, ${f(d.mrr.lo)} to ${f(d.mrr.hi)})  ${d.cases} cases / ${d.sessions} sessions`,
    )
}

/** Fit the blend on every pooled case of a variant and, with `--write`, commit it under `--key`. */
function fit() {
    const dir = resolve(need('--dir'))
    const key = need('--key')
    if (key !== 'fusion' && key !== 'docsFusion') throw new Error('--key is fusion or docsFusion')
    const name = flag('--reranker')
    const rows = withLogits(readJsonl<SearchPool>(join(dir, 'pools.jsonl')), name ? readJsonl(join(dir, `logits-${name}.jsonl`)) : null)
    const { model, report } = fitFusion(rows, Number(flag('--folds') ?? 5))
    console.log(JSON.stringify(report, null, 2))
    const target = flag('--write')
    if (target) {
        const file = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>
        if (key === 'docsFusion')
            model.fitOn.objective =
                'recall@10 of the labelled docs pages (real docs searches and reads, and Haiku-written questions, from bench/docsSearchReplay.ts) on held-out folds by page or session; the grid point with the best training-fold recall@10 is scored on its held-out fold'
        file[key] = model
        writeFileSync(target, JSON.stringify(file, null, 2) + '\n')
        console.log(`wrote ${key} to ${target}`)
    }
}

if (import.meta.main) {
    const mode = argv[0]
    if (mode === 'pools') await pools()
    else if (mode === 'rerank') await rerank()
    else if (mode === 'score') score()
    else if (mode === 'fit') fit()
    else {
        console.error('usage: bun bench/searchReplay.ts pools|rerank|fit|score …')
        process.exit(2)
    }
}
