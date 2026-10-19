import { describe, expect, it } from 'bun:test'
import { createFrame, frameToText } from '../../ui/ascii/glyphScene'
import { AGENTS, agentsScene } from './agents'

const rows = (t: number) => {
    const f = createFrame(agentsScene.cols, agentsScene.rows)
    agentsScene.frame(t, f)
    return frameToText(f).split('\n')
}

describe('agentsScene', () => {
    it('names every agent on row 0, mcp on 7, vault on 9', () => {
        const r = rows(agentsScene.revealMs)
        for (const a of AGENTS) expect(r[0]).toContain(`[${a}]`)
        expect(r[7].trim()).toBe('[ mcp ]')
        expect(r[8].trim()).toBe('|')
        expect(r[9].trim()).toBe('( vault )')
    })
    it('lines only use \\ | / _ and connect each name to mcp', () => {
        const r = rows(agentsScene.revealMs)
        for (let i = 1; i <= 6; i++) expect(/^[ \\|/_]*$/.test(r[i])).toBe(true)
        expect(r[6].replace(/ /g, '').length).toBeGreaterThanOrEqual(1)
        expect(r[1].replace(/[ _]/g, '').length).toBe(AGENTS.length)
        for (const a of AGENTS) {
            const s = r[0].indexOf(`[${a}]`)
            expect(
                r[1].slice(s, s + a.length + 2).replace(/[ _]/g, '').length,
            ).toBe(1)
        }
        const first = [...r[6]].findIndex(ch => ch !== ' ')
        expect(first).toBeGreaterThanOrEqual(r[7].indexOf('['))
        expect(first).toBeLessThanOrEqual(r[7].indexOf(']'))
    })
    it('packets move', () => {
        // the body only: the agent-name row contain 'o' on their own
        const body = (t: number) => {
            const r = rows(t)
            return [...r.slice(1, 7), r[8]].join('')
        }
        const a = body(agentsScene.revealMs + 500)
        expect(a).toContain('o')
        expect(a).not.toBe(body(agentsScene.revealMs + 740))
    })
})

describe('agentsScene box', () => {
    it('is cut to its content, 59 x 10, so a scaled-up copy fits the art box', () => {
        expect([agentsScene.cols, agentsScene.rows]).toEqual([59, 10])
        const r = rows(agentsScene.revealMs)
        for (const l of r) expect(l.length).toBeLessThanOrEqual(agentsScene.cols)
    })
})
