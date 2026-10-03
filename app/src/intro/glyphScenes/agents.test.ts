import { describe, expect, it } from 'bun:test'
import { createFrame, frameToText } from '../../ui/ascii/glyphScene'
import { AGENTS, agentsScene } from './agents'

const rows = (t: number) => {
    const f = createFrame(agentsScene.cols, agentsScene.rows)
    agentsScene.frame(t, f)
    return frameToText(f).split('\n')
}

describe('agentsScene', () => {
    it('names every agent on row 1, mcp on 10, vault on 13', () => {
        const r = rows(agentsScene.revealMs)
        for (const a of AGENTS) expect(r[1]).toContain(`[${a}]`)
        expect(r[10].trim()).toBe('[ mcp ]')
        expect(r[13].trim()).toBe('( vault )')
    })
    it('lines only use \\ | / _ and connect each name to mcp', () => {
        const r = rows(agentsScene.revealMs)
        for (let i = 2; i <= 9; i++) expect(/^[ \\|/_]*$/.test(r[i])).toBe(true)
        expect(r[9].replace(/ /g, '').length).toBeGreaterThanOrEqual(1)
        expect(r[2].replace(/[ _]/g, '').length).toBe(AGENTS.length)
        for (const a of AGENTS) {
            const s = r[1].indexOf(`[${a}]`)
            expect(
                r[2].slice(s, s + a.length + 2).replace(/[ _]/g, '').length,
            ).toBe(1)
        }
        const first = [...r[9]].findIndex(ch => ch !== ' ')
        expect(first).toBeGreaterThanOrEqual(r[10].indexOf('['))
        expect(first).toBeLessThanOrEqual(r[10].indexOf(']'))
    })
    it('packets move', () => {
        // the body only: row 1's agent names contain 'o' on their own
        const body = (t: number) => {
            const r = rows(t)
            return [...r.slice(2, 10), ...r.slice(11, 13)].join('')
        }
        const a = body(agentsScene.revealMs + 500)
        expect(a).toContain('o')
        expect(a).not.toBe(body(agentsScene.revealMs + 740))
    })
})
