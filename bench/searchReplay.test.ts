import { describe, expect, test } from 'bun:test'
import { fileLabels, heldOut, pairedDiff, seenBy } from './searchReplay'
import { searchReadPairs } from './docsSearchReplay'

describe('searchReplay', () => {
    test('seenBy drops the prompt’s own chat and chats that started after it', () => {
        const started = new Map([
            ['old', Date.parse('2026-11-01T00:00:00Z')],
            ['new', Date.parse('2026-11-09T00:00:00Z')],
            ['me', Date.parse('2026-11-05T00:00:00Z')],
        ])
        const hits = [
            { kind: 'note', path: 'a.md' },
            { kind: 'chat', path: 'chat old', session: 'old' },
            { kind: 'chat', path: 'chat new', session: 'new' },
            { kind: 'chat', path: 'chat me', session: 'me' },
            { kind: 'chat', path: 'chat gone', session: 'gone' },
        ]
        const kept = seenBy(hits, { session: 'me', at: '2026-11-05T10:00:00Z' }, started)
        expect(kept.map(h => h.path)).toEqual(['a.md', 'chat old'])
    })

    test('fileLabels keeps files, not docs pages', () => {
        expect(fileLabels({ labels: ['docs:a.md', 'note:b.md', 'pdf:c.pdf'] })).toEqual(['note:b.md', 'pdf:c.pdf'])
    })

    test('pairedDiff: identical runs differ by zero, a better variant shows a positive interval', () => {
        const base = Array.from({ length: 40 }, (_, i) => ({ session: `s${i % 10}`, hit: i % 2, rr: (i % 2) / 2 }))
        const same = pairedDiff(base, base, 200)
        expect(same.recall).toEqual({ diff: 0, lo: 0, hi: 0 })
        const better = base.map(x => ({ ...x, hit: 1, rr: 1 }))
        const d = pairedDiff(base, better, 200)
        expect(d.recall.diff).toBeCloseTo(0.5)
        expect(d.recall.lo).toBeGreaterThan(0)
        expect(d.cases).toBe(40)
        expect(d.sessions).toBe(10)
    })

    test('heldOut scores every case once, on the fold it was left out of', () => {
        const rows = Array.from({ length: 12 }, (_, i) => ({
            session: `s${i % 4}`,
            labels: ['note:a.md'],
            meaning: [['note:a.md', 'note:a.md'] as [string, string | null]],
            keyword: [['note:b.md', 'note:b.md'] as [string, string | null]],
            logit: {},
        }))
        const out = heldOut(rows, 4)
        expect(out).toHaveLength(12)
        expect(out.every(o => o.hit === 1 && o.rr === 1)).toBe(true)
    })
})

describe('docsSearchReplay', () => {
    const use = (command: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } })
    const user = (text: string) => JSON.stringify({ type: 'user', message: { content: text } })

    test('searchReadPairs: a search and the pages read before the next one', () => {
        const log = [
            user('how do daily notes work'),
            use('bismuth docs search "daily notes" --limit 5'),
            use('bismuth docs read settings/reference.md'),
            use('bismuth docs search cron 2>&1 | head'),
            user('thanks'),
            use('bismuth docs search flashcards'),
            use('bismuth docs read flashcards/srs.md'),
        ].join('\n')
        expect(searchReadPairs(log)).toEqual([
            { query: 'daily notes', pages: ['settings/reference.md'] },
            { query: 'flashcards', pages: ['flashcards/srs.md'] },
        ])
    })
})
