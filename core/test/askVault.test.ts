import { describe, expect, test } from 'bun:test'
import type { MemoryNote } from '@bismuth/memory'
import {
    askVault,
    buildAskVaultPrompt,
    locateSources,
    memoryLayer,
    packDocs,
    parseAskVaultReply,
    resolveLinkedNotes,
    type AskDoc,
} from '../src/askVault'
import type { HeadlessTurn } from '../src/chatProviders/headlessTurn'

const doc = (path: string, text: string, layer: AskDoc['layer'] = 'note', summary?: string): AskDoc => ({
    path,
    layer,
    text,
    ...(summary ? { summary } : {}),
})

describe('packDocs', () => {
    test('whole text while the budget holds, then summary alone, else left out', () => {
        const sent = packDocs([doc('a.md', 'aaaa'), doc('b.md', 'bbbbbbbbb', 'note', 'B short'), doc('c.md', 'cccccc'), doc('d.md', 'd')], 12)
        expect(sent).toEqual([
            { path: 'a.md', layer: 'note', text: 'aaaa' },
            { path: 'b.md', layer: 'note', summary: 'B short' },
            { path: 'd.md', layer: 'note', text: 'd' },
        ])
    })
})

describe('buildAskVaultPrompt', () => {
    test('names each document with its layer, summary and text', () => {
        const p = buildAskVaultPrompt('what did I cook?', [
            { path: '.daemon/memory/day-2026-11-10.md', layer: 'digest', text: 'cooked dal' },
            { path: 'Recipes.md', layer: 'note', summary: 'recipes I keep' },
        ])
        expect(p).toContain('Question: what did I cook?')
        expect(p).toContain('<document path=".daemon/memory/day-2026-11-10.md" layer="digest">\ncooked dal\n</document>')
        expect(p).toContain('<document path="Recipes.md" layer="note">\nsummary: recipes I keep\n(text not included; summary only)\n</document>')
    })
})

describe('parseAskVaultReply', () => {
    test('JSON answer and sources; anything else is the answer whole', () => {
        expect(parseAskVaultReply('{"answer": " Dal twice. ", "sources": [{"path": "a.md", "quote": "dal"}, {"path": 1}]}')).toEqual({
            answer: 'Dal twice.',
            sources: [{ path: 'a.md', quote: 'dal' }],
        })
        expect(parseAskVaultReply('just prose')).toEqual({ answer: 'just prose', sources: [] })
    })
})

describe('locateSources', () => {
    test('only quotes found in text that was sent, one per line, with the line', () => {
        const sent = [
            { path: 'a.md', layer: 'note' as const, text: 'one\ncooked dal on monday\nthree' },
            { path: 'b.md', layer: 'note' as const, summary: 'b' },
        ]
        expect(
            locateSources(
                [
                    { path: 'a.md', quote: 'Cooked DAL on monday' },
                    { path: 'a.md', quote: 'dal on' },
                    { path: 'a.md', quote: 'invented' },
                    { path: 'b.md', quote: 'b' },
                    { path: 'z.md', quote: 'one' },
                ],
                sent,
            ),
        ).toEqual([{ path: 'a.md', line: 2, text: 'cooked dal on monday' }])
    })
})

describe('resolveLinkedNotes', () => {
    test('a link names the shortest note with that file name; folders, aliases and headings work', () => {
        const paths = ['deep/x/Homework 9.md', 'Homework 9.md', 'projects/Bismuth/Roadmap.md', 'Other.md']
        expect(resolveLinkedNotes(['Homework 9', 'projects/Bismuth/Roadmap|the board', 'other#Part', 'Missing', 'Homework 9'], paths)).toEqual([
            'Homework 9.md',
            'projects/Bismuth/Roadmap.md',
            'Other.md',
        ])
    })
})

describe('memoryLayer', () => {
    const note = (name: string): MemoryNote => ({ name, content: '', backlinks: [], frontmatter: { type: 'daily', tags: [], created: '', updated: '' } }) as unknown as MemoryNote
    test('digests for each named time first, then matching memory notes, no repeats', () => {
        const day = note('day-2026-11-10')
        const fact = note('meal-prep-plan')
        const out = memoryLayer('what did I do yesterday?', [day, fact], {
            now: new Date('2026-11-11T12:00:00'),
            timeRefs: () => [{ start: '2026-11-10', end: '2026-11-10' }],
            digestsCovering: () => [day],
            isDigest: n => n.name.startsWith('day-'),
            matches: [fact, day],
        })
        expect(out.map(o => [o.note.name, o.layer])).toEqual([
            ['day-2026-11-10', 'digest'],
            ['meal-prep-plan', 'memory'],
        ])
    })
})

describe('askVault', () => {
    test('one turn over the packed documents; sources located in the real text', async () => {
        const turns: HeadlessTurn[] = []
        const docs = [doc('.daemon/memory/day-2026-11-10.md', '## Notes changed\n- [[Homework 9]] written', 'digest'), doc('Homework 9.md', 'Modified Euler problem worked', 'note', 'MATH 128A homework')]
        const r = await askVault(
            { question: 'what homework did I finish?', docs, chatProvider: 'opencode', model: 'small' },
            {
                installed: () => ['opencode'],
                runTurn: async t => {
                    turns.push(t)
                    return JSON.stringify({
                        answer: 'Homework 9.',
                        sources: [
                            { path: 'Homework 9.md', quote: 'Modified Euler problem worked' },
                            { path: 'Homework 9.md', quote: 'not in it' },
                        ],
                    })
                },
            },
        )
        expect(r).toEqual({
            answer: 'Homework 9.',
            sources: [{ path: 'Homework 9.md', line: 1, text: 'Modified Euler problem worked' }],
            backend: 'opencode',
            read: [
                { path: '.daemon/memory/day-2026-11-10.md', layer: 'digest', whole: true },
                { path: 'Homework 9.md', layer: 'note', whole: true },
            ],
        })
        expect(turns).toHaveLength(1)
        expect(turns[0]!.model).toBe('small')
        expect(turns[0]!.text).toBe(buildAskVaultPrompt('what homework did I finish?', packDocs(docs)))
    })

    test('nothing reached: says so without a turn', async () => {
        let ran = false
        const r = await askVault(
            { question: 'x?', docs: [], chatProvider: 'opencode' },
            {
                installed: () => ['opencode'],
                runTurn: async () => {
                    ran = true
                    return ''
                },
            },
        )
        expect(ran).toBe(false)
        expect(r.answer).toContain("doesn't say")
    })

    test('an empty question and a missing backend are refused', async () => {
        expect((await askVault({ question: ' ', docs: [] }, { installed: () => ['opencode'] }).catch(e => e)).code).toBe('BAD_REQUEST')
        expect((await askVault({ question: 'x', docs: [], chatProvider: 'opencode' }, { installed: () => [] }).catch(e => e)).code).toBe('AI_UNAVAILABLE')
    })
})

describe('gatherAskDocs', () => {
    test('digest of the named day first, then search hits, then the notes the digest links; files read whole', async () => {
        const { gatherAskDocs } = await import('../src/askVault')
        const { join } = await import('node:path')
        const { makeVault } = await import('./helpers')
        const day = '---\ntype: daily\ntags: []\ncreated: 2026-11-10\nupdated: 2026-11-10\ndescription: "a day"\n---\n\n## Notes changed\n- [[Homework 9]] written\n- [[Secret]] edited\n'
        const vault = makeVault({
            '.daemon/memory/day-2026-11-10.md': day,
            'school/Homework 9.md': 'Modified Euler worked',
            'Secret.md': 'do not send',
            'scan.pdf.md': 'pdf transcript',
            'Hit.md': 'a search hit',
        })
        const docs = await gatherAskDocs({
            vault,
            question: 'what did I do yesterday?',
            now: new Date(2026, 10, 11, 12),
            memoryDir: join(vault, '.daemon', 'memory'),
            hits: ['Hit.md', 'scan.pdf', 'missing.pdf'],
            allowed: p => p !== 'Secret.md',
        })
        expect(docs.map(d => [d.path, d.layer])).toEqual([
            ['.daemon/memory/day-2026-11-10.md', 'digest'],
            ['Hit.md', 'note'],
            ['scan.pdf.md', 'note'],
            ['school/Homework 9.md', 'note'],
        ])
        expect(docs[0]!.text).toBe(day)
    })

    test('no memory dir: only the search hits', async () => {
        const { gatherAskDocs } = await import('../src/askVault')
        const { makeVault } = await import('./helpers')
        const vault = makeVault({ 'a.md': 'x' })
        const docs = await gatherAskDocs({ vault, question: 'q', now: new Date(), memoryDir: null, hits: ['a.md'], allowed: () => true })
        expect(docs).toEqual([{ path: 'a.md', layer: 'note', text: 'x' }])
    })
})

describe('reply paths', () => {
    test('a path echoed with plain spaces and straight quotes still names its note', () => {
        const path = 'shots/Screenshot 2026-07-07 at 3.22.08 PM.png.md'
        const sent = [{ path, layer: 'note' as const, text: 'a chart of rents' }]
        expect(locateSources([{ path: 'shots/screenshot 2026-07-07 at 3.22.08 PM.png.md', quote: 'chart of rents' }], sent)).toEqual([
            { path, line: 1, text: 'chart of rents' },
        ])
    })
})
