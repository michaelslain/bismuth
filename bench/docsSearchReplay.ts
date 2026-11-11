// Docs search replay: does a change to `bismuth docs search` (the blend, the cross-encoder, the embedder)
// put the page an agent needed nearer the top? Real cases are rare (an agent runs `bismuth docs search`
// a handful of times a week), so the cases are of two kinds:
//   real       a prompt followed by `bismuth docs read <page>`, or `bismuth docs search <q>` followed by a
//              read, in the Claude Code logs of the vault and of this repo; the labels are the pages read
//   written    one question per sampled docs section, written by Haiku from the section's text in a
//              user's words; the label is that section's page
//   bun bench/docsSearchReplay.ts cases --out <dir> [--n 240] [--vault <dir>]
//   bun bench/docsSearchReplay.ts pools --out <dir> [--embed <name>] [--context none|headings]
// `pools` writes `<out>/pools.jsonl` in the shape of bench/searchReplay.ts, so `searchReplay.ts rerank` and
// `score` run on it unchanged; folds group the written cases by page and the real ones by session. Docs
// are public, so only the real prompts are private: keep `--out` out of the repo.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Glob } from 'bun'
import { encodeProjectDir } from '../memory/src/sessionHistory'
import { parseReplaySession } from './recallReplayCases'
import { HEAD, readJsonl, type SearchPool } from './searchReplay'

export type DocsCase = { id: number; kind: 'real' | 'written'; group: string; query: string; pages: string[] }

const DOCS = join(import.meta.dir, '..', 'docs')
const pageOf = (id: string) => id.replace(/#.*$/, '').replace(/^docs:/, '')

/** `bismuth docs search <q>` calls and the pages read before the next one, from one log's tool calls. */
export function searchReadPairs(jsonl: string): { query: string; pages: string[] }[] {
    const out: { query: string; pages: string[] }[] = []
    let cur: { query: string; pages: string[] } | null = null
    const close = () => {
        if (cur && cur.pages.length) out.push(cur)
        cur = null
    }
    for (const line of jsonl.split('\n')) {
        if (!line) continue
        let e: { type?: string; message?: { content?: unknown } }
        try {
            e = JSON.parse(line)
        } catch {
            continue
        }
        const content = e.message?.content
        if (e.type === 'user' && typeof content === 'string') close()
        if (!Array.isArray(content)) continue
        for (const c of content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
            if (c.type !== 'tool_use') continue
            const args = c.input?.args
            const cmd =
                typeof c.input?.command === 'string'
                    ? c.input.command
                    : c.name?.includes('bismuth_cli')
                      ? `bismuth ${Array.isArray(args) ? args.join(' ') : String(args ?? '')}`
                      : ''
            for (const m of cmd.matchAll(/bismuth docs search\s+(?:"([^"]+)"|'([^']+)'|([^|;&\n<>`]+))/g)) {
                close()
                const query = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\s--\S+(\s+\d+)?/g, '').replace(/\s*2$/, '').trim()
                if (query) cur = { query, pages: [] }
            }
            for (const m of cmd.matchAll(/bismuth docs read\s+["']?([\w./-]+\.md)/g)) if (cur && !cur.pages.includes(m[1]!)) cur.pages.push(m[1]!)
        }
    }
    close()
    return out
}

const WRITE_SYSTEM =
    'You write search queries for a notes app\'s documentation. For each numbered section you are shown, write one short question a user of the app would type when the answer is in that section. ' +
    'Use the words a user would use, not the section\'s heading or its rare terms; never name a file, a flag or a code identifier unless a user would know it. ' +
    'Reply with one JSON array of strings, one per section, in order, and nothing else.'

async function haiku(text: string): Promise<string | null> {
    const { whichClaude, claudeSpawnEnv } = await import('../core/src/claudeWhich')
    const bin = whichClaude()
    if (!bin) throw new Error('claude binary not found')
    const { query } = (await import('../core/node_modules/@anthropic-ai/claude-agent-sdk')) as unknown as {
        query: (a: unknown) => AsyncIterable<{ type: string; subtype?: string; result?: string }>
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            for await (const m of query({
                prompt: text,
                options: { model: 'claude-haiku-5-5', pathToClaudeCodeExecutable: bin, cwd: DOCS, env: claudeSpawnEnv(), tools: [], maxTurns: 1, persistSession: false, settingSources: [], systemPrompt: WRITE_SYSTEM },
            }))
                if (m.type === 'result' && m.subtype === 'success' && m.result) return m.result
        } catch {}
    }
    return null
}

async function cases() {
    const out = resolve(flag('--out')!)
    mkdirSync(out, { recursive: true })
    const n = Number(flag('--n') ?? 240)
    const path = join(out, 'cases.jsonl')
    const have = existsSync(path) ? readJsonl<DocsCase>(path) : []
    const rows: DocsCase[] = [...have]
    if (!have.some(c => c.kind === 'real')) {
        const vault = resolve(flag('--vault') ?? '/Users/m/Documents/library of alexandria')
        const files = new Set<string>()
        for (const f of new Glob('**/*.md').scanSync({ cwd: vault, dot: false })) files.add(f)
        const projects = join(homedir(), '.claude', 'projects')
        const dirs = [encodeProjectDir(vault), encodeProjectDir(resolve(import.meta.dir, '..'))]
        for (const d of dirs) {
            const dir = join(projects, d)
            if (!existsSync(dir)) continue
            for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
                const text = readFileSync(join(dir, f), 'utf8')
                const session = f.slice(0, -6)
                for (const p of searchReadPairs(text))
                    rows.push({ id: rows.length, kind: 'real', group: `real:${session}`, query: p.query, pages: p.pages })
                if (d === dirs[0])
                    for (const c of parseReplaySession(session, text, vault, files).cases) {
                        const pages = [...new Set(c.labels.filter(l => l.startsWith('docs:')).map(pageOf))]
                        if (pages.length) rows.push({ id: rows.length, kind: 'real', group: `real:${session}`, query: c.prompt, pages })
                    }
            }
        }
        console.log(`${rows.filter(r => r.kind === 'real').length} real cases`)
    }
    if (!have.some(c => c.kind === 'written')) {
        const { docSections } = await import('../core/src/docsEmbed')
        const secs: { id: string; text: string }[] = []
        for (const f of new Glob('**/*.md').scanSync({ cwd: DOCS })) {
            if (f === 'README.md') continue
            const notes = docSections(f, readFileSync(join(DOCS, f), 'utf8'), f)
            for (const s of notes) if (s.content.length >= 300) secs.push({ id: s.name, text: s.content.slice(0, 1500) })
        }
        // an even spread: every n-th section of the sorted list
        secs.sort((a, b) => (a.id < b.id ? -1 : 1))
        const step = Math.max(1, secs.length / n)
        const pick = Array.from({ length: Math.min(n, secs.length) }, (_, i) => secs[Math.floor(i * step)]!)
        console.log(`${secs.length} sections, writing questions for ${pick.length}`)
        for (let i = 0; i < pick.length; i += 10) {
            const batch = pick.slice(i, i + 10)
            const text = batch.map((s, j) => `Section ${j + 1}:\n${s.text}`).join('\n\n---\n\n')
            const reply = await haiku(text)
            let qs: unknown = null
            try {
                qs = JSON.parse(reply?.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1) ?? 'null')
            } catch {}
            if (!Array.isArray(qs) || qs.length !== batch.length) {
                console.log(`  batch ${i / 10}: unusable reply, skipped`)
                continue
            }
            batch.forEach((s, j) => {
                if (typeof qs[j] === 'string')
                    rows.push({ id: rows.length, kind: 'written', group: `page:${pageOf(s.id)}`, query: qs[j], pages: [pageOf(s.id)] })
            })
            console.log(`  ${Math.min(i + 10, pick.length)} of ${pick.length}`)
        }
    }
    writeFileSync(path, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    console.log(`wrote ${rows.length} cases to ${path}`)
}

async function pools() {
    const out = resolve(flag('--out')!)
    if (flag('--embed')) process.env.BISMUTH_EMBED_MODEL = flag('--embed')
    if (flag('--context')) process.env.BISMUTH_CHUNK_CONTEXT = flag('--context')
    const cs = readJsonl<DocsCase>(resolve(flag('--cases') ?? join(out, 'cases.jsonl')))
    const [mem, docsEmbed, { searchDocs }, { topicWords }] = await Promise.all([
        import('../core/src/memoryEmbed'),
        import('../core/src/docsEmbed'),
        import('../mcp/src/docs'),
        import('../core/src/docsHybrid'),
    ])
    docsEmbed.configureDocsEmbed({ channel: mem.sharedSemanticChannel(), vectorsDir: join(out, 'vectors-docs'), docsRoot: DOCS })
    docsEmbed.syncDocsEmbeddings()
    while (!(await docsEmbed.docsIndexReady())) await Bun.sleep(1000)
    const rows: SearchPool[] = []
    for (const c of cs) {
        const m = await docsEmbed.docsQueryHits(c.query, { k: 60, root: DOCS, waitMs: 60_000 })
        if ('unavailable' in m) {
            console.log(`  case ${c.id}: ${m.unavailable}`)
            continue
        }
        const kw = searchDocs(DOCS, topicWords(c.query), 60)
        const texts: Record<string, string> = {}
        // what docs search's rerank pass reads: the heading and the snippet of the hit the fusion keeps
        for (const h of kw.slice(0, HEAD)) texts[h.path] ??= `${h.heading}\n${h.snippet}`
        for (const h of m.hits.slice(0, HEAD)) texts[h.id] ??= `${(h.title ?? h.id).split(' // ').pop()}\n${h.excerpt}`
        rows.push({
            id: c.id,
            session: c.group,
            at: '',
            prompt: c.query,
            labels: c.pages.map(p => `docs:${p}`),
            meaning: m.hits.map(h => [h.id, `docs:${pageOf(h.id)}`]),
            keyword: kw.map(h => [h.path, `docs:${pageOf(h.path)}`]),
            texts,
        })
    }
    writeFileSync(join(out, 'pools.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    console.log(`wrote ${rows.length} pools (${mem.STORE_MODEL})`)
    process.exit(0)
}

const argv = process.argv.slice(2)
function flag(name: string) {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
}
if (import.meta.main) {
    if (!flag('--out')) {
        console.error('usage: bun bench/docsSearchReplay.ts cases|pools --out <dir> …')
        process.exit(2)
    }
    if (argv[0] === 'cases') await cases()
    else if (argv[0] === 'pools') await pools()
    else process.exit(2)
}
