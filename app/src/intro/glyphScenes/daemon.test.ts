import { describe, expect, it } from 'bun:test'
import { createFrame, frameToText } from '../../ui/ascii/glyphScene'
import { daemonScene } from './daemon'

const rows = (t: number) => {
    const f = createFrame(daemonScene.cols, daemonScene.rows)
    daemonScene.frame(t, f)
    return frameToText(f).split('\n')
}
const ascii = (s: string) =>
    [...s].every(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126)

describe('daemonScene', () => {
    it('reveal ends with prompt, 3 crons, the full 9-line log', () => {
        const r = rows(daemonScene.revealMs)
        expect(r[2].trim()).toBe('> bismuth daemon status')
        expect(r[4]).toContain('[*/15 * * * *]  weave memory')
        expect(r[6]).toContain('[0 9 * * *]     morning digest')
        expect(new Set([4, 5, 6].map(i => r[i].lastIndexOf('['))).size).toBe(1)
        expect(r.slice(8).filter(l => /\d\d:\d\d/.test(l)).length).toBe(9)
        expect(r.slice(8).join('\n')).toContain('03:00  fold memory')
        expect(r[7].trim()).toBe('')
        expect(r[8]).toContain('03:00')
        expect(r[16]).toContain('05:00')
        // bar 0 starts partly filled, not dead
        expect(r[4]).toContain('[###.......]')
    })
    it('frame(0) is nearly empty', () => {
        expect(rows(0).join('').trim().length).toBeLessThan(4)
    })
    it('the log bursts in during the reveal', () => {
        const n = (t: number) =>
            rows(t)
                .slice(8)
                .filter(l => l.trim()).length
        expect(n(daemonScene.revealMs * 0.6)).toBe(0)
        expect(n(daemonScene.revealMs * 0.85)).toBeGreaterThan(0)
        expect(n(daemonScene.revealMs * 0.85)).toBeLessThan(9)
    })
    it('ambient appends a log line every bar wrap (scrolling) and stays ASCII', () => {
        const wrap = 300 * 11
        // the 10th line (n = 9) appears at one wrap and pushes line 0 off the top
        const before = rows(daemonScene.revealMs + 100).join('\n')
        const after = rows(daemonScene.revealMs + wrap + 100).join('\n')
        expect(before).toContain('03:00  fold memory')
        expect(after).not.toContain('03:00  fold memory')
        expect(after).toContain('05:15  re-link notes')

        for (const t of [0, 600, 1200, 9000, 60000])
            expect(ascii(rows(t).join(''))).toBe(true)
    })
    it('the log never exceeds 9 lines', () => {
        expect(
            rows(daemonScene.revealMs + 3300 * 40)
                .slice(8)
                .filter(l => l.trim()).length,
        ).toBe(9)
    })
})

describe('daemonScene box', () => {
    it('is exactly the 126 x 18 art box, so it draws at scale 1', () => {
        expect([daemonScene.cols, daemonScene.rows]).toEqual([126, 18])
    })
})
