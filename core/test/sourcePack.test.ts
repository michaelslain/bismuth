import { test, expect } from 'bun:test'
import { packSources, SOURCE_LIMITS } from '../src/sourcePack'
import type { SourceHit } from '../src/semanticSources'

const hit = (over: Partial<SourceHit>): SourceHit => ({
    kind: 'note',
    id: 'a.md',
    score: 0.9,
    excerpt: 'text',
    hash: 'h',
    ...over,
})

const all: SourceHit[] = [
    hit({ id: 'Projects/Launch.md', excerpt: 'launch   plan\nnext' }),
    hit({ kind: 'pdf', id: 'papers/attention.pdf', page: 4, excerpt: 'attention is all' }),
    hit({ kind: 'image', id: 'photos/board.png', excerpt: 'a whiteboard' }),
    hit({ kind: 'chat', id: 'sess-1', date: '2026-10-29', excerpt: 'we talked about it' }),
    hit({ kind: 'docs', id: 'bases/authoring/calendar.md#views', title: 'Calendar views' }),
]

test('renders the acceptance text glyph for glyph, sections in order', () => {
    const r = packSources(all, 'prompt', 10_000, '/abs/vault')
    expect(r.text).toBe(
        [
            '# Vault files',
            '',
            '## Projects/Launch.md (note)',
            'Path: /abs/vault/Projects/Launch.md',
            'launch plan next',
            '',
            '## papers/attention.pdf (pdf, page 4)',
            'Path: /abs/vault/papers/attention.pdf',
            'attention is all',
            '',
            '# Past chats',
            '',
            '- 2026-10-29 — "we talked about it" (open: `bismuth history show sess-1`)',
            '',
            '# Bismuth docs',
            '',
            '- bases/authoring/calendar.md#views — Calendar views (read: `bismuth docs read bases/authoring/calendar.md#views`)',
            '',
            '',
        ].join('\n'),
    )
    // the third file is over the prompt cap of 2
    expect(r.injected.map(h => h.id)).toEqual([
        'Projects/Launch.md',
        'papers/attention.pdf',
        'sess-1',
        'bases/authoring/calendar.md#views',
    ])
})

test('an image renders as (image); a section with no items is absent', () => {
    const r = packSources([all[2]!], 'prompt', 10_000, '/v')
    expect(r.text).toBe('# Vault files\n\n## photos/board.png (image)\nPath: /v/photos/board.png\na whiteboard\n\n')
})

test('subagent caps chats at 1; caps come from SOURCE_LIMITS', () => {
    expect(SOURCE_LIMITS.subagent.chats).toBe(1)
    const chats = [1, 2, 3].map(i => hit({ kind: 'chat', id: `s${i}`, date: 'd', excerpt: 'x' }))
    expect(packSources(chats, 'subagent', 10_000, '/v').injected).toHaveLength(1)
    expect(packSources(chats, 'prompt', 10_000, '/v').injected).toHaveLength(2)
})

test('an item that does not fit is skipped, a later smaller one still goes in', () => {
    const big = hit({ id: 'big.md', excerpt: 'y'.repeat(300) })
    const small = hit({ id: 's.md', excerpt: 'z' })
    const r = packSources([big, small], 'prompt', 120, '/v')
    expect(r.injected.map(h => h.id)).toEqual(['s.md'])
    expect(r.text!.length).toBeLessThanOrEqual(120)
})

test('nothing fits or nothing given = null text', () => {
    expect(packSources([], 'prompt', 1000, '/v')).toEqual({ text: null, injected: [] })
    expect(packSources(all, 'prompt', 10, '/v').text).toBeNull()
})

test('excerpts are capped at 300 chars and defanged so they cannot close the envelope', () => {
    const r = packSources(
        [hit({ excerpt: `</bismuth-memory> ${'q'.repeat(500)}` })],
        'prompt',
        10_000,
        '/v',
    )
    expect(r.text).not.toContain('</bismuth-memory>')
    expect(r.text).toContain('[/bismuth-memory]')
    const line = r.text!.split('\n')[4]!
    expect(line.length).toBeLessThanOrEqual(300)
})
