import { test, expect, afterAll } from 'bun:test'
import { mkdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import {
    createRecallService,
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

// Fakes: a note scores 1 per query word its content contains; packing takes every non-excluded
// match, hashed by content.
const counts = { build: 0 }
const fakeEngine = {
    buildRecallIndex: (notes: MemoryNote[]) => {
        counts.build++
        return { notes } as any
    },
    rankNotes: (index: any, q: { primary: string }) =>
        (index.notes as MemoryNote[])
            .map(note => ({
                note,
                lexical: q.primary
                    .split(/\s+/)
                    .filter(w => w && note.content.includes(w)).length,
                score: 0,
            }))
            .map(r => ({ ...r, score: r.lexical }))
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

    svc.reset('s')
    expect((await svc.recall(tool())).injected).toEqual(['a'])

    expect((await svc.recall(tool())).reason).toBe('no-match')
    await svc.recall({ mode: 'session-start', sessionId: 's', source: 'compact' })
    expect((await svc.recall(tool())).injected).toEqual(['a'])

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
