import { test, expect, afterAll } from 'bun:test'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    createRecallService,
    readRecallSettingsSync,
    recallWithin,
    type RecallDeps,
    type RecallEngine,
    type RecallRequest,
    type RecallSettings,
} from '../src/memoryRecall'
import { tempDir, sweepTempDirs } from './tempDirs'
import { createServer } from '../src/server'
import { makeSampleVault } from './helpers'
import { agentPrompts } from '@bismuth/memory'
import type { MemoryNote } from '@bismuth/memory'

afterAll(sweepTempDirs)

const mkNote = (name: string, content: string): MemoryNote =>
    ({
        name,
        content,
        backlinks: [],
        frontmatter: { type: 'fact' },
    }) as unknown as MemoryNote

// Fakes: a note scores 1 per query word its content contains, plus its cosine when a semantic map
// is passed (a note with a cosine and no word is a semantic-only hit); packing takes every
// non-excluded match, hashed by content.
const counts = { build: 0 }
const fakeEngine = {
    buildRecallIndex: (notes: MemoryNote[]) => {
        counts.build++
        return { notes } as any
    },
    rankNotes: (index: any, q: { primary: string }, opts?: { semantic?: Map<string, number> }) =>
        (index.notes as MemoryNote[])
            .map(note => ({
                note,
                lexical: q.primary
                    .split(/\s+/)
                    .filter(w => w && note.content.includes(w)).length,
                score: 0,
            }))
            .map(r => ({ ...r, score: r.lexical + (opts?.semantic?.get(r.note.name) ?? 0) }))
            .filter(r => r.score > 0),
    packRecall: (ranked: any[], _mode: string, exclude?: Set<string>) => {
        const kept = ranked.filter(r => !exclude?.has(r.note.name))
        return {
            text: kept.length ? kept.map(r => r.note.name).join(',') : null,
            injected: kept.map(r => ({
                name: r.note.name,
                hash: r.note.content,
            })),
        }
    },
    formatSessionStart: (notes: MemoryNote[]) => `index:${notes.length}`,
    noteHash: (n: MemoryNote) => n.content,
    contextFromTranscript: () => '',
    queryFromToolCalls: (calls: any[]) => calls.map(c => c.tool_input).join(' '),
    lastAgentPrompt: () => 'alpha',
} as unknown as RecallEngine

function make(over: Partial<RecallDeps> = {}, settings?: Partial<RecallSettings>) {
    let notes = [mkNote('a', 'alpha one'), mkNote('b', 'beta two')]
    const state = {
        settings: { enabled: true, midTurn: true, semantic: true, ...settings },
        embedderCalls: 0,
        dir: '/mem' as string | null,
    }
    const svc = createRecallService({
        memoryDir: () => state.dir,
        settings: () => state.settings,
        embedder: () => {
            state.embedderCalls++
            return null
        },
        engine: fakeEngine,
        loadNotes: async () => notes,
        ...over,
    })
    return { svc, state, setNotes: (n: MemoryNote[]) => (notes = n) }
}

const prompt = (sessionId = 's', extra = {}): RecallRequest => ({
    mode: 'prompt',
    sessionId,
    prompt: 'alpha',
    ...extra,
})
const tool = (sessionId = 's', extra = {}): RecallRequest => ({
    mode: 'tool',
    sessionId,
    toolCalls: [{ tool_name: 'Read', tool_input: 'alpha' }],
    ...extra,
})

test('enabled:false disables every mode', async () => {
    const { svc } = make({}, { enabled: false })
    for (const mode of ['prompt', 'tool', 'session-start', 'subagent'] as const) {
        const r = await svc.recall({ mode, sessionId: 's', prompt: 'alpha' })
        expect(r).toEqual({ context: null, injected: [], reason: 'disabled' })
    }
})

test('midTurn:false blocks tool mode only', async () => {
    const { svc } = make({}, { midTurn: false })
    expect((await svc.recall(tool())).reason).toBe('mid-turn-off')
    expect((await svc.recall(prompt())).context).toBe('a')
})

test('daemon off is no-memory', async () => {
    const { svc, state } = make()
    state.dir = null
    expect((await svc.recall(prompt())).reason).toBe('no-memory')
})

test('a prompt-injected note is not re-injected by a tool call, until reset / compact / change', async () => {
    const { svc, setNotes } = make()
    expect((await svc.recall(prompt())).injected).toEqual(['a'])
    expect((await svc.recall(tool())).reason).toBe('no-match')

    // a prompt that matches nothing opens a new turn, so the per-turn tool cap stays out of the way
    const nextTurn = () => svc.recall(prompt('s', { prompt: 'zzz' }))
    svc.reset('s')
    expect((await svc.recall(tool())).injected).toEqual(['a'])

    await nextTurn()
    expect((await svc.recall(tool())).reason).toBe('no-match')
    await svc.recall({ mode: 'session-start', sessionId: 's', source: 'compact' })
    expect((await svc.recall(tool())).injected).toEqual(['a'])

    await nextTurn()
    expect((await svc.recall(tool())).reason).toBe('no-match')
    setNotes([mkNote('a', 'alpha one changed'), mkNote('b', 'beta two')])
    expect((await svc.recall(tool())).injected).toEqual(['a'])
})

test('session-start with source startup does not reset the ledger', async () => {
    const { svc } = make()
    await svc.recall(prompt())
    await svc.recall({ mode: 'session-start', sessionId: 's', source: 'startup' })
    expect((await svc.recall(tool())).reason).toBe('no-match')
})

test('subagent ledgers are separate from the parent', async () => {
    const { svc } = make()
    expect((await svc.recall(prompt('s'))).injected).toEqual(['a'])
    expect((await svc.recall(prompt('s', { agentId: 'x' }))).injected).toEqual(['a'])
    expect((await svc.recall(prompt('s', { agentId: 'x' }))).reason).toBe('no-match')
    expect((await svc.recall(prompt('s'))).reason).toBe('no-match')
})

test('ledger entries expire after 6h idle', async () => {
    let t = 0
    const { svc } = make({ now: () => t })
    await svc.recall(prompt())
    t = 6 * 3600 * 1000 + 1
    expect((await svc.recall(prompt())).injected).toEqual(['a'])
})

test('semantic:false never calls embedder()', async () => {
    const { svc, state } = make({}, { semantic: false })
    await svc.recall(prompt())
    await svc.recall(tool())
    expect(state.embedderCalls).toBe(0)
    state.settings.semantic = true
    await svc.recall(prompt('other'))
    expect(state.embedderCalls).toBe(1)
})

test('the index rebuilds only when a note changes, with no re-read otherwise', async () => {
    const dir = tempDir('recall-')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'alpha-note.md')
    await Bun.write(path, '---\nname: alpha-note\ntype: fact\n---\nalpha body\n')
    counts.build = 0
    const { svc } = make({ loadNotes: undefined, memoryDir: () => dir })
    await svc.recall(prompt('s1'))
    await svc.recall(prompt('s2'))
    expect(counts.build).toBe(1)

    await Bun.write(path, '---\nname: alpha-note\ntype: fact\n---\nalpha body edited longer\n')
    const later = new Date(Date.now() + 5000)
    utimesSync(path, later, later)
    await svc.recall(prompt('s3'))
    expect(counts.build).toBe(2)
})

test('POST /memory/recall: malformed body 400, valid body 200 JSON', async () => {
    const { vault, memory } = await makeSampleVault()
    const server = createServer({ vault, memory, port: 0 })
    const post = (body: unknown) =>
        fetch(`http://localhost:${server.port}/memory/recall`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        })
    try {
        expect((await post({ mode: 'nope', sessionId: 's' })).status).toBe(400)
        expect((await post({ mode: 'prompt' })).status).toBe(400)
        expect((await post('{not json')).status).toBe(400)
        const good = await post({ mode: 'prompt', sessionId: 's', prompt: 'x' })
        expect(good.status).toBe(200)
        const body = (await good.json()) as { context: unknown; reason: string }
        expect(body.context).toBeNull()
        expect(body.reason).toBe('no-memory') // sample vault has the daemon off
    } finally {
        await server.stop(true)
    }
})

test('a recall that outlives its deadline injects nothing and does not burn the ledger', async () => {
    const { svc } = make({
        loadNotes: async () => {
            await new Promise(r => setTimeout(r, 80))
            return [mkNote('a', 'alpha one'), mkNote('b', 'beta two')]
        },
    })
    const timedOut = await recallWithin(svc, prompt(), 20)
    expect(timedOut.context).toBeNull()
    await new Promise(r => setTimeout(r, 150))
    expect((await svc.recall(prompt())).injected).toEqual(['a'])
})

test('an aborted request signal keeps the recall out of the ledger', async () => {
    const { svc } = make()
    const ac = new AbortController()
    const p = svc.recall(prompt('s', { signal: ac.signal }))
    ac.abort()
    await p
    expect((await svc.recall(prompt())).injected).toEqual(['a'])
})

test('parallel subagents each claim a different Agent tool_use, per parent session', async () => {
    const entries = [
        {
            type: 'assistant',
            message: {
                role: 'assistant',
                content: ['alpha', 'beta', 'gamma'].map((p, i) => ({
                    type: 'tool_use',
                    id: `t${i}`,
                    name: 'Agent',
                    input: { prompt: p },
                })),
            },
        },
    ]
    const engine = {
        ...(fakeEngine as any),
        agentPrompts: (es: any[]) =>
            es[0].message.content.map((b: any) => ({ id: b.id, prompt: b.input.prompt })),
        lastAgentPrompt: () => 'gamma',
    } as RecallEngine
    const { svc } = make({
        engine,
        loadNotes: async () => [
            mkNote('a', 'alpha one'),
            mkNote('b', 'beta two'),
            mkNote('c', 'gamma three'),
        ],
        readTranscript: async () => entries as any,
    })
    const sub = (sessionId: string, agentId: string): RecallRequest => ({
        mode: 'subagent',
        sessionId,
        agentId,
        transcriptPath: '/t.jsonl',
    })
    const got = []
    for (const id of ['x', 'y', 'z']) got.push((await svc.recall(sub('s', id))).injected)
    expect(got).toEqual([['a'], ['b'], ['c']])
    // claims are per parent session: another session starts from the first prompt again
    expect((await svc.recall(sub('s2', 'x'))).injected).toEqual(['a'])
    // all claimed: falls back to req.prompt
    expect((await svc.recall({ ...sub('s', 'w'), prompt: 'beta' })).injected).toEqual(['b'])
})

test('a fresh service skips already-resolved Agent tool_uses and serves the pending one', async () => {
    const tu = (id: string, prompt: string) => ({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { prompt } }] },
    })
    const tr = (id: string) => ({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
    })
    const entries = [tu('t1', 'alpha'), tr('t1'), tu('t2', 'beta')]
    const engine = { ...(fakeEngine as any), agentPrompts, lastAgentPrompt: () => 'beta' } as RecallEngine
    const { svc } = make({
        engine,
        loadNotes: async () => [mkNote('a', 'alpha one'), mkNote('b', 'beta two')],
        readTranscript: async () => entries as any,
    })
    const r = await svc.recall({ mode: 'subagent', sessionId: 's', agentId: 'x', transcriptPath: '/t.jsonl' })
    expect(r.injected).toEqual(['b'])
})

test('a compact while recall is disabled still clears the ledger', async () => {
    const { svc, state } = make()
    await svc.recall(prompt())
    state.settings.enabled = false
    await svc.recall({ mode: 'session-start', sessionId: 's', source: 'compact' })
    state.settings.enabled = true
    expect((await svc.recall(tool())).injected).toEqual(['a'])
})

test('a prompt is ranked without the editor-context block the app prepends', async () => {
    const { svc } = make()
    const r = await svc.recall(
        prompt('s', { prompt: '<editor-context>\nActive pane: beta\n</editor-context>\n\nalpha' }),
    )
    expect(r.injected).toEqual(['a'])
})

test('one tool batch injects per turn; the next prompt opens a new turn', async () => {
    const { svc, setNotes } = make()
    setNotes([mkNote('a', 'alpha one'), mkNote('b', 'beta two'), mkNote('c', 'gamma three')])
    const call = (w: string, extra = {}) =>
        tool('s', { toolCalls: [{ tool_name: 'Read', tool_input: w }], ...extra })
    expect((await svc.recall(call('alpha'))).injected).toEqual(['a'])
    expect((await svc.recall(call('beta'))).reason).toBe('turn-budget')
    await svc.recall(prompt('s', { prompt: 'zzz' }))
    // a batch that matched nothing does not spend the turn
    expect((await svc.recall(call('zzz'))).reason).toBe('no-match')
    expect((await svc.recall(call('beta'))).injected).toEqual(['b'])
    expect((await svc.recall(call('gamma'))).reason).toBe('turn-budget')
    // each subagent has its own turn
    expect((await svc.recall(call('gamma', { agentId: 'w' }))).injected).toEqual(['c'])
})

test('the tokenless recall path never returns a visibility:hidden note', async () => {
    const dir = tempDir('recall-vis-')
    mkdirSync(dir, { recursive: true })
    await Bun.write(
        join(dir, 'secret.md'),
        '---\nname: secret\ntype: fact\nvisibility: hidden\n---\nalpha hidden body\n',
    )
    await Bun.write(join(dir, 'open.md'), '---\nname: open\ntype: fact\n---\nalpha open body\n')
    const svc = createRecallService({
        memoryDir: () => dir,
        settings: () => ({ enabled: true, midTurn: true, semantic: false }),
        embedder: () => null,
    })
    const r = await svc.recall({ mode: 'prompt', sessionId: 'v', prompt: 'alpha' })
    expect(r.injected).toContain('open')
    expect(r.injected).not.toContain('secret')
    expect(r.context ?? '').not.toContain('secret')
    const start = await svc.recall({ mode: 'session-start', sessionId: 'v' })
    expect(start.context ?? '').not.toContain('secret')
    expect(start.context ?? '').toContain('open')
})

// --- relevance gate (reranker) ---------------------------------------------------------------

const fullNote = (name: string, content: string): MemoryNote =>
    ({
        name,
        content,
        backlinks: [],
        frontmatter: { type: 'fact', tags: ['t'], description: `about ${name}` },
    }) as unknown as MemoryNote
// semantic-only hits: neither note holds the prompt word, so the keyword-only path packs nothing and
// the gate alone decides
const gateNotes = () => [fullNote('a', 'one'), fullNote('b', 'two')]
const alphaNotes = () => [fullNote('a', 'alpha one'), fullNote('b', 'alpha two')]
const semOn = async () =>
    new Map([
        ['a', 0.9],
        ['b', 0.8],
    ])
const rr = (logits: number[] | (() => Promise<number[]>)) => {
    const calls: { query: string; passages: string[] }[] = []
    const reranker = {
        rerank: async (query: string, passages: string[]) => {
            calls.push({ query, passages })
            return typeof logits === 'function' ? logits() : logits
        },
        dispose() {},
    }
    return { calls, reranker }
}
const gateSvc = (reranker: any, over: Partial<RecallDeps> = {}, settings?: Partial<RecallSettings>) =>
    make({
        loadNotes: async () => gateNotes(),
        embedder: () => ({ embed: async () => [], dispose() {} }),
        semanticScores: semOn,
        reranker: () => reranker,
        ...over,
    }, settings)

test('rerank gate: candidates are judged against the prompt, packed in gate order, response says reranked', async () => {
    const { calls, reranker } = rr([-5, 4])
    const { svc } = gateSvc(reranker)
    const r = await svc.recall(prompt())
    expect(calls).toHaveLength(1)
    expect(calls[0]!.query).toBe('alpha')
    expect(calls[0]!.passages).toHaveLength(2)
    expect(calls[0]!.passages[0]).toContain('## a (fact)')
    expect(r.injected).toEqual(['b'])
    expect(r.reranked).toBe(true)
    expect(r.semantic).toBe(true)
})

// since keyword picks are always kept, this pins the response flags for a lexical-first note, not the gate bar (rerankGate.test.ts pins -6)
test('rerank gate: a paraphrase whose note ranks first lexically is injected, semantic and reranked true', async () => {
    // the cross-encoder reads a paraphrase low (-5.5) but above the bar; the note is also the lexical first
    const { reranker } = rr([-5.5, -9])
    const { svc } = gateSvc(reranker, { loadNotes: async () => [fullNote('a', 'alpha one'), fullNote('b', 'two')] })
    const r = await svc.recall(prompt())
    expect(r.injected).toEqual(['a'])
    expect(r.semantic).toBe(true)
    expect(r.reranked).toBe(true)
})

test('rerank gate: a terse prompt reaches the reranker with the conversation tail', async () => {
    const { calls, reranker } = rr([-5, 4])
    const engine = {
        ...(fakeEngine as any),
        contextFromTranscript: () => 'we were tuning the ranker',
    } as RecallEngine
    const { svc } = gateSvc(reranker, {
        engine,
        readTranscript: async () => [{ type: 'user' }] as any,
    })
    await svc.recall({ mode: 'prompt', sessionId: 's', prompt: 'alpha', transcriptPath: '/t.jsonl' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.query).toBe('alpha\nwe were tuning the ranker')
})

test('rerank gate: an empty gate injects nothing', async () => {
    const { reranker } = rr([-9, -9])
    const { svc } = gateSvc(reranker)
    const r = await svc.recall(prompt())
    expect(r).toMatchObject({ context: null, injected: [], reason: 'no-match', reranked: true })
})

test('rerank gate: subagent mode is gated too', async () => {
    const { calls, reranker } = rr([3, -9])
    const { svc } = gateSvc(reranker)
    const r = await svc.recall({ mode: 'subagent', sessionId: 's', prompt: 'alpha' })
    expect(calls).toHaveLength(1)
    expect(r.injected).toEqual(['a'])
    expect(r.reranked).toBe(true)
})

test('rerank gate: tool mode never calls the reranker', async () => {
    const { calls, reranker } = rr([3, 3])
    const { svc } = gateSvc(reranker)
    const r = await svc.recall(tool())
    expect(calls).toHaveLength(0)
    expect(r.reranked).toBeUndefined()
    expect(r.injected).toEqual(['a', 'b'])
})

test('rerank gate: without semantic scores the reranker is not asked', async () => {
    const { calls, reranker } = rr([3, 3])
    const { svc } = gateSvc(reranker, { semanticScores: async () => undefined, loadNotes: async () => alphaNotes() })
    const r = await svc.recall(prompt())
    expect(calls).toHaveLength(0)
    expect(r.injected).toEqual(['a', 'b'])
})

test('rerank gate: absent, null, or rejecting reranker = today behaviour', async () => {
    const base = await gateSvc(null).svc.recall(prompt())
    expect(base.injected).toEqual(['a', 'b'])
    expect(base.reranked).toBeUndefined()
    const { reranker } = rr(async () => {
        throw new Error('boom')
    })
    const r = await gateSvc(reranker).svc.recall(prompt())
    expect(r.injected).toEqual(['a', 'b'])
    expect(r.reranked).toBeUndefined()
    const wrong = await gateSvc(rr([1]).reranker).svc.recall(prompt())
    expect(wrong.injected).toEqual(['a', 'b'])
})

test('rerank gate: a reranker slower than the timeout falls back, promptly', async () => {
    const { reranker } = rr(() => new Promise<number[]>(() => {}))
    const { svc } = gateSvc(reranker, { rerankTimeoutMs: 40 })
    const t0 = performance.now()
    const r = await svc.recall(prompt())
    const took = performance.now() - t0
    expect(r.injected).toEqual(['a', 'b'])
    expect(r.reranked).toBeUndefined()
    expect(took).toBeGreaterThanOrEqual(35)
    expect(took).toBeLessThan(400)
})

test('rerank gate: notes already in the ledger are not candidates', async () => {
    const { calls, reranker } = rr([3])
    const { svc } = gateSvc(reranker)
    await svc.recall(tool()) // ledger now holds a and b (tool mode, ungated)
    const r = await svc.recall(prompt())
    expect(calls).toHaveLength(0)
    expect(r.reason).toBe('no-match')
})

test('rerank gate: a note between minScore and semanticMinScore is not a candidate and not injected', async () => {
    const { calls, reranker } = rr([9, 9])
    const real = await import('@bismuth/memory')
    const engine = {
        ...(fakeEngine as any),
        // ranked with semantics, b at 0.1 sits above prompt minScore (0.08) and below semanticMinScore
        // (0.12); a clears both. Keyword-only, b reads 0.05, so that path does not pack it either.
        rankNotes: (index: any, _q: unknown, opts?: { semantic?: Map<string, number> }) =>
            (index.notes as MemoryNote[]).map((note, i) => ({
                note,
                lexical: 1,
                score: i === 0 ? 0.5 : opts?.semantic ? 0.1 : 0.05,
            })),
        packRecall: real.packRecall,
        noteHash: real.noteHash,
    } as unknown as RecallEngine
    const gated = await gateSvc(reranker, { engine }).svc.recall(prompt())
    expect(calls[0]!.passages).toHaveLength(1)
    expect(calls[0]!.passages[0]).toContain('## a (fact)')
    expect(gated.injected).toEqual(['a'])
})

// --- embeddings on never recall less than off -------------------------------------------------

const realPackEngine = async (over: Record<string, unknown> = {}) => {
    const real = await import('@bismuth/memory')
    return {
        ...(fakeEngine as any),
        packRecall: real.packRecall,
        noteHash: real.noteHash,
        ...over,
    } as unknown as RecallEngine
}

test('embeddings on: a note the keyword-only path injects survives a reranker that scores it -11; a note neither path admits stays out', async () => {
    // k holds the prompt word (the keyword-only path packs it); s is a semantic-only candidate
    const notes = [fullNote('k', 'alpha one'), fullNote('s', 'two')]
    const sem = async () =>
        new Map([
            ['k', 0.9],
            ['s', 0.8],
        ])
    const engine = await realPackEngine()
    const refused = rr([-11, -11])
    const r = await gateSvc(refused.reranker, { engine, loadNotes: async () => notes, semanticScores: sem }).svc.recall(prompt())
    expect(refused.calls[0]!.passages).toHaveLength(2)
    expect(r.injected).toEqual(['k'])
    expect(r.context).toContain('## k (fact)')
    expect(r.context).not.toContain('## s (fact)')
    expect(r).toMatchObject({ semantic: true, reranked: true })
    // the gate admits s on its own and refuses k: s keeps its place, k follows it
    const mixed = rr([-11, 4])
    const both = await gateSvc(mixed.reranker, { engine, loadNotes: async () => notes, semanticScores: sem }).svc.recall(prompt())
    expect(both.injected).toEqual(['s', 'k'])
})

test('embeddings on: past maxNotes the gate picks give way from the tail, never a keyword pick', async () => {
    // five semantic-only notes fill the gate's candidates and the prompt maxNotes; k is the keyword pick
    const sems = ['s1', 's2', 's3', 's4', 's5']
    const notes = [...sems.map(n => fullNote(n, `${n} body`)), fullNote('k', 'alpha one')]
    const sem = async () => new Map(sems.map(n => [n, 0.9] as [string, number]))
    const { calls, reranker } = rr([4, 4, 4, 4, 4])
    const engine = await realPackEngine()
    const r = await gateSvc(reranker, { engine, loadNotes: async () => notes, semanticScores: sem }).svc.recall(prompt())
    expect(calls[0]!.passages).toHaveLength(5)
    expect(r.injected).toEqual(['s1', 's2', 's3', 's4', 'k'])
})

test('embeddings on: the keyword picks are the off service picks for the same request', async () => {
    const notes = [fullNote('k', 'alpha one'), fullNote('j', 'alpha beta'), fullNote('s', 'two')]
    const engine = await realPackEngine()
    const off = await gateSvc(rr([]).reranker, { engine, loadNotes: async () => notes }, { semantic: false }).svc.recall(prompt())
    const sem = async () => new Map([['s', 0.9]])
    const on = await gateSvc(rr([-11, -11, -11]).reranker, { engine, loadNotes: async () => notes, semanticScores: sem }).svc.recall(prompt())
    expect(off.injected).toEqual(['k', 'j'])
    expect(on.injected).toEqual(off.injected)
})

test('embeddings off: one keyword ranking, no reranker, no second pass', async () => {
    const opts: unknown[] = []
    const engine = await realPackEngine({
        rankNotes: (index: any, q: any, o: any) => {
            opts.push(o)
            return (fakeEngine as any).rankNotes(index, q, o)
        },
    })
    const { calls, reranker } = rr([4, 4])
    const r = await gateSvc(reranker, { engine, loadNotes: async () => alphaNotes() }, { semantic: false }).svc.recall(prompt())
    expect(calls).toHaveLength(0)
    expect(opts).toHaveLength(1)
    expect((opts[0] as { semantic?: unknown }).semantic).toBeUndefined()
    expect(r.injected).toEqual(['a', 'b'])
    expect(r.semantic).toBeUndefined()
})

test('embeddings on, no reranker: a keyword pick under semanticMinScore is lifted and injected', async () => {
    const notes = [fullNote('s1', 'one'), fullNote('k', 'alpha two')]
    const engine = await realPackEngine({
        rankNotes: (index: any, _q: unknown, o?: { semantic?: Map<string, number> }) =>
            (index.notes as MemoryNote[])
                .map(note => ({ note, lexical: 1, score: note.name === 'k' ? 0.09 : o?.semantic ? 0.5 : 0 }))
                .filter(r => r.score > 0),
    })
    const r = await gateSvc(null, { engine, loadNotes: async () => notes, semanticScores: async () => new Map([['s1', 0.9]]) }).svc.recall(prompt())
    expect(r.injected).toEqual(['s1', 'k'])
})

// --- graph-aware recall ----------------------------------------------------------------------

const linkNote = (name: string, backlinks: string[], content = `${name} body`): MemoryNote =>
    ({
        name,
        content,
        backlinks,
        frontmatter: { type: 'fact', tags: [], description: `about ${name}` },
    }) as unknown as MemoryNote
const editorCtx = (active: string, rest = 'what now') =>
    `<editor-context>\nActive file: ${active}\n</editor-context>\n\n${rest}`
// real engine (no fakes): headers, marks and pointers come from the real packer
const realSvc = (notes: MemoryNote[], over: Partial<RecallDeps> = {}) =>
    createRecallService({
        memoryDir: () => '/mem',
        settings: () => ({ enabled: true, midTurn: true, semantic: false }),
        embedder: () => null,
        loadNotes: async () => notes,
        vault: '/vault',
        ...over,
    })

test('link boost: a note linking the active file is injected without a word match, marked', async () => {
    const svc = realSvc([linkNote('dream-log', ['projects/plan']), linkNote('stray', ['elsewhere'])])
    const r = await svc.recall({ mode: 'prompt', sessionId: 's', prompt: editorCtx('projects/plan.md', 'zzzz') })
    expect(r.injected).toEqual(['dream-log'])
    expect(r.context).toContain('## dream-log (fact) [] (about the open note)')
    // the per-session ledger still dedups it
    const again = await svc.recall({ mode: 'prompt', sessionId: 's', prompt: editorCtx('projects/plan.md', 'zzzz') })
    expect(again.injected).toEqual([])
})

test('link boost: at most 2 prompt notes, ahead of ranked notes; none without editor context', async () => {
    const notes = [
        linkNote('b1', ['plan']),
        linkNote('b2', ['plan']),
        linkNote('b3', ['plan']),
        linkNote('ranked', [], 'zebra stripes'),
    ]
    const svc = realSvc(notes)
    const r = await svc.recall({ mode: 'prompt', sessionId: 's', prompt: editorCtx('plan.md', 'zebra stripes') })
    expect(r.injected.slice(0, 2)).toEqual(['b1', 'b2'])
    expect(r.injected).toContain('ranked')
    expect(r.injected).not.toContain('b3')
    const plain = await realSvc(notes).recall({ mode: 'prompt', sessionId: 'p', prompt: 'zebra stripes' })
    expect(plain.injected).toEqual(['ranked'])
})

test('link boost: tool mode takes 1 note from a file the batch touched, inside the vault only', async () => {
    const notes = [linkNote('t1', ['plan']), linkNote('t2', ['plan'])]
    const call = (file_path: string) => ({
        mode: 'tool' as const,
        sessionId: 's',
        toolCalls: [{ tool_name: 'Edit', tool_input: { file_path } }],
    })
    expect((await realSvc(notes).recall(call('/vault/projects/plan.md'))).injected).toEqual(['t1'])
    expect((await realSvc(notes).recall(call('/elsewhere/plan.md'))).injected).toEqual([])
})

test('link boost: pointers prefer wikilink neighbours of the injected notes', async () => {
    const notes = [
        ...[1, 2, 3, 4, 5, 6, 7].map(i => linkNote(`m${i}`, i === 1 ? ['nb'] : [], 'zebra stripes')),
        linkNote('nb', [], 'quiet badger'),
        ...Array.from({ length: 30 }, (_, i) => linkNote(`f${i}`, [], `filler${i} words${i}`)),
    ]
    const r = await realSvc(notes).recall({ mode: 'prompt', sessionId: 's', prompt: 'zebra stripes' })
    expect(r.injected).not.toContain('nb')
    const pointers = (r.context ?? '').split('Also related notes')[1] ?? ''
    expect(pointers).toContain('[[nb]]')
    expect(pointers.indexOf('[[nb]]')).toBeLessThan(pointers.indexOf('[[m6]]'))
    expect(pointers).toContain('[[m6]]')
})

test('session-start returns the brain block; no vault or an empty brain falls back to the index', async () => {
    const calls: unknown[] = []
    const brain = async (o: unknown) => (calls.push(o), 'BRAIN BLOCK')
    const { svc } = make({ vault: '/vault', brain })
    expect((await svc.recall({ mode: 'session-start', sessionId: 's' })).context).toBe('BRAIN BLOCK')
    expect(calls).toEqual([{ vaultDir: '/vault', memoryDir: '/mem', channel: 'daemon' }])
    calls.length = 0
    await svc.recall({ mode: 'session-start', sessionId: 's2', channel: 'chat' })
    expect(calls).toEqual([{ vaultDir: '/vault', memoryDir: '/mem', channel: 'chat' }])
    expect((await make({ brain }).svc.recall({ mode: 'session-start', sessionId: 's' })).context).toBe('index:2')
    const empty = make({ vault: '/vault', brain: async () => null })
    expect((await empty.svc.recall({ mode: 'session-start', sessionId: 's' })).context).toBe('index:2')
    const { svc: off } = make({ vault: '/vault', brain }, { enabled: false })
    expect((await off.recall({ mode: 'session-start', sessionId: 's' })).reason).toBe('disabled')
})

// --- vault map on an empty memory dir, pointer title in excerpts, `$` in names, embeddings switch ---

test('session-start composes the vault map from an empty memory dir; other modes stay no-memory', async () => {
    const brain = async () => '# Vault map\n- a'
    const { svc } = make({ vault: '/vault', brain, loadNotes: async () => [] })
    const start = await svc.recall({ mode: 'session-start', sessionId: 's' })
    expect(start.context).toContain('# Vault map')
    expect((await svc.recall(prompt())).reason).toBe('no-memory')
    expect((await svc.recall(tool())).reason).toBe('no-memory')
    // no vault, or an empty brain: nothing to say
    const bare = make({ loadNotes: async () => [] })
    expect((await bare.svc.recall({ mode: 'session-start', sessionId: 's' })).reason).toBe('no-memory')
    const empty = make({ vault: '/vault', brain: async () => null, loadNotes: async () => [] })
    expect((await empty.svc.recall({ mode: 'session-start', sessionId: 's' })).reason).toBe('no-memory')
})

test('link boost: an excerpt holding the pointer title line does not hide the real pointer list', async () => {
    const title = 'Also related notes (not included; read the file if needed):'
    const notes = [
        linkNote('m1', ['nb'], `zebra stripes\n${title}\nstray prose line`),
        linkNote('m2', [], 'zebra stripes'),
        linkNote('nb', [], 'quiet badger'),
        ...Array.from({ length: 30 }, (_, i) => linkNote(`f${i}`, [], `filler${i} words${i}`)),
    ]
    const r = await realSvc(notes).recall({ mode: 'prompt', sessionId: 's', prompt: 'zebra stripes' })
    const ctx = r.context ?? ''
    expect(r.injected).toContain('m1')
    expect(ctx).toContain(`${title}\nstray prose line`)
    const real = ctx.slice(ctx.lastIndexOf(title))
    expect(real).toContain('[[nb]]')
    expect(real).not.toContain('stray prose line')
    // the excerpt's quote and the one rewritten list; the packer's own list was replaced, not duplicated
    expect(ctx.split(title).length).toBe(3)
})

test('link boost: a boosted note named or tagged with $ patterns gets exactly one mark', async () => {
    const note = {
        name: 'cost-$&-$\'',
        content: 'body',
        backlinks: ['plan'],
        frontmatter: { type: 'fact', tags: ['$&', "$'"], description: 'about it' },
    } as unknown as MemoryNote
    const r = await realSvc([note]).recall({ mode: 'prompt', sessionId: 's', prompt: editorCtx('plan.md', 'zzzz') })
    const header = "## cost-$&-$' (fact) [$&, $']"
    expect(r.context).toContain(header + ' (about the open note)')
    expect((r.context ?? '').split('(about the open note)').length).toBe(2)
})

test('readRecallSettingsSync: semantic follows embeddings.enabled, not daemon.recall.semantic', () => {
    const vault = tempDir('recall-settings-')
    mkdirSync(vault, { recursive: true })
    const read = (body?: string) => {
        if (body !== undefined) writeFileSync(join(vault, '.settings'), body)
        return readRecallSettingsSync(vault).semantic
    }
    expect(read()).toBe(false)
    expect(read('embeddings:\n  enabled: true\n')).toBe(true)
    expect(read('embeddings:\n  enabled: false\n')).toBe(false)
    expect(read('daemon:\n  recall:\n    semantic: true\n')).toBe(false)
})
