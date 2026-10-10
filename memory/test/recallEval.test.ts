import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { PACK_LIMITS } from '../src/pack'
import type { CaseRun } from '../../bench/recallEval'
import {
    createServiceRunner,
    evaluate,
    findings,
    isSubagentCase,
    isToolCase,
    loadCases,
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
