import { describe, it, expect } from 'bun:test'
import { coverNoise, pathSeed, COVER_COLS, COVER_ROWS } from './coverFingerprint'

describe('coverFingerprint', () => {
    it('is deterministic per path', () => {
        expect(coverNoise('reading/Dune.md')).toBe(coverNoise('reading/Dune.md'))
        expect(pathSeed('a.md')).toBe(pathSeed('a.md'))
    })

    it('differs between paths, even near-identical ones', () => {
        const paths = ['a.md', 'b.md', 'reading/Dune.md', 'reading/Dune 2.md', 'Dune.md']
        const covers = new Set(paths.map(p => coverNoise(p)))
        expect(covers.size).toBe(paths.length)
    })

    it('fills the cover grid', () => {
        const lines = coverNoise('x.md').split('\n')
        expect(lines).toHaveLength(COVER_ROWS)
        for (const line of lines) expect(line.length).toBe(COVER_COLS)
    })

    it('stays in the positive 31-bit seed space', () => {
        for (const p of ['', 'a', 'zzzzzzzzzzzzzzzzzzzz.md', 'ünïcødé/ノート.md']) {
            const s = pathSeed(p)
            expect(s).toBeGreaterThanOrEqual(0)
            expect(s).toBeLessThanOrEqual(0x7fffffff)
        }
    })
})
