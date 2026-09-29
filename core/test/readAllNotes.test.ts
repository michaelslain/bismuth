import { test, expect } from 'bun:test'
import { readAllNotes } from '../src/readAllNotes'
import { getFileAccess, setFileAccess } from '../src/fileAccess'

test('readAllNotes keeps rels order and skips a vanished file', async () => {
    const real = await getFileAccess()
    const seen: string[] = []
    setFileAccess({
        ...real,
        readNote: async (_root: string, rel: string) => {
            if (rel === 'gone.md') throw new Error('ENOENT')
            return `body of ${rel}`
        },
    })
    try {
        const out = await readAllNotes(
            '/v',
            ['b.md', 'gone.md', 'a.md'],
            rel => seen.push(rel),
        )
        expect(out).toEqual([
            { rel: 'b.md', content: 'body of b.md' },
            { rel: 'a.md', content: 'body of a.md' },
        ])
        expect(seen).toEqual(['gone.md'])
    } finally {
        setFileAccess(real)
    }
})

test('readAllNotes bounds in-flight reads', async () => {
    const real = await getFileAccess()
    let inFlight = 0
    let peak = 0
    setFileAccess({
        ...real,
        readNote: async () => {
            inFlight++
            peak = Math.max(peak, inFlight)
            await new Promise(r => setTimeout(r, 1))
            inFlight--
            return ''
        },
    })
    try {
        const rels = Array.from({ length: 200 }, (_, i) => `n${i}.md`)
        const out = await readAllNotes('/v', rels)
        expect(out.length).toBe(200)
        expect(peak).toBeLessThanOrEqual(32)
    } finally {
        setFileAccess(real)
    }
})
