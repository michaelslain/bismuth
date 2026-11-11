import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTasks, generate, parseNeedles, parseQuestions, selfAnswering, sessionDigest, type AskFn, type Needle } from './needleCases'

const line = (type: string, text: string, extra: object = {}) => JSON.stringify({ type, message: { role: type, content: text }, ...extra })
const long = (s: string) => `${s} ${'filler words about the work '.repeat(12)}`

describe('selfAnswering', () => {
    test('drops a question whose answer words all occur in it', () => {
        expect(selfAnswering('Did we pick the postgres database for the vault?', 'the postgres database')).toBe(true)
    })
    test('keeps an answer with one new content word', () => {
        expect(selfAnswering('Which database did we pick for the vault?', 'postgres')).toBe(false)
        expect(selfAnswering('Which database did we pick for the vault?', 'the database postgres')).toBe(false)
    })
    test('function words and case do not count; an answer with no content words is dropped', () => {
        expect(selfAnswering('Which DATABASE did we pick?', 'The Database')).toBe(true)
        expect(selfAnswering('Which database?', 'it is')).toBe(true)
    })
})

describe('parseNeedles', () => {
    const good: Needle = { id: 'n1', kind: 'needle', session: 's1', question: 'q?', answer: 'a', evidence: ['e'] }
    test('keeps valid lines, drops malformed ones, never throws', () => {
        const agg = { ...good, id: 'a1', kind: 'aggregate', session: null }
        const text = [JSON.stringify(good), 'not json', '{"id":"x"}', JSON.stringify({ ...good, kind: 'other' }), JSON.stringify({ ...good, session: null }), JSON.stringify({ ...agg, session: 's' }), JSON.stringify(agg), '', 'null'].join('\n')
        expect(parseNeedles(text).map(n => n.id)).toEqual(['n1', 'a1'])
        expect(parseNeedles(undefined as never)).toEqual([])
    })
})

describe('sessions and questions', () => {
    test('digest strips injected blocks, sidechains and tool noise', () => {
        const d = sessionDigest([line('user', 'real prompt <system-reminder>secret</system-reminder>'), line('assistant', 'answer text'), line('user', 'side', { isSidechain: true }), 'junk'].join('\n'))
        expect(d).toContain('USER: real prompt')
        expect(d).toContain('ASSISTANT: answer text')
        expect(d).not.toContain('secret')
        expect(d).not.toContain('side')
    })
    test('parseQuestions ignores malformed replies', () => {
        expect(parseQuestions('nope')).toEqual([])
        expect(parseQuestions('{"questions":[{"question":"q","answer":"a","evidence":["e"]},{"question":"q"}]}')).toHaveLength(1)
    })
    test('tasks hold a needle per session and aggregates inside the project', () => {
        const tasks = buildTasks(['a', 'b', 'c', 'd', 'e'].map(id => ({ id, digest: long(id) })))
        expect(tasks.filter(t => t.kind === 'needle')).toHaveLength(5)
        expect(tasks.filter(t => t.kind === 'aggregate').length).toBeGreaterThan(0)
        expect(buildTasks([{ id: 'a', digest: 'short' }])).toEqual([])
    })
})

describe('generate', () => {
    const sessions = ['s1', 's2', 's3'].map(id => ({ id, digest: long(id) }))
    const reply = (q: string, a: string) => JSON.stringify({ questions: [{ question: q, answer: a, evidence: ['quote'] }] })
    test('drops self-answering questions, appends results, resumes without re-asking', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'needle-'))
        try {
            const out = join(dir, 'sub', 'needles.jsonl')
            const calls: string[] = []
            const ask: AskFn = async (_s, text) => {
                calls.push(text)
                return text.includes('s2') && !text.includes('=== SESSION') ? reply('Is it the postgres database?', 'the postgres database') : reply(`what is the fact in ${text.slice(0, 2)}?`, 'unique-value-' + text.slice(0, 2))
            }
            const tasks = buildTasks(sessions)
            const first = await generate(tasks, { out: out, n: 100, concurrency: 2, timeoutMs: 1000, ask })
            expect(first.some(n => n.question.includes('postgres'))).toBe(false)
            expect(first.some(n => n.kind === 'aggregate')).toBe(true)
            expect(parseNeedles(readFileSync(out, 'utf8'))).toHaveLength(first.length)
            const asked = calls.length
            const again = await generate(tasks, { out, n: 100, concurrency: 2, timeoutMs: 1000, ask })
            expect(calls.length).toBe(asked)
            expect(again).toHaveLength(first.length)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
    test('stops at n and a hung model call times out', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'needle-'))
        try {
            const out = join(dir, 'n.jsonl')
            let hang = true
            const ask: AskFn = (_s, text) => (hang && text.startsWith('s2') ? new Promise(() => {}) : Promise.resolve(reply('q ' + text.slice(0, 2), 'ans-' + text.slice(0, 2))))
            const got = await generate(buildTasks(sessions), { out, n: 2, concurrency: 1, timeoutMs: 50, ask })
            expect(got).toHaveLength(2)
            expect(readFileSync(out + '.done', 'utf8')).not.toContain('needle:s2')
            hang = false
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
    test('a failed call is not marked done and is asked again on rerun', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'needle-'))
        try {
            const out = join(dir, 'f.jsonl')
            const tasks = buildTasks(sessions)
            let calls = 0
            await generate(tasks, { out, n: 100, concurrency: 1, timeoutMs: 1000, ask: async () => (calls++, null) })
            expect(existsSync(out + '.done') ? readFileSync(out + '.done', 'utf8') : '').toBe('')
            const first = calls
            const got = await generate(tasks, { out, n: 100, concurrency: 1, timeoutMs: 1000, ask: async (_s, text) => (calls++, reply('q ' + text.slice(0, 2), 'ans-' + text.slice(0, 2))) })
            expect(calls - first).toBe(tasks.length)
            expect(got.length).toBeGreaterThan(0)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
