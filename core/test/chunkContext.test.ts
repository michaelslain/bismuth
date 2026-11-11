import { expect, test } from 'bun:test'
import type { MemoryNote } from '@bismuth/memory'
import { embedTexts, headingPathAt, noteChunks, STORE_MODEL, EMBED_MODEL } from '../src/memoryEmbed'

const mkNote = (name: string, content: string): MemoryNote =>
    ({ name, content, backlinks: [], frontmatter: { type: 'fact', tags: [] } }) as unknown as MemoryNote

test('headingPathAt: names the headings above an offset, deepest last', () => {
    const body = '# Trip\nintro\n## Packing\nsocks\n### Shoes\nboots\n## Food\nrice\n'
    const at = (s: string) => body.indexOf(s)
    expect(headingPathAt(body, [at('intro'), at('socks'), at('boots'), at('rice'), 0])).toEqual([
        'Trip',
        'Trip > Packing',
        'Trip > Packing > Shoes',
        'Trip > Food',
        '',
    ])
})

test('headingPathAt: a # inside a code fence is not a heading', () => {
    const body = '# Real\n```sh\n# a comment\n```\nafter\n'
    expect(headingPathAt(body, [body.indexOf('after')])).toEqual(['Real'])
})

test('embedTexts: with no chunk context the store embeds exactly noteChunks', () => {
    const n = mkNote('a.md', '# H\n' + 'word '.repeat(400))
    expect(embedTexts(n)).toEqual(noteChunks(n))
    expect(STORE_MODEL).toBe(EMBED_MODEL)
})

test('the shipped embedder is the catalog default when no bench switch is set', async () => {
    const { EMBED_SPECS, EMBED_SPEC } = await import('../src/embedModel')
    expect(process.env.BISMUTH_EMBED_MODEL).toBeUndefined()
    expect(EMBED_SPEC).toEqual(EMBED_SPECS.default!)
    for (const s of Object.values(EMBED_SPECS)) expect(s.query.length).toBeGreaterThan(0)
})
