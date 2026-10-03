import { describe, expect, it } from 'bun:test'
import { createFrame, frameToText } from '../../ui/ascii/glyphScene'
import { WORDMARK, WORDMARK_ROWS } from './wordmarkBitmap'
import { wordmarkScene, SHEEN_PERIOD_MS } from './wordmark'

const render = (t: number) => {
    const f = createFrame(wordmarkScene.cols, wordmarkScene.rows)
    wordmarkScene.frame(t, f)
    return f
}
const ascii = (s: string) => [...s.replace(/\n/g, '')].every(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126)

describe('wordmark bitmap', () => {
    it('is 9 equal-length rows of # and .', () => {
        expect(WORDMARK.length).toBe(WORDMARK_ROWS)
        const w = WORDMARK[0].length
        expect(w).toBeGreaterThanOrEqual(56)
        expect(w).toBeLessThanOrEqual(70)
        for (const row of WORDMARK) {
            expect(row.length).toBe(w)
            expect(/^[#.]+$/.test(row)).toBe(true)
        }
    })
    it('snapshot reads as bismuth', () => {
        expect(WORDMARK.join('\n')).toMatchSnapshot()
    })
})

describe('wordmarkScene', () => {
    it('is 96x16 and plain ASCII at every phase', () => {
        for (const t of [0, 450, 900, 5000, 12000]) expect(ascii(frameToText(render(t)))).toBe(true)
    })
    it('reveal converges: frame(revealMs) has every letter cell drawn as # or +', () => {
        const f = render(wordmarkScene.revealMs)
        const col0 = Math.floor((96 - WORDMARK[0].length) / 2)
        for (let r = 0; r < WORDMARK_ROWS; r++)
            for (let c = 0; c < WORDMARK[0].length; c++)
                if (WORDMARK[r][c] === '#') {
                    const ch = String.fromCharCode(f.chars[(r + 3) * 96 + col0 + c])
                    expect('#+@').toContain(ch)
                }
    })
    it('frame(0) shows fewer letter glyphs than frame(revealMs)', () => {
        const count = (f: ReturnType<typeof render>) => [...frameToText(f)].filter(ch => ch === '#' || ch === '+').length
        expect(count(render(0))).toBeLessThan(count(render(wordmarkScene.revealMs)) / 4)
    })
    it('is deterministic and the sheen moves', () => {
        expect(frameToText(render(3000))).toBe(frameToText(render(3000)))
        expect(frameToText(render(3000))).not.toBe(frameToText(render(3000 + SHEEN_PERIOD_MS / 4)))
        expect(frameToText(render(3000))).toContain('@')
    })
})
