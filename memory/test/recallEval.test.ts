import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { PACK_LIMITS } from '../src/pack'
import { logitGate } from '../../core/test/gateStub'
import type { CaseRun } from '../../bench/recallEval'
import {
    createServiceRunner,
    evaluate,
    findings,
    isSubagentCase,
    isToolCase,
    loadCases,
    loadSourceFixture,
    memoryExpect,
    prepare,
    summarize,
    sweepGrid,
} from '../../bench/recallEval'

const DIR = join(import.meta.dir, 'fixtures', 'recallGraph')
const CASES = loadCases(join(import.meta.dir, 'fixtures', 'recallCases.json'))
const promptCases = CASES.filter(c => !isToolCase(c) && !isSubagentCase(c))
const toolCases = CASES.filter(isToolCase)

describe('recall eval (synthetic graph)', () => {
    test('the suite has the shapes the eval is meant to cover', async () => {
        const p = await prepare(DIR)
        expect(p.notes.length).toBeGreaterThanOrEqual(40)
        expect(Math.max(...p.notes.map(n => n.content.length))).toBeGreaterThan(50_000)
        expect(promptCases.length).toBeGreaterThanOrEqual(30)
        expect(promptCases.filter(c => c.context).length).toBeGreaterThanOrEqual(4)
        expect(promptCases.filter(c => c.expect.length === 0).length).toBeGreaterThanOrEqual(35)
        expect(toolCases.length).toBeGreaterThanOrEqual(4)
        // every expected name is a real note
        const names = new Set(p.notes.map(n => n.name))
        for (const c of CASES) for (const e of c.expect) expect(names.has(e)).toBe(true)
    })

    test('bm25 beats legacy on recall@5 and on mean injected chars (prompt mode)', async () => {
        const p = await prepare(DIR)
        const legacy = (await evaluate(p, 'legacy', promptCases)).summary
        const bm25 = (await evaluate(p, 'bm25', promptCases)).summary
        expect(bm25.recall5).toBeGreaterThan(legacy.recall5)
        expect(bm25.recall5).toBeGreaterThanOrEqual(0.9)
        expect(bm25.mrr).toBeGreaterThan(legacy.mrr)
        expect(bm25.falseInject).toBeLessThanOrEqual(legacy.falseInject)
        expect(bm25.meanChars).toBeLessThan(legacy.meanChars * 0.6)
    })

    test('follow-ups with a context tail find their note', async () => {
        const p = await prepare(DIR)
        const followUps = promptCases.filter(c => c.context)
        const bm25 = (await evaluate(p, 'bm25', followUps)).summary
        expect(bm25.recall5).toBe(1)
    })

    test('tool mode: right notes, and the tool minScore gates some unrelated calls', async () => {
        const p = await prepare(DIR)
        const bm25 = (await evaluate(p, 'bm25', toolCases)).summary
        expect(bm25.recall5).toBe(1)
        // the tool minScore (0.21) keeps most unrelated tool calls from injecting
        expect(bm25.falseInject).toBeLessThanOrEqual(0.5)
    })

    test('realistic tool payloads: full paths and bodies find their note, unrelated ones stay silent', async () => {
        const p = await prepare(DIR)
        const realistic = toolCases.filter(c => c.realistic)
        expect(realistic.length).toBeGreaterThanOrEqual(10)
        expect(realistic.filter(c => c.expect.length === 0).length).toBeGreaterThanOrEqual(5)
        const bm25 = (await evaluate(p, 'bm25', realistic)).summary
        expect(bm25.recall5).toBe(1)
        expect(bm25.falseInject).toBe(0)
    })

    test('pinned bm25 rows (deterministic, no model): the numbers the docs quote', async () => {
        const p = await prepare(DIR)
        const prompt = (await evaluate(p, 'bm25', promptCases)).summary
        expect(prompt.cases).toBe(promptCases.length)
        expect(prompt.recall5).toBeCloseTo(1, 3)
        expect(prompt.recall3).toBeCloseTo(1, 3)
        // keyword-only precision after the evidence rules (generic words, scattered words, prompts
        // the vault does not know): the semantic channel and the reranker close the rest
        // (docs/daemon/communication.md)
        // the unknown-prompt gate spares a note holding a phrase of the prompt (two distinctive words
        // adjacent in both): "workshop folder" is the one expect-nothing prompt that adds (12 -> 13 of 48)
        // 8 of 48: each left is a real topic word in a note's name or tags ("invoice", "newsletter",
        // "reply"), or a giant log that repeats a word, which only the semantic channel tells apart
        expect(prompt.falseInject).toBeCloseTo(0.167, 3)
        const tool = (await evaluate(p, 'bm25', toolCases)).summary
        expect(tool.recall5).toBe(1)
        expect(tool.falseInject).toBe(0)
        // a subagent brief is long and mostly unknown to the vault: two scattered words ("every",
        // "files") are not a phrase of it
        const subagent = (await evaluate(p, 'bm25', CASES.filter(isSubagentCase))).summary
        expect(subagent.recall5).toBe(1)
        expect(subagent.falseInject).toBe(0)
    })

    test('the minScore sweep grid is read off the score distribution and brackets the production value', async () => {
        const p = await prepare(DIR)
        const grid = sweepGrid(p, promptCases, 'prompt')
        const cur = PACK_LIMITS.prompt.minScore
        expect(grid).toContain(cur)
        expect(Math.min(...grid)).toBeLessThan(cur)
        expect(Math.max(...grid)).toBeGreaterThan(cur)
        // on the scale the scores live on, not the old 0.5..8 grid
        expect(Math.max(...grid)).toBeLessThan(2)
        expect(grid).toEqual([...grid].sort((a, b) => a - b))
    })

    test('--service, embeddings off: createRecallService injects what bm25 ranks (margins, not exact)', async () => {
        const p = await prepare(DIR)
        const runner = await createServiceRunner(DIR, { embeddings: 'off' })
        try {
            const runs: CaseRun[] = []
            for (const [i, c] of CASES.entries()) runs.push(await runner.run(c, i))
            const pick = (f: (c: (typeof CASES)[number]) => boolean) => {
                const idx = CASES.map((c, i) => [c, i] as const).filter(([c]) => f(c))
                return summarize('service-off', idx.map(([c]) => c), idx.map(([, i]) => runs[i]!))
            }
            const prompt = pick(c => !isToolCase(c) && !isSubagentCase(c))
            expect(prompt.cases).toBe(promptCases.length)
            expect(prompt.recall5).toBeGreaterThanOrEqual(0.95)
            // keyword-only injects on about a sixth of expect-nothing prompts, down from 0.646 before
            // the evidence rules; what is left is a note that legitimately shares a topic word
            expect(prompt.falseInject).toBeLessThanOrEqual(0.17)
            expect(prompt.falseInject).toBeGreaterThan(0.1)
            const tool = pick(isToolCase)
            expect(tool.recall5).toBe(1)
            expect(tool.falseInject).toBeLessThanOrEqual(0.1)
            // follow-ups reach the service through a transcript tail
            const followUps = pick(c => !isToolCase(c) && !isSubagentCase(c) && !!c.context)
            expect(followUps.recall5).toBe(1)
            // the explain pass names, for every false injection, each injected note and the rule that
            // admitted it
            const f = findings(p, CASES, runs)
            const falseInjections = f.filter(x => x.expected.length === 0)
            expect(falseInjections.length).toBeGreaterThan(0)
            for (const x of falseInjections) {
                expect(x.why.length).toBe(Math.min(5, x.injected.length))
                x.why.forEach((line, k) => {
                    expect(line.startsWith(`${x.injected[k]}:`)).toBe(true)
                    expect(line).toMatch(/admitted by the (name\/tags\/description hit|lone-hit rule|several-body-hits rule|phrase exemption)/)
                })
            }
        } finally {
            runner.close()
        }
    })
})

describe('recall eval (source injections)', () => {
    const SRC_FILE = join(import.meta.dir, 'fixtures', 'recallSourceCases.json')
    const SRC_CASES = loadCases(SRC_FILE)
    const run = (injected: string[], sources?: string[]): CaseRun => ({
        injected,
        chars: 0,
        ms: 1,
        ...(sources ? { sources } : {}),
    })

    test('the source suite has the shapes the eval is meant to cover', () => {
        const fx = loadSourceFixture(SRC_FILE)
        const keys = SRC_CASES.flatMap(c => c.expect)
        expect(keys.some(k => k.startsWith('docs:bases/authoring/calendar.md#'))).toBe(true)
        expect(keys.some(k => k.startsWith('chat:'))).toBe(true)
        expect(keys.some(k => k.startsWith('pdf:'))).toBe(true)
        expect(SRC_CASES.filter(c => c.sourcesExpect?.length === 0).length).toBeGreaterThanOrEqual(2)
        // every expected source names a fixture file, chat or docs page
        for (const k of keys) {
            const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
            if (kind === 'chat') expect(Object.keys(fx.chats ?? {})).toContain(id)
            else if (kind === 'docs') expect(Object.keys(fx.docs ?? {})).toContain(id.split('#')[0]!)
            else expect(Object.keys(fx.vault ?? {})).toContain(id)
        }
        // source keys are not memory note names
        for (const c of SRC_CASES) expect(memoryExpect(c)).toEqual([])
    })

    test('summarize scores source keys: recall over the first 5, false inject over sourcesExpect: []', () => {
        const cases = [
            { prompt: 'a', expect: ['docs:x.md#a', 'chat:c1'] },
            { prompt: 'b', expect: ['chat:c2'] },
            { prompt: 'c', expect: [], sourcesExpect: [] },
            { prompt: 'd', expect: [], sourcesExpect: [] },
            { prompt: 'e', expect: [] },
        ]
        const runs = [
            run([], ['docs:x.md#a']), // 1 of 2
            run([], ['note:n.md', 'chat:c2']), // 1 of 1
            run([], ['chat:zz']), // injected where none allowed
            run([], []),
            run([], ['chat:q']), // no sourcesExpect: not counted
        ]
        const s = summarize('x', cases, runs)
        expect(s.sourceRecall5).toBeCloseTo(0.75, 6)
        expect(s.sourceFalseInject).toBeCloseTo(0.5, 6)
        // a source past the 5th injected does not count
        const late = summarize('x', [cases[1]!], [run([], ['note:1', 'note:2', 'note:3', 'note:4', 'note:5', 'chat:c2'])])
        expect(late.sourceRecall5).toBe(0)
        // memory scoring ignores source keys: only c1's absence of memory counts
        expect(s.recall5).toBe(0)
        expect(s.falseInject).toBe(0)
    })

    test('runs without source data leave the summary exactly as it was', () => {
        const s = summarize('x', SRC_CASES, SRC_CASES.map(() => run([])))
        expect('sourceRecall5' in s).toBe(false)
        expect('sourceFalseInject' in s).toBe(false)
        const old = summarize('x', promptCases, promptCases.map(() => run([])))
        expect(Object.keys(old).sort()).toEqual(
            ['cases', 'falseInject', 'meanChars', 'mrr', 'p50ms', 'p95ms', 'ranker', 'recall3', 'recall5'].sort(),
        )
    })

    // fake model: the query vector says which topic the prompt is about
    const topics = ['calendar', 'cron', 'defrost', 'launch']
    const embedder = {
        async embed(texts: string[]) {
            return texts.map(t => Float32Array.from(topics.map(w => (t.toLowerCase().includes(w) ? 1 : 0))))
        },
        dispose() {},
    }
    // the cross-encoder judges fillers off-topic (the real model gives unmatched docs about -10) and
    // the topic's own hit relevant, so no source admits a filler even where no relative floor applies
    const reranker = {
        rerank: async (_q: string, p: string[]) => p.map(x => (x.includes('excerpt of bg-') ? -10 : 5)),
        dispose() {},
    }
    const hit = (kind: string, id: string, score: number, extra: object = {}) => ({
        kind,
        id,
        score,
        excerpt: `excerpt of ${id}`,
        hash: `h-${id}`,
        ...extra,
    })
    // the topic's source hit stands above ten fillers per source, so each source's relative floor
    // (tenth-best + margin) applies and keeps the fillers out; an off-topic query gets fillers only
    const fakeSources = async (q: { vec: Float32Array }) => {
        const hot = [...q.vec].findIndex(x => x > 0)
        const top = [
            hit('docs', 'bases/authoring/calendar.md#writing-a-calendar-base', 0.9),
            hit('chat', 'chat-tz-fix', 0.9, { date: '2026-10-20' }),
            hit('pdf', 'papers/heat-pump.pdf', 0.9, { page: 2 }),
            hit('note', 'Projects/Launch.md', 0.9, { title: 'Launch plan' }),
        ]
        const fill = (kind: string) => Array.from({ length: 10 }, (_, i) => hit(kind, `bg-${kind}-${i}`, 0.6))
        return [...(hot >= 0 ? [top[hot]!] : []), ...fill('note'), ...fill('chat'), ...fill('docs')]
    }

    test('--service --sources on counts what the service injects as sources (fake model and sources)', async () => {
        const runner = await createServiceRunner(DIR, {
            embeddings: 'off',
            sources: 'on',
            inject: { embedder: () => embedder, reranker: () => reranker, sources: fakeSources, gateModel: logitGate },
        })
        try {
            const runs: CaseRun[] = []
            for (const [i, c] of SRC_CASES.entries()) runs.push(await runner.run(c, i))
            expect(runs.map(r => r.sources)).toEqual([
                ['docs:bases/authoring/calendar.md#writing-a-calendar-base'],
                ['chat:chat-tz-fix'],
                ['pdf:papers/heat-pump.pdf'],
                ['note:Projects/Launch.md'],
                [],
                [],
            ])
            const s = summarize('service-on', SRC_CASES, runs)
            expect(s.sourceRecall5).toBe(1)
            expect(s.sourceFalseInject).toBe(0)
            expect(findings(await prepare(DIR), SRC_CASES, runs).filter(f => f.why.some(w => w.includes('source')))).toEqual([])
        } finally {
            runner.close()
        }
    })

    test('a source the service injects where none is allowed shows up as a false inject and a finding', async () => {
        const runner = await createServiceRunner(DIR, {
            embeddings: 'off',
            sources: 'on',
            inject: {
                embedder: () => embedder,
                reranker: () => reranker,
                gateModel: logitGate,
                // every query, even small talk, gets a standout note
                sources: async () => [hit('note', 'Projects/Launch.md', 0.9), ...Array.from({ length: 9 }, (_, i) => hit('note', `bg${i}`, 0.6))],
            },
        })
        try {
            const runs: CaseRun[] = []
            for (const [i, c] of SRC_CASES.entries()) runs.push(await runner.run(c, i))
            const s = summarize('service-on', SRC_CASES, runs)
            expect(s.sourceFalseInject).toBe(1)
            expect(s.sourceRecall5).toBeCloseTo(0.25, 6)
            const f = findings(await prepare(DIR), SRC_CASES, runs)
            expect(f.filter(x => x.expected.length === 0 && x.why[0]!.includes('where none was expected')).length).toBe(2)
        } finally {
            runner.close()
        }
    })

    test('--sources off: the service runner carries no source data', async () => {
        const runner = await createServiceRunner(DIR, { embeddings: 'off' })
        try {
            const r = await runner.run(promptCases[0]!, 0)
            expect('sources' in r).toBe(false)
        } finally {
            runner.close()
        }
    })
})
