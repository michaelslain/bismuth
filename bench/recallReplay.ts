// Recall replay: does recall hand an agent, up front, what it went and fetched itself?
//   bun bench/recallReplay.ts --vault <dir> [--logs <claude project dir>] [--out <dir>] [--negatives n] [--dry]
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Glob } from 'bun'
import { encodeProjectDir } from '../memory/src/sessionHistory'
import { keyMatches, parseReplaySession, type ReplayCase } from './recallReplayCases'

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
const kindsOf = (c: ReplayCase) => [...new Set(c.labels.map(l => l.slice(0, l.indexOf(':'))))]
const byKind: Record<string, number> = {}
for (const c of labelled) for (const k of kindsOf(c)) byKind[k] = (byKind[k] ?? 0) + 1

console.log(`sessions ${started.size}  prompts ${all.length}  labelled ${labelled.length} ${JSON.stringify(byKind)}  past ${past.length}  quiet ${quiet.length} of ${quietAll.length}`)
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
const sources = async (q: Parameters<typeof recall.sourcesFor>[1]) => (await recall.sourcesFor(vault, q)).filter(notFuture)
const svc = recall.createRecallService({
    memoryDir: () => join(vault, '.daemon', 'memory'),
    settings: () => ({ enabled: true, midTurn: false, semantic: true }),
    embedder: () => channel.embedder(),
    semanticScores: (e, q, n, d) => channel.semanticScores(e, q, n, d),
    reranker: () => rerank.sharedReranker(),
    sources,
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
    set: 'labelled' | 'past' | 'quiet'
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
}
const rows: Row[] = []
const sets: [Row['set'], ReplayCase[]][] = [['labelled', labelled], ['past', past], ['quiet', quiet]]
let n = 0
const total = labelled.length + past.length + quiet.length
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
        const r = await svc.recall({ mode: 'prompt', sessionId: c.session, agentId: `replay-${n}`, prompt: c.prompt, transcriptPath, channel: 'chat' })
        const injected = r.sources ?? []
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
        })
        if (n % 25 === 0) console.log(`  ${n}/${total}`)
    }

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
    injectedPerCase: (rows.reduce((a, r) => a + r.injected.length, 0) / Math.max(1, rows.length)).toFixed(2),
}
writeFileSync(join(out, 'cases.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2))

const L = summary.labelled
console.log(`\nlabelled ${L.cases}: hit ${pct(L.hit, L.cases)} (${L.hit})  retrieved in top 10 ${pct(L.retrieved, L.cases)} (${L.retrieved})`)
for (const [k, v] of Object.entries(L.byKind)) console.log(`  ${k.padEnd(5)} ${String(v.cases).padStart(4)} cases  hit ${pct(v.hit, v.cases).padStart(4)}  retrieved ${pct(v.retrieved, v.cases).padStart(4)}`)
console.log(`past-chat ${summary.past.cases}: got a past chat ${pct(summary.past.gotPastChat, summary.past.cases)}`)
console.log(`quiet ${summary.quiet.cases}: any source injected ${pct(summary.quiet.anySource, summary.quiet.cases)} (${summary.quiet.items} items)`)
console.log(`out: ${out}`)
process.exit(0)
