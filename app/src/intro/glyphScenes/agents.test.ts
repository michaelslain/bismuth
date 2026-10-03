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
    it('lines only use \\ | / and connect each name to mcp', () => {
        const r = rows(agentsScene.revealMs)
        for (let i = 2; i <= 9; i++) expect(/^[ \\|/]*$/.test(r[i])).toBe(true)
        expect(r[9].replace(/ /g, '').length).toBeGreaterThanOrEqual(1)
    })
    it('packets move', () => {
        const a = rows(agentsScene.revealMs + 500).join('\n')
        const b = rows(agentsScene.revealMs + 740).join('\n')
        expect(a).toContain('o')
        expect(a).not.toBe(b)
    })
})
