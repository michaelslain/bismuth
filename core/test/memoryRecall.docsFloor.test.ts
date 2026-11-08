import { test, expect } from 'bun:test'
import { RERANK_MIN_LOGIT } from '@bismuth/memory'
import type { MemoryNote } from '@bismuth/memory'
import { createRecallService } from '../src/memoryRecall'
import type { RecallDeps, RecallEngine } from '../src/memoryRecall'
import type { SourceHit } from '../src/semanticSources'
import { logitGate } from './gateStub'

// Ten docs candidates within 0.06 of each other, one page each: one topic, many pages, no standout.
const docs = (kind: SourceHit['kind'] = 'docs'): SourceHit[] =>
    Array.from({ length: 10 }, (_, i) => ({
        kind,
        id: kind === 'docs' ? `bases/p${i}.md#calendar` : `p${i}.md`,
        score: 0.82 - i * 0.006,
        excerpt: `calendar section ${i}`,
        title: `Page ${i} // Calendar`,
        hash: `h${i}`,
    }))

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

function make(hits: SourceHit[], logits: (n: number) => number[]) {
    const judged: number[] = []
    const deps: RecallDeps = {
        memoryDir: () => '/mem',
        settings: () => ({ enabled: true, midTurn: true, semantic: true }),
        embedder: () => ({ embed: async () => [new Float32Array(2)], dispose() {} }),
        engine: fakeEngine,
        loadNotes: async () => [],
        reranker: () => ({
            rerank: async (_q: string, p: string[]) => (judged.push(p.length), logits(p.length)),
            dispose() {},
        }),
        sources: async () => hits,
        gateModel: logitGate,
        vault: '/v',
    }
    return { svc: createRecallService(deps), judged }
}
const ask = { mode: 'prompt' as const, sessionId: 's', prompt: 'how do I write a calendar view base' }

test('docs: ten close candidates still admit the top one when its logit clears the gate', async () => {
    const { svc, judged } = make(docs(), n => Array.from({ length: n }, (_, i) => (i === 0 ? RERANK_MIN_LOGIT + 8 : RERANK_MIN_LOGIT - 4)))
    const r = await svc.recall(ask)
    expect(judged).toEqual([5])
    expect(r.sources).toEqual(['docs:bases/p0.md#calendar'])
    expect(r.context).toContain('# Bismuth docs')
})

test('docs: a negative logit below the gate admits none', async () => {
    const { svc } = make(docs(), n => Array.from({ length: n }, () => RERANK_MIN_LOGIT - 1))
    const r = await svc.recall(ask)
    expect(r.context).toBeNull()
    expect(r.sources ?? []).toEqual([])
})

test('files: ten close candidates reach the reranker, five at most, and the gate alone decides what is kept', async () => {
    const close = docs('note')
    const { svc, judged } = make(close, n => Array.from({ length: n }, (_, i) => (i < 2 ? RERANK_MIN_LOGIT + 8 : RERANK_MIN_LOGIT - 4)))
    expect((await svc.recall(ask)).sources).toEqual(['note:p0.md'])
    expect(judged).toEqual([5])
})

test('docs: a logit above the rerank gate but under the docs bar is refused', async () => {
    const { svc } = make(docs(), n => Array.from({ length: n }, () => RERANK_MIN_LOGIT + 4))
    const r = await svc.recall(ask)
    expect(r.context).toBeNull()
    expect(r.sources ?? []).toEqual([])
})
