import { test, expect } from 'bun:test'
import * as mem from '@bismuth/memory'
import type { MemoryNote } from '@bismuth/memory'
import { createRecallService } from '../src/memoryRecall'
import type { RecallEngine } from '../src/memoryRecall'
import { timeRecall } from '../src/timeRecall'
import type { TimeRecallArgs } from '../src/timeRecall'
import type { SourceHit } from '../src/semanticSources'
import { cosineGate, logitGate } from './gateStub'

const NOW = new Date(2026, 10, 6, 12, 0, 0) // 2026-11-06 local

const note = (name: string, content: string, type = 'daily'): MemoryNote =>
    ({
        name,
        content,
        backlinks: [],
        frontmatter: { type, tags: [], created: '2026-11-05', updated: '2026-11-05', description: `about ${name}`, visibility: 'all' },
    }) as unknown as MemoryNote

const chat = (id: string, date: string, score: number): SourceHit => ({
    kind: 'chat',
    id,
    score,
    date,
    excerpt: `talked about ${id}`,
    hash: `h-${id}`,
})

const args = (prompt: string, over: Partial<TimeRecallArgs> = {}): TimeRecallArgs => ({
    vault: '/v',
    memoryDir: '/mem',
    prompt,
    now: NOW,
    channel: 'daemon',
    sessionId: 's',
    vec: [0.1, 0.2],
    ...over,
})
const deps = (notes: MemoryNote[], chats?: SourceHit[]) => ({
    loadNotes: async () => notes,
    ...(chats ? { chatHits: async () => chats } : {}),
    gate: cosineGate,
})

test('yesterday with a day note yields the heading and the note body', async () => {
    const r = await timeRecall(args('what did we do yesterday'), deps([note('day-2026-11-05', '## Sessions\n- shipped the thing')]))
    expect(r!.block).toStartWith('# What happened yesterday (2026-11-05)\n\n## day-2026-11-05\n## Sessions\n- shipped the thing')
    expect(r!.injected).toEqual(['day-2026-11-05'])
})

test('only a week note covering the day: the week note comes back', async () => {
    const r = await timeRecall(args('what did we do yesterday'), deps([note('week-2026-W45', 'week body')]))
    expect(r!.block).toContain('## week-2026-W45\nweek body')
})

test('nothing covering: no digest block, but dated chats in range still come through', async () => {
    const chats = [chat('in', '2026-11-05', 0.7), chat('out', '2026-10-01', 0.9), chat('weak', '2026-11-05', 0.4)]
    const r = await timeRecall(args('what did we do yesterday'), deps([], chats))
    expect(r!.block).not.toContain('# What happened')
    expect(r!.block).toBe('')
    expect(r!.chats.map(h => h.id)).toEqual(['in'])
    expect(r!.injected).toEqual([])
})

test('the chat lookup asks for every session, since the date filter runs after ranking', async () => {
    let seenK = 0
    const chats = [chat('in', '2026-11-05', 0.7)]
    const d = { ...deps([], chats), chatHits: async (q: { k: number }) => ((seenK = q.k), chats) }
    await timeRecall(args('what did we do yesterday'), d)
    expect(seenK).toBeGreaterThanOrEqual(10_000)
})

test('no digest and no chat: null; no time words: null', async () => {
    expect(await timeRecall(args('what did we do yesterday'), deps([]))).toBeNull()
    expect(await timeRecall(args('how do calendars work'), deps([note('day-2026-11-05', 'x')]))).toBeNull()
})

test('ledger: a digest already sent is not re-sent unless its hash changed', async () => {
    const n = note('day-2026-11-05', 'body')
    const sent = new Map([['day-2026-11-05', mem.noteHash(n)]])
    expect(await timeRecall(args('yesterday', { sent }), deps([n]))).toBeNull()
    const changed = note('day-2026-11-05', 'body edited')
    expect((await timeRecall(args('yesterday', { sent }), deps([changed])))!.injected).toEqual(['day-2026-11-05'])
})

test('a hidden digest note is not injected', async () => {
    const hidden = note('day-2026-11-05', 'secret')
    ;(hidden.frontmatter as any).visibility = 'hidden'
    expect(await timeRecall(args('yesterday'), deps([hidden]))).toBeNull()
})

test('digest text stays within its budget', async () => {
    const days = ['2026-11-04', '2026-11-05'].map(d => note(`day-${d}`, 'x'.repeat(2000)))
    const r = await timeRecall(args('what happened yesterday and 2 days ago'), deps(days))
    expect(r!.block.length).toBeLessThan(2700)
})

// ---- the recall service ----
const engine = (withMemory: boolean) =>
    ({
        buildRecallIndex: (n: MemoryNote[]) => ({ notes: n }) as any,
        rankNotes: () => (withMemory ? [{ note: { name: 'm' }, lexical: 1, score: 1 }] : []),
        packRecall: () =>
            withMemory
                ? { text: '<bismuth-memory>\nB\n\n# Memories\n\nmem\n\n</bismuth-memory>', injected: [{ name: 'm', hash: 'x' }] }
                : { text: null, injected: [] },
        formatSessionStart: () => '',
        noteHash: (n: MemoryNote) => n.content,
        contextFromTranscript: () => '',
        queryFromToolCalls: () => '',
        lastAgentPrompt: () => 'alpha',
    }) as unknown as RecallEngine
const embedder = { embed: async () => [new Float32Array(2)], dispose() {} }
const srcHit = (id: string, score: number): SourceHit => ({ kind: 'note', id, score, excerpt: 'an excerpt', hash: `h${id}` })
const files = [srcHit('a.md', 0.9), ...Array.from({ length: 9 }, (_, i) => srcHit(`bg${i}`, 0.6))]
const mk = (notes: MemoryNote[]) =>
    createRecallService({
        gateModel: logitGate,
        memoryDir: () => '/mem',
        settings: () => ({ enabled: true, midTurn: true, semantic: true }),
        embedder: () => embedder,
        engine: engine(true),
        loadNotes: async () => [{ name: 'm', content: 'alpha', backlinks: [], frontmatter: { type: 'fact', tags: [] } } as any, ...notes],
        reranker: () => ({ rerank: async (_q: string, p: string[]) => p.map(() => 0), dispose() {} }) as any,
        sources: async () => files,
        timeChats: async () => [chat('c1', '2026-11-05', 0.8)],
        now: () => NOW.getTime(),
        vault: '/v',
    })

test('service: time block sits before # Vault files and the ledger stops a resend', async () => {
    const svc = mk([note('day-2026-11-05', 'did the thing')])
    const r = await svc.recall({ mode: 'prompt', sessionId: 's', prompt: 'what did we do yesterday' })
    const ctx = r.context!
    expect(ctx).toContain('# What happened yesterday (2026-11-05)\n\n## day-2026-11-05\ndid the thing')
    expect(ctx.indexOf('# What happened')).toBeLessThan(ctx.indexOf('# Vault files'))
    expect(ctx.indexOf('# Memories')).toBeLessThan(ctx.indexOf('# What happened'))
    expect(r.injected).toContain('day-2026-11-05')
    expect(r.sources).toContain('chat:c1')
    const again = await svc.recall({ mode: 'prompt', sessionId: 's', prompt: 'what did we do yesterday' })
    expect(again.context ?? '').not.toContain('# What happened')
})

test('service: a prompt with no time words is byte-identical to the pre-change output', async () => {
    // recorded from the code before time routing existed, on this same fixture
    const expected =
        '{"context":"<bismuth-memory>\\nB\\n\\n# Memories\\n\\nmem\\n\\nPossibly related, unverified. Open one only if it helps; ignore the rest.\\n\\n# Vault files\\n\\n- a.md (note) — an excerpt (open: `/v/a.md`)\\n\\n</bismuth-memory>","injected":["m"],"sources":["note:a.md"]}'
    const svc = mk([note('day-2026-11-05', 'did the thing')])
    const r = await svc.recall({ mode: 'prompt', sessionId: 's', prompt: 'how do calendars work' })
    expect(JSON.stringify(r)).toBe(expected)
})

test('service: one # Past chats heading when both paths yield chats, and a slow time path does not delay the answer', async () => {
    const mkSvc = (timeChats: () => Promise<SourceHit[]>) =>
        createRecallService({
        gateModel: logitGate,
            memoryDir: () => '/mem',
            settings: () => ({ enabled: true, midTurn: true, semantic: true }),
            embedder: () => embedder,
            engine: engine(true),
            loadNotes: async () => [{ name: 'm', content: 'alpha', backlinks: [], frontmatter: { type: 'fact', tags: [] } } as any],
            reranker: () => ({ rerank: async (_q: string, p: string[]) => p.map(() => 0), dispose() {} }) as any,
            sources: async () => [chat('c0', '2026-11-05', 0.9), ...files],
            timeChats,
            rerankTimeoutMs: 80,
            now: () => NOW.getTime(),
            vault: '/v',
        })
    const both = await mkSvc(async () => [chat('c1', '2026-11-05', 0.8)]).recall({ mode: 'prompt', sessionId: 's', prompt: 'what did we do yesterday' })
    expect(both.context!.match(/# Past chats/g)?.length).toBe(1)
    expect(both.sources).toEqual(expect.arrayContaining(['chat:c0', 'chat:c1']))

    const t0 = Date.now()
    const slow = await mkSvc(() => new Promise<SourceHit[]>(res => setTimeout(() => res([chat('c9', '2026-11-05', 0.8)]), 2000))).recall({
        mode: 'prompt',
        sessionId: 's2',
        prompt: 'what did we do yesterday',
    })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(slow.context).toContain('# Memories')
    expect(slow.context).toContain('# Vault files')
    expect(slow.sources).not.toContain('chat:c9')
})

const mkSlow = (srcMs: number, timeChats: () => Promise<SourceHit[]>, rerankTimeoutMs: number) =>
    createRecallService({
        gateModel: logitGate,
        memoryDir: () => '/mem',
        settings: () => ({ enabled: true, midTurn: true, semantic: true }),
        embedder: () => embedder,
        engine: engine(true),
        loadNotes: async () => [{ name: 'm', content: 'alpha', backlinks: [], frontmatter: { type: 'fact', tags: [] } } as any],
        reranker: () => ({ rerank: async (_q: string, p: string[]) => p.map(() => 0), dispose() {} }) as any,
        sources: () => new Promise<SourceHit[]>(res => setTimeout(() => res(files), srcMs)),
        timeChats,
        rerankTimeoutMs,
        now: () => NOW.getTime(),
        vault: '/v',
    })

test('service: a slow ordinary path does not drop the time path', async () => {
    const r = await mkSlow(150, async () => [chat('c1', '2026-11-05', 0.8)], 80).recall({ mode: 'prompt', sessionId: 's', prompt: 'what did we do yesterday' })
    expect(r.context ?? '').toContain('# Past chats')
    expect(r.sources ?? []).toContain('chat:c1')
})

test('service: a slow time path runs beside the ordinary path, not after it', async () => {
    const t0 = Date.now()
    await mkSlow(200, () => new Promise<SourceHit[]>(res => setTimeout(() => res([chat('c9', '2026-11-05', 0.8)]), 5000)), 700).recall({
        mode: 'prompt',
        sessionId: 's3',
        prompt: 'what did we do yesterday',
    })
    expect(Date.now() - t0).toBeLessThan(800) // deadline counts from creation: ~700, not 200 + 700 in series
})
