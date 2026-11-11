// `bismuth find`: literal matches in one note, and the hidden-from-ai gate the ai fallback shares
// with POST /find-ai. The ai turn itself is covered by core/test/findAi.test.ts.
import { describe, expect } from 'bun:test'
import { makeVault } from '../../core/test/helpers'
import { literalMatches } from '../src/commands/search'
import { runCli, test } from './cliHarness'

describe('literalMatches', () => {
    test('every occurrence, case folded unless asked', () => {
        expect(literalMatches('Ab ab AB', 'ab', false)).toEqual([
            { from: 0, to: 2 },
            { from: 3, to: 5 },
            { from: 6, to: 8 },
        ])
        expect(literalMatches('Ab ab AB', 'ab', true)).toEqual([{ from: 3, to: 5 }])
        expect(literalMatches('x', '', false)).toEqual([])
    })
})

describe('bismuth find', () => {
    test('prints line, column and match for a literal hit', async () => {
        const vault = makeVault({ 'n.md': 'first\nbuy oat milk\n' })
        const r = await runCli(vault, 'find', 'n.md', 'oat', '--json')
        expect(r.code).toBe(0)
        expect(r.json).toEqual([{ from: 10, to: 13, line: 2, col: 5, text: 'buy oat milk', match: 'oat', ai: false }])
    })

    test('a note hidden from ai never reaches a backend', async () => {
        const vault = makeVault({ 's.md': '---\nvisibility: hidden\n---\nthe pin\n' })
        const r = await runCli(vault, 'find', 's.md', 'zebra', '--ai')
        expect(r.code).not.toBe(0)
        expect(r.err).toContain('hidden from ai')
    })

    test('--ask on a note hidden from ai is refused the same way', async () => {
        const vault = makeVault({ 's.md': '---\nvisibility: hidden\n---\nthe pin\n' })
        const r = await runCli(vault, 'find', 's.md', 'what is the pin?', '--ask')
        expect(r.code).not.toBe(0)
        expect(r.err).toContain('hidden from ai')
    })
})
