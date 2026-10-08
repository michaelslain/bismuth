import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
    evaluate,
    isSubagentCase,
    isToolCase,
    loadCases,
    prepare,
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
        expect(prompt.recall3).toBeCloseTo(0.986, 3)
        // bm25 alone injects on most expect-nothing prompts: the gap the semantic channel and the
        // reranker exist to close (docs/daemon/communication.md)
        expect(prompt.falseInject).toBeCloseTo(0.646, 3)
        const tool = (await evaluate(p, 'bm25', toolCases)).summary
        expect(tool.recall5).toBe(1)
        expect(tool.falseInject).toBe(0)
    })
})
