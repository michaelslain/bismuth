import { test, expect } from 'bun:test'
import { createRecallService } from '../src/memoryRecall'
import type { RecallDeps, RecallEngine, RecallRequest } from '../src/memoryRecall'
import type { SourceHit } from '../src/semanticSources'
import type { MemoryNote } from '@bismuth/memory'
import { CLOSED_GATE } from '../src/sourceGate'
import type { GateTraceRow } from '../src/sourceGate'
import { cosineGate, logitGate } from './gateStub'

const hit = (over: Partial<SourceHit>): SourceHit => ({
    kind: 'note',
    id: 'a.md',
    score: 0.9,
    excerpt: 'an excerpt',
    hash: 'h1',
    ...over,
})
// a standout hit above nine filler hits
const withBackground = (top: SourceHit[], kind: SourceHit['kind'] = 'note'): SourceHit[] => [
    ...top,
    ...Array.from({ length: 9 }, (_, i) => hit({ kind, id: `bg${i}`, score: 0.6, hash: `b${i}` })),
]

const fakeEngine = {
    buildRecallIndex: (notes: MemoryNote[]) => ({ notes }) as any,
    rankNotes: () => [],
    packRecall: () => ({ text: null, injected: [] }),
    formatSessionStart: () => '',
    noteHash: (n: MemoryNote) => n.content,
    contextFromTranscript: () => '',
    queryFromToolCalls: () => '',
    lastAgentPrompt: () => 'alpha',
} as unknown as RecallEngine

const embedder = { embed: async () => [new Float32Array(2)], dispose() {} }
const reranker = (logit: number | ((p: string[]) => number[])) => ({
    rerank: async (_q: string, p: string[]) => (typeof logit === 'number' ? p.map(() => logit) : logit(p)),
    dispose() {},
})

function make(hits: SourceHit[] | (() => Promise<SourceHit[]>), over: Partial<RecallDeps> = {}) {
    const seen: any[] = []
    const svc = createRecallService({
        memoryDir: () => '/mem',
        settings: () => ({ enabled: true, midTurn: true, semantic: true }),
        embedder: () => embedder,
        engine: fakeEngine,
        loadNotes: async () => [],
        reranker: () => reranker(0),
        sources: async q => {
            seen.push(q)
            return typeof hits === 'function' ? hits() : hits
        },
        gateModel: logitGate,
        vault: '/v',
        ...over,
    })
    return { svc, seen }
}
const prompt = (extra: Partial<RecallRequest> = {}): RecallRequest => ({
    mode: 'prompt',
    sessionId: 's',
    prompt: 'how do calendars work',
    ...extra,
})

test('with memory empty an admitted source still yields a block: banner, no memories heading', async () => {
    const { svc, seen } = make(withBackground([hit({ id: 'Projects/Launch.md' })]))
    const r = await svc.recall(prompt())
    expect(r.sources).toEqual(['note:Projects/Launch.md'])
    expect(r.injected).toEqual([])
    expect(r.context).toStartWith('<bismuth-memory>\n')
    expect(r.context).toContain('# Vault files\n\n- Projects/Launch.md (note) — ')
    expect(r.context).not.toContain('# Memories')
    expect(r.context).toEndWith('</bismuth-memory>')
    expect(seen).toHaveLength(1)
    expect(seen[0].k).toBe(10)
    expect(seen[0].channel).toBe('daemon')
    expect(seen[0].excludeSessionId).toBe('s')
    expect(seen[0].switches).toEqual({ files: true, chats: true, docs: true })
})

test('nothing admitted: an empty memory dir says no-memory, a memory with no match says no-match', async () => {
    expect((await make([]).svc.recall(prompt())).reason).toBe('no-memory')
    const note = { name: 'n', content: 'x', frontmatter: {} } as unknown as MemoryNote
    expect((await make([], { loadNotes: async () => [note] }).svc.recall(prompt())).reason).toBe('no-match')
})

test('sources are appended inside the envelope after the memory text', async () => {
    const { svc } = make(withBackground([hit({})]), {
        engine: {
            ...fakeEngine,
            rankNotes: () => [{ note: { name: 'm' }, lexical: 1, score: 1 }],
            packRecall: () => ({
                text: '<bismuth-memory>\nB\n\n# Memories\n\nmem\n\n</bismuth-memory>',
                injected: [{ name: 'm', hash: 'x' }],
            }),
        } as unknown as RecallEngine,
        loadNotes: async () => [{ name: 'm', content: 'alpha', backlinks: [], frontmatter: { type: 'fact', tags: [] } } as any],
    })
    const r = await svc.recall(prompt())
    expect(r.injected).toEqual(['m'])
    expect(r.context).toStartWith('<bismuth-memory>\nB\n\n# Memories\n\nmem\n\nPossibly related, unverified. Open one only if it helps; ignore the rest.\n\n# Vault files\n\n')
    expect(r.context!.match(/<\/bismuth-memory>/g)).toHaveLength(1)
})

test('no reranker, no embedder, no deps.sources, wrong mode or semantic off = no sources', async () => {
    const hits = withBackground([hit({})])
    expect((await make(hits, { reranker: () => null }).svc.recall(prompt())).context).toBeNull()
    expect((await make(hits, { embedder: () => null }).svc.recall(prompt())).context).toBeNull()
    expect((await make(hits, { sources: undefined }).svc.recall(prompt())).context).toBeNull()
    expect(
        (await make(hits).svc.recall({ mode: 'tool', sessionId: 's', toolCalls: [{ tool_name: 'Read', tool_input: 'alpha' }] }))
            .context,
    ).toBeNull()
    expect(
        (await make(hits, { settings: () => ({ enabled: true, midTurn: true, semantic: false }) }).svc.recall(prompt())).context,
    ).toBeNull()
})

test('the gate alone decides: a closed gate admits no source and memory is unaffected', async () => {
    const note = { name: 'm', content: 'alpha', backlinks: [], frontmatter: { type: 'fact', tags: [] } } as any
    const memory = {
        ...fakeEngine,
        rankNotes: () => [{ note: { name: 'm' }, lexical: 1, score: 1 }],
        packRecall: () => ({ text: '<bismuth-memory>\nB\n\n# Memories\n\nmem\n\n</bismuth-memory>', injected: [{ name: 'm', hash: 'x' }] }),
    } as unknown as RecallEngine
    const closed = make(withBackground([hit({})]), { gateModel: CLOSED_GATE, engine: memory, loadNotes: async () => [note] })
    const r = await closed.svc.recall(prompt())
    expect(r.sources ?? []).toEqual([])
    expect(r.injected).toEqual(['m'])
    expect(r.context).toContain('# Memories')
    expect(r.context).not.toContain('# Vault files')
    expect((await make(withBackground([hit({})]), { gateModel: CLOSED_GATE }).svc.recall(prompt())).context).toBeNull()
})

test('the gate reads the cosine: a cosine gate refuses a hit under its cutoff', async () => {
    const low = make([hit({ score: 0.5 })], { gateModel: cosineGate })
    expect((await low.svc.recall(prompt())).context).toBeNull()
    expect((await make([hit({ score: 0.6 })], { gateModel: cosineGate }).svc.recall(prompt())).sources).toEqual(['note:a.md'])
})

test('every candidate reaches the gate with its features, accepted or not', async () => {
    const rows: GateTraceRow[] = []
    const files = Array.from({ length: 10 }, (_, i) => hit({ id: `f${i}.md`, score: 0.9 - i * 0.02, hash: `f${i}` }))
    const chats = [hit({ kind: 'chat', id: 'sess', score: 0.7, hash: 'c', date: '2026-10-29' })]
    const { svc } = make([...files, ...chats], { gateTrace: r => rows.push(...r), reranker: () => reranker(p => p.map((_, i) => 3 - i)) })
    await svc.recall(prompt({ prompt: 'a prompt of 24 chars...' }))
    const byKey = new Map(rows.map(r => [r.key, r]))
    expect(rows).toHaveLength(6)
    const top = byKey.get('note:f0.md')!
    expect(top.path).toBe('ordinary')
    expect(top.features).toMatchObject({ cosine: 0.9, rank: 0, kind: 'file', inRange: false, promptChars: 'a prompt of 24 chars...'.length })
    // the source's tenth-best cosine
    expect(top.features.background).toBeCloseTo(0.9 - 9 * 0.02, 9)
    expect(byKey.get('note:f4.md')!.features.rank).toBe(4)
    expect(byKey.has('note:f5.md')).toBe(false)
    expect(byKey.get('chat:sess')!.features).toMatchObject({ kind: 'chat', rank: 0 })
    // a source with fewer than ten hits takes its last hit as the background
    expect(byKey.get('chat:sess')!.features.background).toBe(0.7)
    expect(typeof top.features.rerank).toBe('number')
    expect(rows.every(r => r.accepted === (r.probability >= 0.5))).toBe(true)
})

test('an embedder that never answers does not hold the memory context past the budget', async () => {
    const { svc } = make(withBackground([hit({})]), {
        embedder: () => ({ embed: () => new Promise<Float32Array[]>(() => {}), dispose() {} }),
        engine: {
            ...fakeEngine,
            packRecall: () => ({
                text: '<bismuth-memory>\nB\n\n# Memories\n\nmem\n\n</bismuth-memory>',
                injected: [{ name: 'm', hash: 'x' }],
            }),
        } as unknown as RecallEngine,
        loadNotes: async () => [{ name: 'm', content: 'alpha', backlinks: [], frontmatter: { type: 'fact', tags: [] } } as any],
    })
    const t = Date.now()
    const r = await svc.recall(prompt())
    expect(Date.now() - t).toBeLessThan(600)
    expect(r.context).toContain('# Memories')
    expect(r.sources ?? []).toEqual([])
})

test('the reranker judges the best 5 per source in one call, and logits below the gate refuse', async () => {
    const seenPassages: string[][] = []
    const top = [1, 2, 3, 4, 5, 6].map(i => hit({ id: `t${i}.md`, score: 0.79 - i * 0.01, excerpt: `e${i}`, hash: `${i}` }))
    const { svc } = make(withBackground(top), {
        reranker: () => reranker(p => (seenPassages.push(p), p.map(() => -9))),
    })
    expect((await svc.recall(prompt())).context).toBeNull()
    expect(seenPassages).toEqual([['e1', 'e2', 'e3', 'e4', 'e5']])
})

test('chats need two more logit than files: the gate weighs the kind', async () => {
    const files = withBackground([hit({ id: 'f.md' })])
    const chats = withBackground([hit({ kind: 'chat', id: 'sess', date: '2026-10-29' })], 'chat')
    const { svc } = make([...files, ...chats], { reranker: () => reranker(-5) })
    const r = await svc.recall(prompt())
    expect(r.sources).toEqual(['note:f.md'])
    expect(r.context).not.toContain('# Past chats')
    const strong = make(chats, { reranker: () => reranker(-3.5) })
    expect((await strong.svc.recall(prompt())).sources).toEqual(['chat:sess'])
})

test('ledger: the same hash is skipped, a changed hash re-sends, a compact resets', async () => {
    let hash = 'h1'
    const { svc } = make(async () => withBackground([hit({ hash })]))
    expect((await svc.recall(prompt())).sources).toEqual(['note:a.md'])
    expect((await svc.recall(prompt())).context).toBeNull()
    hash = 'h2'
    expect((await svc.recall(prompt())).sources).toEqual(['note:a.md'])
    expect((await svc.recall(prompt())).context).toBeNull()
    await svc.recall({ mode: 'session-start', sessionId: 's', source: 'compact' })
    expect((await svc.recall(prompt())).sources).toEqual(['note:a.md'])
})

test('an aborted request commits nothing to the ledger', async () => {
    const { svc } = make(withBackground([hit({})]))
    const ac = new AbortController()
    ac.abort()
    expect((await svc.recall(prompt({ signal: ac.signal }))).context).toBeNull()
    expect((await svc.recall(prompt())).sources).toEqual(['note:a.md'])
})

test('a source slower than the rerank budget is dropped for that request', async () => {
    const { svc } = make(() => new Promise<SourceHit[]>(res => setTimeout(() => res(withBackground([hit({})])), 200)), {
        rerankTimeoutMs: 30,
    })
    expect((await svc.recall(prompt())).context).toBeNull()
})

test('a failing source or reranker leaves the request unharmed', async () => {
    const boom = make(async () => {
        throw new Error('x')
    })
    expect((await boom.svc.recall(prompt())).context).toBeNull()
    const bad = make(withBackground([hit({})]), {
        reranker: () => ({ rerank: async () => Promise.reject(new Error('x')), dispose() {} }),
    })
    expect((await bad.svc.recall(prompt())).context).toBeNull()
})

test('a candidate the cross-encoder does not answer for is not injected', async () => {
    const short = make(withBackground([hit({})]), { reranker: () => reranker(() => [1]) })
    expect((await short.svc.recall(prompt())).context).toBeNull()
})

test('the ledger drops a source already sent after scoring, so ranks do not shift', async () => {
    const rows: GateTraceRow[] = []
    const { svc } = make(withBackground([hit({ id: 'Calendar.md', score: 0.84 })]), { gateTrace: r => rows.push(...r) })
    expect((await svc.recall(prompt())).sources).toEqual(['note:Calendar.md'])
    expect((await svc.recall(prompt({ prompt: 'and again' }))).sources ?? []).toEqual([])
    expect(rows.filter(r => r.key === 'note:Calendar.md').map(r => r.features.rank)).toEqual([0, 0])
})
