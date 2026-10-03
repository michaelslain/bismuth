import { describe, expect, it } from 'bun:test'
import { createFrame, frameToText } from '../../ui/ascii/glyphScene'
import { WORDMARK, WORDMARK_ROWS } from './wordmarkBitmap'
import { wordmarkScene, SHEEN_PERIOD_MS } from './wordmark'

const render = (t: number) => {
    const f = createFrame(wordmarkScene.cols, wordmarkScene.rows)
    wordmarkScene.frame(t, f)
    return f
}
const ascii = (s: string) =>
    [...s.replace(/\n/g, '')].every(
        ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126,
    )

const sheenCols = (t: number) => {
    const f = render(t)
    const out: number[] = []
    for (let i = 0; i < f.chars.length; i++)
        if (f.chars[i] === 64) out.push(i % 96)
    return out
}

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
        for (const t of [0, 450, 900, 5000, 12000])
            expect(ascii(frameToText(render(t)))).toBe(true)
    })
    it('reveal converges: frame(revealMs) has every letter cell drawn as # (or @ under the sheen)', () => {
        const f = render(wordmarkScene.revealMs)
        const col0 = Math.floor((96 - WORDMARK[0].length) / 2)
        for (let r = 0; r < WORDMARK_ROWS; r++)
            for (let c = 0; c < WORDMARK[0].length; c++)
                if (WORDMARK[r][c] === '#') {
                    const ch = String.fromCharCode(
                        f.chars[(r + 3) * 96 + col0 + c],
                    )
                    expect('#@').toContain(ch)
                }
    })
    it('frame(0) shows fewer letter glyphs than frame(revealMs)', () => {
        const count = (f: ReturnType<typeof render>) =>
            [...frameToText(f)].filter(ch => ch === '#').length
        expect(count(render(0))).toBeLessThan(
            count(render(wordmarkScene.revealMs)) / 4,
        )
    })
    it('is deterministic and the sheen moves', () => {
        expect(frameToText(render(3000))).toBe(frameToText(render(3000)))
        expect(frameToText(render(3000))).not.toBe(
            frameToText(render(3000 + SHEEN_PERIOD_MS / 4)),
        )
        expect(frameToText(render(3000))).toContain('@')
    })
    it('sheen is a 3-wide band that sweeps right with an 8s period', () => {
        const a = new Set(sheenCols(wordmarkScene.revealMs + 2000))
        const b = new Set(sheenCols(wordmarkScene.revealMs + 4000))
        expect(a.size).toBeGreaterThan(0)
        expect(Math.max(...a) - Math.min(...a)).toBeLessThanOrEqual(2)
        expect(Math.min(...b)).toBeGreaterThan(Math.min(...a))
        expect(sheenCols(wordmarkScene.revealMs + 2000)).toEqual(
            sheenCols(wordmarkScene.revealMs + 10000),
        )
        expect(SHEEN_PERIOD_MS).toBe(8000)
    })
})
