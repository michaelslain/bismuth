// Recall replay: does recall hand an agent, up front, what it went and fetched itself?
//   bun bench/recallReplay.ts --vault <dir> [--logs <claude project dir>] [--out <dir>] [--negatives n] [--judge [--judge-prompt <id>]] [--search] [--concurrency n] [--dry]
// Beside `cases.jsonl` and `summary.json` it writes `candidates.jsonl` (one line per candidate the source
// gate scored: its features, whether a fetched label matched it, the judge's verdict) and, with
// `--search`, `search-pools.jsonl` (the two result lists a search blends); `bench/fitSourceGate.ts`
// fits the gate and the blend from them.
// Every prompt in the vault's Claude Code session logs becomes a case (bench/recallReplayCases.ts).
// A case's labels are the docs pages, notes, PDFs and images the agent fetched before the next prompt;
// a prompt that refers to an earlier chat ("yesterday") is a past-chat case; a prompt after which the
// agent used no tool at all is a quiet case. Each case runs through `createRecallService` with the real
// embedder, reranker and sources (`sourcesFor`, so visibility and the chat gate apply), and the result
// is scored: did an injected source key match a label (hit), was a label among the sources' raw top 10
// (retrieved), and how often quiet cases got any source. Chats that started after a case's prompt are
// dropped from its sources, so no case is answered by its own future.
// The vault and the logs are only read. Indexes are built into `<out>/vectors-*`, never the app's
// cache. `--out` (default: a temp dir) receives `cases.jsonl` (one line per case, with the prompt) and
// `summary.json`; it holds your own prompts, so keep it out of the repo.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, homedir, tmpdir, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { Glob } from 'bun'
import { encodeProjectDir } from '../memory/src/sessionHistory'
import type { GateFeatures, GateTraceRow } from '../core/src/sourceGate'
import {
    SECTIONS,
    capPerSection,
    fileKey,
    inRanges,
    judgePoolSize,
    junkStats,
    keyMatches,
    parseReplaySession,
    precisionOf,
    searchScore,
    sectionOf,
    type ReplayCase,
    type Section,
    type Verdict,
} from './recallReplayCases'
import { DEFAULT_JUDGE_PROMPT, JUDGE_PROMPTS, judgeJobs } from './recallJudge'

const argv = process.argv.slice(2)
const flag = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
}
const vaultArg = flag('--vault')
if (!vaultArg) {
    console.error('usage: bun bench/recallReplay.ts --vault <dir> [--logs <dir>] [--out <dir>] [--negatives n] [--dry]')
    process.exit(2)
}
const vault = resolve(vaultArg)
const logs = flag('--logs') ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects', encodeProjectDir(vault))
const out = flag('--out') ?? mkdtempSync(join(tmpdir(), 'recall-replay-'))
const negativesMax = Number(flag('--negatives') ?? 80)
const dry = argv.includes('--dry')
const judge = argv.includes('--judge')
const searchEval = argv.includes('--search')
const concurrencyArg = flag('--concurrency')
mkdirSync(out, { recursive: true })

const files = new Set<string>()
for (const g of ['**/*.md', '**/*.pdf', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp'])
    for (const f of new Glob(g).scanSync({ cwd: vault, dot: false })) files.add(f)

const started = new Map<string, number>()
const logLines = new Map<string, string[]>()
const all: ReplayCase[] = []
for (const name of readdirSync(logs).filter(f => f.endsWith('.jsonl'))) {
    const id = name.slice(0, -'.jsonl'.length)
    const text = readFileSync(join(logs, name), 'utf8')
    const s = parseReplaySession(id, text, vault, files)
    if (s.started) started.set(id, Date.parse(s.started))
    if (s.cases.length) logLines.set(id, text.split('\n'))
    all.push(...s.cases)
}

const labelled = all.filter(c => c.labels.length > 0)
const past = all.filter(c => c.refersToPast && c.labels.length === 0)
const quietAll = all.filter(c => !c.usedTools && !c.refersToPast && c.prompt.length >= 12)
const step = Math.max(1, Math.floor(quietAll.length / Math.max(1, negativesMax)))
const quiet = quietAll.filter((_, i) => i % step === 0).slice(0, negativesMax)
const time = all.filter(c => c.timeRanges.length > 0 && c.labels.length === 0)
const kindsOf = (c: ReplayCase) => [...new Set(c.labels.map(l => l.slice(0, l.indexOf(':'))))]
const byKind: Record<string, number> = {}
for (const c of labelled) for (const k of kindsOf(c)) byKind[k] = (byKind[k] ?? 0) + 1

console.log(`sessions ${started.size}  prompts ${all.length}  labelled ${labelled.length} ${JSON.stringify(byKind)}  past ${past.length}  time ${time.length}  quiet ${quiet.length} of ${quietAll.length}`)
if (dry) process.exit(0)

const [mem, recall, vaultEmbed, chatEmbed, docsEmbed, rerank, memLib] = await Promise.all([
    import('../core/src/memoryEmbed'),
    import('../core/src/memoryRecall'),
    import('../core/src/vaultEmbed'),
    import('../core/src/chatEmbed'),
    import('../core/src/docsEmbed'),
    import('../core/src/memoryRerank'),
    import('../memory/src/index'),
])
const [searchMod, hybridMod] = await Promise.all([import('../core/src/search'), import('../core/src/hybridSearch')])
const channel = mem.sharedSemanticChannel()
vaultEmbed.configureVaultEmbed({ channel, vectorsDir: join(out, 'vectors-vault') })
chatEmbed.configureChatEmbed({ channel, vectorsDir: join(out, 'vectors-chat') })
docsEmbed.configureDocsEmbed({ channel, vectorsDir: join(out, 'vectors-docs'), docsRoot: process.env.BISMUTH_DOCS_DIR ?? join(import.meta.dir, '..', 'docs') })

const t0 = Date.now()
const until = async (what: string, f: () => Promise<boolean>) => {
    for (;;) {
        if (await f()) return
        console.log(`  building ${what}… ${Math.round((Date.now() - t0) / 1000)}s`)
    }
}
console.log('building indexes (first run embeds the whole vault, its chats and the docs)')
await until('vault', async () => {
    const r = await vaultEmbed.vaultSemanticSearch(vault, 'warm up', { build: true, waitMs: 120_000 })
    return !vaultEmbed.isSemanticUnavailable(r)
})
await until('chats', async () => {
    const r = await chatEmbed.chatSemanticSearch(vault, 'warm up', { channel: 'chat', build: true, waitMs: 120_000 })
    return Array.isArray(r)
})
docsEmbed.syncDocsEmbeddings()
await until('docs', () => docsEmbed.docsIndexReady())
console.log(`indexes ready in ${Math.round((Date.now() - t0) / 1000)}s`)

let prompt: ReplayCase | null = null
const notFuture = (h: { kind: string; id: string }) => {
    if (h.kind !== 'chat' || !prompt) return true
    const s = started.get(h.id)
    return s !== undefined && s < Date.parse(prompt.at)
}
/** Every source hit the recall service saw for the current case, by key, for the judge to read. */
const seen = new Map<string, string>()
const sources = async (q: Parameters<typeof recall.sourcesFor>[1]) => {
    // ask for every hit, drop the future chats, then cap each section at k: capping first would leave the background a higher score than the true 10th best
    const hits = capPerSection((await recall.sourcesFor(vault, { ...q, k: 100_000 })).filter(notFuture), q.k)
    for (const h of hits) seen.set(`${h.kind}:${h.id}`, recall.sourcePassage(h))
    return hits
}
const localDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA')
const digestOf = (context: string | null): string | null => {
    const at = context?.indexOf('# What happened') ?? -1
    if (!context || at < 0) return null
    const rest = context.slice(at)
    const end = rest.slice(1).search(/\n# |\n<\/[a-z-]+>/)
    return (end < 0 ? rest : rest.slice(0, end + 1)).trim()
}
type Search = { keyword: string[]; semantic: string[]; hybrid: string[] | null; hybridMode?: string }
let traceBuf: GateTraceRow[] = []
const svc = recall.createRecallService({
    gateTrace: rows => traceBuf.push(...rows),
    memoryDir: () => join(vault, '.daemon', 'memory'),
    settings: () => ({ enabled: true, midTurn: false, semantic: true }),
    embedder: () => channel.embedder(),
    semanticScores: (e, q, n, d) => channel.semanticScores(e, q, n, d),
    reranker: () => rerank.sharedReranker(),
    sources,
    timeChats: q => sources({ ...q, switches: { files: false, chats: true, docs: false } }),
    now: () => (prompt ? Date.parse(prompt.at) : Date.now()),
    vault,
})
// A model child can time out under load and is respawned on the next call: retry a case's direct
// model calls a few times instead of losing the whole run to one slow embed.
const withRetry = async <T,>(what: string, f: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
        try {
            return await f()
        } catch (e) {
            if (attempt >= 4) throw e
            console.error(`  ${what} failed (${(e as Error).message}), retry ${attempt}`)
            await Bun.sleep(2000 * attempt)
        }
    }
}
const txDir = join(out, 'transcripts')
mkdirSync(txDir, { recursive: true })
const parseLines = (lines: string[]) =>
    lines.flatMap(l => {
        try {
            return l ? [JSON.parse(l)] : []
        } catch {
            return []
        }
    })
type Cand = { key: string; section: 'files' | 'chats' | 'docs'; score: number; logit: number }

type Row = {
    set: 'labelled' | 'past' | 'time' | 'quiet'
    session: string
    at: string
    prompt: string
    labels: string[]
    injected: string[]
    retrieved: string[]
    /** Every raw candidate with its cosine and reranker logit, for an offline gate sweep. */
    cands: Cand[]
    hit: boolean
    labelRetrieved: boolean
    pastChat: boolean
    /** Date ranges the prompt's time words named. */
    ranges: { start: string; end: string; label: string }[]
    /** A digest block (`# What happened ...`) was injected. */
    digest: boolean
    /** An injected chat's session date fell inside a named range. */
    chatInRange: boolean
    /** Every injected item and the text the judge reads: sources by key, the digest block as `digest`. */
    items: { key: string; text: string }[]
    /** The transcript context recall ranked on, the tail the judge reads beside the prompt. */
    context: string
    verdicts: Record<string, Verdict | 'error'>
    search?: Search
    /** Every candidate the gate scored with the text the judge reads (candidates.jsonl holds the rest). */
    candItems: { key: string; text: string }[]
}
type PoolRow = { session: string; labels: string[]; meaning: [string, string | null][]; keyword: [string, string | null][]; logit: Record<string, number> }
type CandRow = { id: number; set: Row['set']; session: string; key: string; path: 'ordinary' | 'time'; features: GateFeatures; probability: number; accepted: boolean; matched: boolean }
const pools: PoolRow[] = []
const candRows: (CandRow & { verdict?: Verdict | 'error' })[] = []
const rows: Row[] = []
const sets: [Row['set'], ReplayCase[]][] = [['labelled', labelled], ['past', past], ['time', time], ['quiet', quiet]]
let n = 0
const total = labelled.length + past.length + time.length + quiet.length
for (const [set, cases] of sets)
    for (const c of cases) {
        prompt = c
        n++
        // the transcript recall saw: every line before the prompt (the hook fires before it is written)
        const before = (logLines.get(c.session) ?? []).slice(0, c.line)
        const transcriptPath = join(txDir, `${n}.jsonl`)
        writeFileSync(transcriptPath, before.join('\n') + '\n')
        const entries = parseLines(before.slice(-400))
        const context = entries.length ? memLib.contextFromTranscript(entries) : ''
        const queryText = memLib.semanticQueryText({ primary: c.prompt, context })
        const rerankText = memLib.rerankQuery({ primary: c.prompt, context })
        const vec = (await withRetry('embed', () => channel.embedder()!.embed([mem.QUERY_PREFIX + queryText])))[0]!
        const raw = await sources({ vec, k: 10, channel: 'chat', excludeSessionId: c.session, switches: { files: true, chats: true, docs: true } })
        const retrieved = raw.map(h => `${h.kind}:${h.id}`)
        const logits = raw.length
            ? await withRetry('rerank', () => rerank.sharedReranker()!.rerank(rerankText, raw.map(recall.sourcePassage)))
            : []
        const cands: Cand[] = raw.map((h, i) => ({
            key: `${h.kind}:${h.id}`,
            section: h.kind === 'chat' ? 'chats' : h.kind === 'docs' ? 'docs' : 'files',
            score: h.score,
            logit: logits[i] ?? -99,
        }))
        seen.clear()
        traceBuf = []
        const r = await svc.recall({ mode: 'prompt', sessionId: c.session, agentId: `replay-${n}`, prompt: c.prompt, transcriptPath, channel: 'chat' })
        const injected = r.sources ?? []
        const digest = digestOf(r.context)
        const items = [
            ...injected.map(key => ({ key, text: seen.get(key) ?? '' })),
            ...(digest ? [{ key: 'digest', text: digest }] : []),
        ]
        const candSeen = new Set<string>()
        const candItems: { key: string; text: string }[] = []
        for (const t of traceBuf) {
            candRows.push({ id: n, set, session: c.session, key: t.key, path: t.path, features: t.features, probability: t.probability, accepted: t.accepted, matched: c.labels.some(l => keyMatches(l, t.key)) })
            if (!candSeen.has(t.key)) {
                candSeen.add(t.key)
                candItems.push({ key: t.key, text: seen.get(t.key) ?? '' })
            }
        }
        let search: Search | undefined
        if (searchEval && c.labels.some(l => !l.startsWith('docs:'))) {
            const keyed = (kind: string, path: string) => (kind === 'chat' ? `chat:${path}` : fileKey(path))
            const kw = await searchMod.rankCandidates(vault, c.prompt, 10).catch(() => [])
            const pv = (await withRetry('embed', () => channel.embedder()!.embed([mem.QUERY_PREFIX + c.prompt])))[0]!
            const sem = await sources({ vec: pv, k: 10, channel: 'chat', excludeSessionId: c.session, switches: { files: true, chats: false, docs: false } })
            search = {
                keyword: kw.map(h => fileKey(h.path)).filter((k): k is string => !!k),
                semantic: sem.map(h => `${h.kind}:${h.id}`),
                hybrid: null,
            }
            try {
                // the two pools the blend fuses, and the cross-encoder's logit for each pool's head, so the fit
                // can try any weights, k and reranking offline
                const pl = await hybridMod.searchPools(vault, c.prompt, { limit: 60, deny: [], channel: 'chat' })
                if (!('unavailable' in pl)) {
                    const idOf = (h: { kind: string; path: string }) => `${h.kind}:${h.path}`
                    const scoreKey = (h: { kind: string; path: string }) => (h.kind === 'chat' ? null : fileKey(h.path))
                    const head = new Map<string, string>()
                    for (const h of [...pl.meaning.slice(0, 40), ...pl.keyword.slice(0, 40)]) if (!head.has(idOf(h))) head.set(idOf(h), h.excerpt)
                    const ids = [...head.keys()]
                    const lg = ids.length ? await withRetry('rerank', () => rerank.sharedReranker()!.rerank(c.prompt, ids.map(i => head.get(i)!))) : []
                    pools.push({
                        session: c.session,
                        labels: c.labels.filter(l => !l.startsWith('docs:')),
                        meaning: pl.meaning.map(h => [idOf(h), scoreKey(h)]),
                        keyword: pl.keyword.map(h => [idOf(h), scoreKey(h)]),
                        logit: Object.fromEntries(ids.map((i, j) => [i, lg[j]!])),
                    })
                }
                const h = await hybridMod.hybridSearch(vault, c.prompt, { limit: 60, deny: [], channel: 'chat' })
                search.hybrid = h.hits
                    .filter(x => x.kind !== 'chat')
                    .slice(0, 10)
                    .map(x => keyed(x.kind, x.path))
                    .filter((k): k is string => !!k)
                search.hybridMode = h.mode
            } catch (e) {
                search.hybridMode = `unavailable: ${(e as Error).message}`
            }
        }
        rows.push({
            set,
            session: c.session,
            at: c.at,
            prompt: c.prompt,
            labels: c.labels,
            injected,
            retrieved,
            cands,
            hit: c.labels.some(l => injected.some(i => keyMatches(l, i))),
            labelRetrieved: c.labels.some(l => retrieved.some(i => keyMatches(l, i))),
            pastChat: injected.some(i => i.startsWith('chat:')),
            ranges: c.timeRanges,
            digest: !!digest,
            chatInRange: injected.some(i => {
                const ms = i.startsWith('chat:') ? started.get(i.slice(5)) : undefined
                return ms !== undefined && inRanges(localDate(ms), c.timeRanges)
            }),
            items,
            context: context.slice(-1500),
            verdicts: {},
            candItems,
            ...(search ? { search } : {}),
        })
        if (n % 25 === 0) console.log(`  ${n}/${total}`)
    }

// The judge (bench/recallJudge.ts): Haiku through the user's own `claude` login. One short, strict
// question per (prompt, item); verdicts are cached under --out so a rerun judges only what is new.
// `--judge-prompt` picks the prompt by id (bench/judgeCalibrate.ts chooses it).
const judgePrompt = flag('--judge-prompt') ?? DEFAULT_JUDGE_PROMPT
if (!JUDGE_PROMPTS[judgePrompt]) {
    console.error(`unknown --judge-prompt ${judgePrompt}`)
    process.exit(2)
}
const cachePath = join(out, 'judge-cache.jsonl')
let judgeErrors = 0
if (judge) {
    const jobs: { row: Row; key: string; text: string }[] = []
    for (const row of rows) for (const it of row.items) jobs.push({ row, key: it.key, text: it.text })
    // Every candidate the gate scored is judged too, quiet cases included, so the fit does not learn from the
    // gate's survivors alone and a quiet candidate is junk only when the judge says so. A label-matching
    // candidate is a hit and needs no verdict.
    const matchedIn = (r: Row, key: string) => r.labels.some(l => keyMatches(l, key))
    for (const row of rows)
        for (const it of row.candItems)
            if (!row.items.some(x => x.key === it.key) && !matchedIn(row, it.key)) jobs.push({ row, key: it.key, text: it.text })
    const size = concurrencyArg ? Math.max(1, Number(concurrencyArg) || 1) : judgePoolSize(cpus().length, totalmem())
    const verdicts = await judgeJobs(
        jobs.map(j => ({ promptId: judgePrompt, ctx: j.row.context, prompt: j.row.prompt, key: j.key, text: j.text })),
        cachePath,
        out,
        size,
        s => console.log(s),
    )
    jobs.forEach((j, i) => {
        j.row.verdicts[j.key] = verdicts[i]!
        if (verdicts[i] === 'error') judgeErrors++
    })
}
const verdictsOf = (rs: Row[], section?: Section) =>
    rs.flatMap(r =>
        r.items
            .filter(i => !section || (i.key !== 'digest' && sectionOf(i.key) === section))
            .map(i => r.verdicts[i.key])
            .filter((v): v is Verdict => v === 'relevant' || v === 'irrelevant'),
    )

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '—')
const lab = rows.filter(r => r.set === 'labelled')
const kindRows = (k: string) => lab.filter(r => r.labels.some(l => l.startsWith(`${k}:`)))
const summary = {
    sessions: started.size,
    prompts: all.length,
    labelled: {
        cases: lab.length,
        hit: lab.filter(r => r.hit).length,
        retrieved: lab.filter(r => r.labelRetrieved).length,
        byKind: Object.fromEntries(
            ['docs', 'note', 'pdf', 'image'].map(k => {
                const rs = kindRows(k)
                const hit = rs.filter(r => r.labels.some(l => l.startsWith(`${k}:`) && r.injected.some(i => keyMatches(l, i)))).length
                const ret = rs.filter(r => r.labels.some(l => l.startsWith(`${k}:`) && r.retrieved.some(i => keyMatches(l, i)))).length
                return [k, { cases: rs.length, hit, retrieved: ret }]
            }),
        ),
    },
    past: { cases: past.length, gotPastChat: rows.filter(r => r.set === 'past' && r.pastChat).length },
    quiet: {
        cases: quiet.length,
        anySource: rows.filter(r => r.set === 'quiet' && r.injected.length > 0).length,
        items: rows.filter(r => r.set === 'quiet').reduce((a, r) => a + r.injected.length, 0),
    },
    precision: {
        all: precisionOf(lab.map(r => ({ ...r, injected: r.injected.filter(k => sectionOf(k) !== 'chats') }))),
        ...Object.fromEntries(SECTIONS.map(sec => [sec, precisionOf(lab, sec)])),
    },
    judge: judge
        ? {
              errors: judgeErrors,
              all: junkStats(verdictsOf(rows)),
              ...Object.fromEntries(SECTIONS.map(sec => [sec, junkStats(verdictsOf(rows, sec))])),
              digest: junkStats(rows.flatMap(r => (r.verdicts.digest === 'relevant' || r.verdicts.digest === 'irrelevant' ? [r.verdicts.digest] : []))),
              quietJunkCases: rows.filter(r => r.set === 'quiet' && r.items.length > 0 && !r.items.some(i => r.verdicts[i.key] === 'relevant')).length,
          }
        : null,
    time: {
        cases: rows.filter(r => r.set === 'time').length,
        gotDigest: rows.filter(r => r.set === 'time' && r.digest).length,
        gotChatInRange: rows.filter(r => r.set === 'time' && r.chatInRange).length,
        gotEither: rows.filter(r => r.set === 'time' && (r.digest || r.chatInRange)).length,
    },
    search: searchEval
        ? (() => {
              const sr = lab.filter(r => r.search)
              const of = (pick: (s: Search) => string[] | null) =>
                  searchScore(sr.flatMap(r => { const ranked = pick(r.search!); return ranked ? [{ ranked, labels: r.labels.filter(l => !l.startsWith('docs:')) }] : [] }))
              const hm = sr.map(r => r.search!.hybridMode ?? 'n/a')
              return {
                  cases: sr.length,
                  keyword: of(s => s.keyword),
                  semantic: of(s => s.semantic),
                  hybrid: sr.every(r => r.search!.hybrid === null) ? 'unavailable' : of(s => s.hybrid),
                  hybridModes: Object.fromEntries([...new Set(hm)].map(m => [m, hm.filter(x => x === m).length])),
              }
          })()
        : null,
    injectedPerCase: (rows.reduce((a, r) => a + r.injected.length, 0) / Math.max(1, rows.length)).toFixed(2),
}
writeFileSync(join(out, 'cases.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
const rowOf = new Map<number, Row>()
rows.forEach((r, i) => rowOf.set(i + 1, r))
writeFileSync(
    join(out, 'candidates.jsonl'),
    candRows.map(c => JSON.stringify({ ...c, verdict: rowOf.get(c.id)?.verdicts[c.key] })).join('\n') + '\n',
)
if (searchEval) writeFileSync(join(out, 'search-pools.jsonl'), pools.map(p => JSON.stringify(p)).join('\n') + '\n')
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2))

const L = summary.labelled
console.log(`\nlabelled ${L.cases}: hit ${pct(L.hit, L.cases)} (${L.hit})  retrieved in top 10 ${pct(L.retrieved, L.cases)} (${L.retrieved})`)
for (const [k, v] of Object.entries(L.byKind)) console.log(`  ${k.padEnd(5)} ${String(v.cases).padStart(4)} cases  hit ${pct(v.hit, v.cases).padStart(4)}  retrieved ${pct(v.retrieved, v.cases).padStart(4)}`)
console.log(`past-chat ${summary.past.cases}: got a past chat ${pct(summary.past.gotPastChat, summary.past.cases)}`)
console.log(`quiet ${summary.quiet.cases}: any source injected ${pct(summary.quiet.anySource, summary.quiet.cases)} (${summary.quiet.items} items)`)
const P = summary.precision
const f = (x: number | null) => (x === null ? '—' : `${(100 * x).toFixed(0)}%`)
console.log(`injected ${P.all.cases}/${L.cases} labelled cases  precision ${f(P.all.precision)} (${P.all.matched}/${P.all.items})`)
for (const sec of SECTIONS) {
    const v = P[sec]
    console.log(`  ${sec.padEnd(5)} cases ${String(v.cases).padStart(3)}  items ${String(v.items).padStart(4)}  precision ${f(v.precision)}`)
}
if (summary.judge) {
    const J = summary.judge
    console.log(`judged ${J.all.judged} (errors ${J.errors}): relevant ${J.all.relevant}  junkRate ${f(J.all.junkRate)}`)
    for (const sec of SECTIONS) console.log(`  ${sec.padEnd(5)} judged ${String(J[sec].judged).padStart(4)}  relevant ${String(J[sec].relevant).padStart(4)}  junkRate ${f(J[sec].junkRate)}`)
    console.log(`  digest judged ${J.digest.judged}  relevant ${J.digest.relevant}`)
    console.log(`quiet junk cases (anything injected, none relevant): ${J.quietJunkCases}/${summary.quiet.cases}`)
}
const T = summary.time
console.log(`time ${T.cases}: digest ${T.gotDigest}  in-range chat ${T.gotChatInRange}  either ${T.gotEither}`)
if (summary.search) {
    const S = summary.search
    console.log(`search (${S.cases} labelled cases with file labels), recall@10 / MRR`)
    for (const m of ['keyword', 'semantic', 'hybrid'] as const) {
        const v = S[m]
        console.log(`  ${m.padEnd(8)} ${typeof v === 'string' ? v : `${f(v.recall)} / ${v.mrr.toFixed(3)}`}`)
    }
    console.log(`  hybrid modes ${JSON.stringify(S.hybridModes)}`)
}
console.log(`out: ${out}`)
process.exit(0)
