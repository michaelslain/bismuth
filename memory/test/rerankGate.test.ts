import { test, expect } from 'bun:test'
import {
    gateByRerank,
    RERANK_CANDIDATES,
    RERANK_MAX_DROP,
    RERANK_CONTEXT_CHARS,
    RERANK_MIN_LOGIT,
    RERANK_QUERY_CHARS,
    RERANK_TERSE_TERMS,
    excerptText,
    rerankQuery,
} from '../src'
import type { MemoryNote, RankedNote } from '../src'

const ranked = (name: string, body = `${name} body`): RankedNote => ({
    note: {
        name,
        content: body,
        backlinks: [],
        frontmatter: { type: 'fact', tags: ['t'], description: `about ${name}` },
    } as unknown as MemoryNote,
    score: 0.5,
    lexical: 0.5,
})
const names = (rs: RankedNote[]) => rs.map(r => r.note.name)

test('constants', () => {
    expect(RERANK_CANDIDATES).toBe(5)
    expect(RERANK_MAX_DROP).toBe(8)
    expect(RERANK_MIN_LOGIT).toBe(-6)
})

test('keeps candidates at or above minLogit, best first', () => {
    const c = [ranked('a'), ranked('b'), ranked('c')]
    expect(names(gateByRerank(c, [-5, -5.5, -6]))).toEqual(['a', 'b', 'c'])
    expect(names(gateByRerank(c, [-5, -5.5, -6.01]))).toEqual(['a', 'b'])
})

test('nothing clears the bar: empty', () => {
    expect(gateByRerank([ranked('a'), ranked('b')], [-6.1, -9])).toEqual([])
    expect(gateByRerank([], [])).toEqual([])
})

test('drops a candidate more than maxDrop below the top logit', () => {
    const c = [ranked('a'), ranked('b'), ranked('c')]
    expect(names(gateByRerank(c, [9, 1, 0.9], { minLogit: -5 }))).toEqual(['a', 'b'])
    expect(names(gateByRerank(c, [9, 1.1, 0.9], { minLogit: -5, maxDrop: 100 }))).toEqual(['a', 'b', 'c'])
})

test('keeps a second real match that reads 7.4 below a strong first one, but not 8.1', () => {
    const c = [ranked('a'), ranked('b'), ranked('c')]
    expect(names(gateByRerank(c, [3.43, -3.96, -4.5]))).toEqual(['a', 'b', 'c'])
    expect(names(gateByRerank(c, [3.43, -3.96, -4.7]))).toEqual(['a', 'b'])
})

test('a lexical-first match with a paraphrase logit of -5.5 is kept when it is the only candidate', () => {
    expect(names(gateByRerank([ranked('a')], [-5.5]))).toEqual(['a'])
    expect(names(gateByRerank([ranked('a')], [-6.01]))).toEqual([])
})

test('ties keep ranker order; missing or NaN logits never qualify', () => {
    const c = [ranked('a'), ranked('b'), ranked('c')]
    expect(names(gateByRerank(c, [2, 2, Number.NaN]))).toEqual(['a', 'b'])
    expect(names(gateByRerank(c, [2]))).toEqual(['a'])
})

test('excerptText is the packed excerpt, cut at perNoteChars', () => {
    const t = excerptText(ranked('alpha', 'x '.repeat(2000)), 300)
    expect(t).toContain('## alpha (fact) [t]')
    expect(t).toContain('about alpha')
    expect(t.length).toBeLessThanOrEqual(300)
})

test('rerankQuery: a prompt with enough content terms is judged alone', () => {
    expect(RERANK_TERSE_TERMS).toBe(4)
    expect(RERANK_CONTEXT_CHARS).toBe(400)
    const q = { primary: 'how does the recall ranker weigh tags', context: 'earlier talk about pizza' }
    expect(rerankQuery(q)).toBe(q.primary)
    const four = { primary: 'rotate the production database credentials', context: 'earlier talk about pizza' }
    expect(rerankQuery(four)).toBe(four.primary)
})

test('rerankQuery: "yes go ahead" is terse when context exists', () => {
    expect(rerankQuery({ primary: 'yes go ahead', context: 'ctx' })).toBe('yes go ahead\nctx')
})

test('rerankQuery: a terse prompt is followed by the context tail', () => {
    expect(rerankQuery({ primary: 'ok do it', context: 'we were fixing the graph layout' })).toBe(
        'ok do it\nwe were fixing the graph layout',
    )
})

test('rerankQuery: the context is capped at its first RERANK_CONTEXT_CHARS', () => {
    const context = `HEAD${'x'.repeat(RERANK_CONTEXT_CHARS)}TAIL`
    const out = rerankQuery({ primary: 'continue', context })
    expect(out.startsWith('continue\nHEAD')).toBe(true)
    expect(out.length).toBe('continue\n'.length + RERANK_CONTEXT_CHARS)
    expect(out).not.toContain('TAIL')
})

test('rerankQuery: a long primary is capped at RERANK_QUERY_CHARS', () => {
    const primary = 'migrate the billing database schema carefully '.repeat(120).slice(0, 5000)
    expect(rerankQuery({ primary }).length).toBe(RERANK_QUERY_CHARS)
    expect(rerankQuery({ primary, context: 'ctx' })).toBe(primary.slice(0, RERANK_QUERY_CHARS))
})

test('rerankQuery: a terse prompt with no context is the prompt', () => {
    expect(rerankQuery({ primary: 'continue' })).toBe('continue')
    expect(rerankQuery({ primary: 'continue', context: '  ' })).toBe('continue')
})
