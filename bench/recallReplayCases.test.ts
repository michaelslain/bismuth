import { describe, expect, test } from 'bun:test'
import {
    capPerSection,
    fileKey,
    inRanges,
    judgePoolSize,
    junkStats,
    keyMatches,
    parseReplaySession,
    parseVerdict,
    precisionOf,
    rankMetrics,
    refersToPast,
    searchScore,
    sectionOf,
    timeRangesAt,
    vaultPathsIn,
} from './recallReplayCases'

const VAULT = '/Users/me/my vault'
const FILES = new Set(['notes/plan.md', 'papers/a b.pdf', 'photos/board.png', 'photos/board.png.md'])

const user = (text: string, at = '2026-10-01T10:00:00Z', extra: object = {}) =>
    JSON.stringify({ type: 'user', timestamp: at, message: { content: text }, ...extra })
const toolResult = () =>
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } })
const tool = (name: string, input: object, extra: object = {}) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] }, ...extra })

describe('vaultPathsIn', () => {
    test('finds absolute, escaped and relative vault paths, only when the file exists', () => {
        expect(vaultPathsIn({ file_path: `${VAULT}/papers/a b.pdf` }, VAULT, FILES)).toEqual(['papers/a b.pdf'])
        expect(vaultPathsIn({ command: 'cat /Users/me/my\\ vault/notes/plan.md' }, VAULT, FILES)).toEqual(['notes/plan.md'])
        expect(vaultPathsIn({ command: 'cd "/Users/me/my vault" && head notes/plan.md' }, VAULT, FILES)).toEqual(['notes/plan.md'])
        expect(vaultPathsIn({ command: 'cat notes/missing.md' }, VAULT, FILES)).toEqual([])
        expect(vaultPathsIn({ command: 'cat .daemon/memory/x.md' }, VAULT, new Set(['.daemon/memory/x.md']))).toEqual([])
    })
})

describe('fileKey', () => {
    test('maps files and companions to the kind the index uses', () => {
        expect(fileKey('notes/plan.md')).toBe('note:notes/plan.md')
        expect(fileKey('papers/a b.pdf')).toBe('pdf:papers/a b.pdf')
        expect(fileKey('photos/board.png')).toBe('image:photos/board.png')
        expect(fileKey('photos/board.png.md')).toBe('image:photos/board.png')
        expect(fileKey('papers/x.pdf.md')).toBe('pdf:papers/x.pdf')
        expect(fileKey('a.txt')).toBeNull()
    })
})

describe('parseReplaySession', () => {
    test('labels each prompt with what the agent fetched before the next prompt', () => {
        const log = [
            user('how do I write a calendar base?', '2026-10-01T10:00:00Z'),
            tool('mcp__bismuth__bismuth_docs_read', { path: 'bases/authoring/calendar.md#config-keys' }),
            toolResult(),
            tool('Read', { file_path: `${VAULT}/photos/board.png` }),
            tool('Write', { file_path: `${VAULT}/notes/plan.md`, content: 'x' }),
            user('thanks', '2026-10-01T10:05:00Z'),
            user('what did we talk about yesterday?', '2026-10-01T10:06:00Z'),
            tool('Bash', { command: 'cat notes/plan.md' }, { isSidechain: true }),
        ].join('\n')
        const s = parseReplaySession('s1', log, VAULT, FILES)
        expect(s.started).toBe('2026-10-01T10:00:00Z')
        expect(s.cases.map(c => c.prompt)).toEqual(['how do I write a calendar base?', 'thanks', 'what did we talk about yesterday?'])
        expect(s.cases[0]!.labels.sort()).toEqual(['docs:bases/authoring/calendar.md', 'image:photos/board.png'])
        expect(s.cases[0]!.usedTools).toBe(true)
        expect(s.cases[1]!.labels).toEqual([])
        expect(s.cases[1]!.usedTools).toBe(false)
        expect(s.cases.map(c => c.line)).toEqual([0, 5, 6])
        expect(s.cases[2]!.refersToPast).toBe(true)
        expect(s.cases[2]!.labels).toEqual([]) // the sidechain read is not the agent's
    })

    test('a cron session yields no cases, and injected blocks are stripped from prompts', () => {
        expect(parseReplaySession('c', user('[Cron: dream] run'), VAULT, FILES).cases).toEqual([])
        const s = parseReplaySession('e', user('<editor-context>\nActive file: x.md\n</editor-context>\nfix this'), VAULT, FILES)
        expect(s.cases[0]!.prompt).toBe('fix this')
    })
})

describe('keyMatches + refersToPast', () => {
    test('docs match by page, files exactly', () => {
        expect(keyMatches('docs:bases/authoring/calendar.md', 'docs:bases/authoring/calendar.md#config-keys')).toBe(true)
        expect(keyMatches('docs:bases/authoring/calendar.md', 'docs:bases/views/calendar.md')).toBe(false)
        expect(keyMatches('pdf:a.pdf', 'pdf:a.pdf')).toBe(true)
        expect(keyMatches('pdf:a.pdf', 'note:a.pdf')).toBe(false)
    })
    test('past-chat phrasing', () => {
        expect(refersToPast('remember when we fixed the cron?')).toBe(true)
        expect(refersToPast('write a calendar base')).toBe(false)
    })
})

describe('time cases', () => {
    test('a prompt with time words carries ranges read against its own time', () => {
        const r = timeRangesAt('what did we do yesterday?', '2026-10-10T12:00:00')
        expect(r.length).toBe(1)
        expect(r[0]!.start).toBe('2026-10-09')
        expect(timeRangesAt('write a calendar base', '2026-10-10T12:00:00')).toEqual([])
        expect(timeRangesAt('yesterday', 'not a date')).toEqual([])
        const s = parseReplaySession('t', user('what happened yesterday?', '2026-10-10T12:00:00'), VAULT, FILES)
        expect(s.cases[0]!.timeRanges.length).toBe(1)
    })
    test('inRanges is inclusive', () => {
        const rs = [{ start: '2026-10-01', end: '2026-10-03' }]
        expect(inRanges('2026-10-01', rs)).toBe(true)
        expect(inRanges('2026-10-03', rs)).toBe(true)
        expect(inRanges('2026-10-04', rs)).toBe(false)
        expect(inRanges(undefined, rs)).toBe(false)
    })
})

describe('precision and junk arithmetic', () => {
    const rows = [
        { labels: ['note:a.md'], injected: ['note:a.md', 'chat:s1', 'docs:x.md#y'] },
        { labels: ['pdf:p.pdf'], injected: [] as string[] },
        { labels: ['docs:x.md'], injected: ['docs:x.md#z'] },
    ]
    test('precision counts injected items matching a label, per section', () => {
        expect(precisionOf(rows)).toEqual({ cases: 2, items: 4, matched: 2, precision: 0.5 })
        expect(precisionOf(rows, 'chats').precision).toBeNull()
        expect(precisionOf(rows, 'docs')).toEqual({ cases: 2, items: 2, matched: 1, precision: 0.5 })
        expect(precisionOf([], 'files').precision).toBeNull()
        expect(sectionOf('image:a.png')).toBe('files')
    })
    test('junk rate is the irrelevant share of judged items', () => {
        expect(junkStats(['relevant', 'irrelevant', 'irrelevant', 'irrelevant'])).toEqual({ judged: 4, relevant: 1, junk: 3, junkRate: 0.75 })
        expect(junkStats([]).junkRate).toBeNull()
    })
    test('verdict parsing tests irrelevant first', () => {
        expect(parseVerdict('irrelevant.')).toBe('irrelevant')
        expect(parseVerdict(' Relevant')).toBe('relevant')
        expect(parseVerdict('maybe')).toBeNull()
    })
    test('pool size is the smaller of cpu and memory budgets', () => {
        expect(judgePoolSize(16, 64 * 1024 ** 3)).toBe(8)
        expect(judgePoolSize(16, 1024 ** 3)).toBe(1)
        expect(judgePoolSize(4, 64 * 1024 ** 3)).toBe(3)
        expect(judgePoolSize(1, 0)).toBe(1)
    })
})

describe('recall@10 and MRR', () => {
    test('first matching rank within k', () => {
        expect(rankMetrics(['note:x', 'note:a.md'], ['note:a.md'])).toEqual({ hit: true, rr: 0.5 })
        expect(rankMetrics(['note:x'], ['note:a.md'])).toEqual({ hit: false, rr: 0 })
        const long = [...Array(10).fill('note:x'), 'note:a.md']
        expect(rankMetrics(long, ['note:a.md'])).toEqual({ hit: false, rr: 0 })
    })
    test('score averages over cases', () => {
        const s = searchScore([
            { ranked: ['note:a.md'], labels: ['note:a.md'] },
            { ranked: ['note:q', 'note:b.md'], labels: ['note:b.md'] },
            { ranked: [], labels: ['note:c.md'] },
            { ranked: ['note:z'], labels: ['note:c.md'] },
        ])
        expect(s).toEqual({ cases: 4, recall: 0.5, mrr: 0.375 })
    })
})

describe('capPerSection', () => {
    const hit = (id: string, score: number, kind: 'chat' | 'file') => ({ kind, id, score }) as never
    test('caps each section by score, after the caller has dropped hits', () => {
        const hits = [hit('1', 0.2, 'chat'), hit('2', 0.9, 'chat'), hit('3', 0.5, 'chat'), hit('f', 0.1, 'file')]
        const out = capPerSection(hits, 2) as { id: string }[]
        expect(out.map(h => h.id).sort()).toEqual(['2', '3', 'f'])
    })
})
