import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
    anchorSummary,
    buildSummaries,
    buildSummaryPrompt,
    contentHash,
    lineAt,
    loadSummaries,
    loadSummariesSync,
    packTurns,
    parseSummaryReply,
    summariesFile,
    summaryPaths,
    TURN_CHARS,
    TURN_NOTES,
} from '../src/noteSummaries'
import type { HeadlessTurn } from '../src/chatProviders/headlessTurn'
import { makeVault, tempDir } from './helpers'

const NOTE = '# Trip\n\nFlights booked for March 3.\n\n## Packing\n\nBring the blue tent.\n'

describe('lineAt', () => {
    test('1-based line of an offset', () => {
        expect(lineAt(NOTE, 0)).toBe(1)
        expect(lineAt(NOTE, NOTE.indexOf('Bring'))).toBe(7)
    })
})

describe('parseSummaryReply', () => {
    test('one JSON line per note; malformed lines and empty summaries dropped', () => {
        const r = parseSummaryReply(
            [
                '{"path": "a.md", "summary": "A trip.", "points": [{"text": "flights", "quote": "Flights booked"}, {"text": 3}]}',
                'not json',
                '{"path": "b.md", "summary": "  "}',
                '```',
                '{"path": "c.md", "summary": "C.", "points": "nope"}',
            ].join('\n'),
        )
        expect(r).toEqual([
            { path: 'a.md', summary: 'A trip.', points: [{ text: 'flights', quote: 'Flights booked' }] },
            { path: 'c.md', summary: 'C.', points: [] },
        ])
    })
})

describe('anchorSummary', () => {
    test('points keep only quotes found in the note, with the line they start on', () => {
        const s = anchorSummary(
            {
                path: 'trip.md',
                summary: 'A March trip.',
                points: [
                    { text: 'flights', quote: 'flights BOOKED for march 3' },
                    { text: 'invented', quote: 'a sentence the note never had' },
                    { text: 'tent', quote: 'Bring the blue tent.' },
                ],
            },
            NOTE,
            { hash: 'h' },
        )
        expect(s).toEqual({
            path: 'trip.md',
            hash: 'h',
            summary: 'A March trip.',
            points: [
                { text: 'flights', quote: 'Flights booked for March 3', line: 3 },
                { text: 'tent', quote: 'Bring the blue tent.', line: 7 },
            ],
        })
    })
})

describe('packTurns', () => {
    test('notes grouped up to the turn size and note count; a long note goes alone', () => {
        const small = Array.from({ length: TURN_NOTES + 3 }, (_, i) => ({ path: `${i}`, text: 'x' }))
        expect(packTurns(small).map(t => t.length)).toEqual([TURN_NOTES, 3])
        const long = { path: 'long', text: 'y'.repeat(TURN_CHARS + 10) }
        expect(packTurns([{ path: 'a', text: 'a' }, long, { path: 'b', text: 'b' }]).map(t => t.map(n => n.path))).toEqual([
            ['a'],
            ['long'],
            ['b'],
        ])
    })
})

describe('buildSummaries', () => {
    const reply = (notes: { path: string }[]) =>
        notes.map(n => JSON.stringify({ path: n.path, summary: `about ${n.path}`, points: [{ text: 'first', quote: 'line one' }] })).join('\n')
    const pathsIn = (text: string) => [...text.matchAll(/<note path="([^"]+)">/g)].map(m => ({ path: m[1]! }))

    test('summarises changed notes only, keeps the store compact, drops notes gone from the vault', async () => {
        const dir = tempDir('summaries-')
        const file = join(dir, 's.jsonl')
        const texts: Record<string, string> = { 'a.md': 'line one\na', 'b.md': 'line one\nb', 'empty.md': '  \n' }
        const turns: HeadlessTurn[] = []
        const deps = {
            installed: () => ['opencode'],
            runTurn: async (t: HeadlessTurn) => {
                turns.push(t)
                return reply(pathsIn(t.text))
            },
        }
        const opts = { vault: dir, file, readText: async (p: string) => texts[p]!, chatProvider: 'opencode', concurrency: 2 }
        const first = await buildSummaries({ ...opts, paths: ['a.md', 'b.md', 'empty.md'] }, deps)
        expect(first).toMatchObject({ summarised: 2, unchanged: 0, failed: 0, removed: 0, backend: 'opencode' })
        expect(turns).toHaveLength(1)
        expect(turns[0]!.text).toBe(buildSummaryPrompt([{ path: 'a.md', text: texts['a.md']! }, { path: 'b.md', text: texts['b.md']! }]))
        const stored = await loadSummaries(dir, file)
        expect(stored.get('a.md')).toEqual({
            path: 'a.md',
            hash: contentHash(texts['a.md']!),
            summary: 'about a.md',
            points: [{ text: 'first', quote: 'line one', line: 1 }],
        })

        texts['b.md'] = 'line one\nb changed'
        const second = await buildSummaries({ ...opts, paths: ['b.md'] }, deps)
        expect(second).toMatchObject({ summarised: 1, unchanged: 0, removed: 1 })
        expect(turns).toHaveLength(2)
        expect([...loadSummariesSync(dir, file).keys()]).toEqual(['b.md'])
        expect(readFileSync(file, 'utf-8').trim().split('\n')).toHaveLength(1)

        const third = await buildSummaries({ ...opts, paths: ['b.md'] }, deps)
        expect(third).toMatchObject({ summarised: 0, unchanged: 1 })
        expect(turns).toHaveLength(2)
    })

    test('a note the reply leaves out counts as failed and is tried again next build', async () => {
        const dir = tempDir('summaries-')
        const file = join(dir, 's.jsonl')
        const run = async () => JSON.stringify({ path: 'a.md', summary: 'A.', points: [] })
        const opts = { vault: dir, file, paths: ['a.md', 'b.md'], readText: async (p: string) => p, chatProvider: 'opencode' }
        const r = await buildSummaries(opts, { installed: () => ['opencode'], runTurn: run })
        expect(r).toMatchObject({ summarised: 1, failed: 1 })
        const again = await buildSummaries(opts, { installed: () => ['opencode'], runTurn: run })
        expect(again).toMatchObject({ summarised: 0, unchanged: 1, failed: 1 })
    })

    test('--limit summarises that many and leaves the rest; modelFor picks the model per backend', async () => {
        const dir = tempDir('summaries-')
        const turns: HeadlessTurn[] = []
        const r = await buildSummaries(
            {
                vault: dir,
                file: join(dir, 's.jsonl'),
                paths: ['a.md', 'b.md', 'c.md'],
                readText: async p => p,
                chatProvider: 'claude',
                limit: 2,
                modelFor: b => (b === 'claude' ? 'haiku' : undefined),
            },
            {
                installed: () => ['claude'],
                runTurn: async t => {
                    turns.push(t)
                    return reply(pathsIn(t.text))
                },
            },
        )
        expect(r.summarised).toBe(2)
        expect(turns.map(t => t.model)).toEqual(['haiku'])
    })

    test('a backend that is not installed is refused before any note is read', async () => {
        let read = false
        const err = await buildSummaries(
            {
                vault: '/x',
                file: '/nonexistent/s.jsonl',
                paths: ['a.md'],
                readText: async () => {
                    read = true
                    return 'a'
                },
                chatProvider: 'opencode',
            },
            { installed: () => [] },
        ).catch(e => e)
        expect(err.code).toBe('AI_UNAVAILABLE')
        expect(read).toBe(false)
    })
})

describe('summaryPaths', () => {
    test('every note but those hidden from ai on either channel', async () => {
        const vault = makeVault({
            'open.md': 'hi',
            'chat-only.md': '---\nvisibility: chat-only\n---\nx',
            'hidden.md': '---\nvisibility: hidden\n---\ny',
            'sub/n.md': 'z',
        })
        expect(await summaryPaths(vault)).toEqual(['open.md', 'sub/n.md'])
    })
})

describe('summariesFile', () => {
    test('one file per vault under the cache, outside the vault', () => {
        const f = summariesFile('/v', (...p) => join('/home', ...p))
        expect(f.startsWith('/home/cache/summaries/')).toBe(true)
        expect(f).not.toBe(summariesFile('/w', (...p) => join('/home', ...p)))
    })
})

describe('buildSummaries reply paths', () => {
    test('a reply that normalises the path (narrow no-break space, curly apostrophe) still lands on the note', async () => {
        const dir = tempDir('summaries-')
        const paths = ['Screenshot at 3.22.08 PM.png.md', 'Du Bois’s Color Line.md']
        const r = await buildSummaries(
            { vault: dir, file: join(dir, 's.jsonl'), paths, readText: async p => `text of ${p}`, chatProvider: 'opencode' },
            {
                installed: () => ['opencode'],
                runTurn: async () =>
                    [
                        JSON.stringify({ path: 'Screenshot at 3.22.08 PM.png.md', summary: 'A screenshot.', points: [] }),
                        JSON.stringify({ path: "Du Bois's Color Line.md", summary: 'A reading.', points: [] }),
                    ].join('\n'),
            },
        )
        expect(r).toMatchObject({ summarised: 2, failed: 0 })
        expect([...(await loadSummaries(dir, join(dir, 's.jsonl'))).keys()].sort()).toEqual([...paths].sort())
    })
})
