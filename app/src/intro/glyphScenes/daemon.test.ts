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
    it('reveal ends with prompt, 3 crons, 3 log lines', () => {
        const r = rows(daemonScene.revealMs)
        expect(r[1].trim()).toBe('> bismuth daemon status')
        expect(r[3]).toContain('[*/15 * * * *]  weave memory')
        expect(r[5]).toContain('[0 9 * * *]  morning digest')
        expect(r.slice(7).filter(l => /\d\d:\d\d/.test(l)).length).toBe(3)
        expect(r.slice(7).join('\n')).toContain('03:00  fold memory')
    })
    it('frame(0) is nearly empty', () => {
        expect(rows(0).join('').trim().length).toBeLessThan(4)
    })
    it('ambient appends a log line every bar wrap and stays ASCII', () => {
        const before = rows(daemonScene.revealMs + 100)
            .slice(7)
            .filter(l => l.trim()).length
        const after = rows(daemonScene.revealMs + 3400)
            .slice(7)
            .filter(l => l.trim()).length
        expect(after).toBe(before + 1)
        expect(rows(daemonScene.revealMs + 3400).join('\n')).toContain(
            '03:45  weave memory',
        )
        for (const t of [0, 600, 1200, 9000, 60000])
            expect(ascii(rows(t).join(''))).toBe(true)
    })
    it('the log never exceeds 9 lines', () => {
        expect(
            rows(daemonScene.revealMs + 3300 * 40)
                .slice(7)
                .filter(l => l.trim()).length,
        ).toBe(9)
    })
})
