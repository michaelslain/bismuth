import { describe, expect, it } from 'bun:test'
import { createFrame, frameToText } from '../../ui/ascii/glyphScene'
import { AGENTS, agentsScene } from './agents'

const rows = (t: number) => {
    const f = createFrame(agentsScene.cols, agentsScene.rows)
    agentsScene.frame(t, f)
    return frameToText(f).split('\n')
}

describe('agentsScene', () => {
    it('names every agent on row 4, mcp on 13, vault on 16', () => {
        const r = rows(agentsScene.revealMs)
        for (const a of AGENTS) expect(r[4]).toContain(`[${a}]`)
        expect(r[13].trim()).toBe('[ mcp ]')
        expect(r[16].trim()).toBe('( vault )')
    })
    it('lines only use \\ | / _ and connect each name to mcp', () => {
        const r = rows(agentsScene.revealMs)
        for (let i = 5; i <= 12; i++) expect(/^[ \\|/_]*$/.test(r[i])).toBe(true)
        expect(r[12].replace(/ /g, '').length).toBeGreaterThanOrEqual(1)
        expect(r[5].replace(/[ _]/g, '').length).toBe(AGENTS.length)
        for (const a of AGENTS) {
            const s = r[4].indexOf(`[${a}]`)
            expect(
                r[5].slice(s, s + a.length + 2).replace(/[ _]/g, '').length,
            ).toBe(1)
        }
        const first = [...r[12]].findIndex(ch => ch !== ' ')
        expect(first).toBeGreaterThanOrEqual(r[13].indexOf('['))
        expect(first).toBeLessThanOrEqual(r[13].indexOf(']'))
    })
    it('packets move', () => {
        // the body only: the agent-name row contain 'o' on their own
        const body = (t: number) => {
            const r = rows(t)
            return [...r.slice(5, 13), ...r.slice(14, 16)].join('')
        }
        const a = body(agentsScene.revealMs + 500)
        expect(a).toContain('o')
        expect(a).not.toBe(body(agentsScene.revealMs + 740))
    })
})

describe('agentsScene box', () => {
    it('is exactly the 126 x 18 art box, so it draws at scale 1', () => {
        expect([agentsScene.cols, agentsScene.rows]).toEqual([126, 18])
    })
})
