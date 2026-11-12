// `bismuth summary build|show` and `bismuth ask`: the paths that need no ai backend. The turns
// themselves are covered by core/test/noteSummaries.test.ts and core/test/askVault.test.ts.
import { describe, expect } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import { contentHash, summariesFile } from '../../core/src/noteSummaryStore'
import { isolateCliEnv, runCli, test } from './cliHarness'

isolateCliEnv()

const store = (vault: string, lines: object[]) => {
    const f = summariesFile(vault)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

describe('bismuth summary show', () => {
    test('prints the summary and each point as path:line', async () => {
        const text = '# Trip\n\nFlights booked for March 3.\n'
        const vault = makeVault({ 'trip.md': text })
        store(vault, [{ path: 'trip.md', hash: contentHash(text), summary: 'A March trip.', points: [{ text: 'flights', quote: 'Flights booked', line: 3 }] }])
        const r = await runCli(vault, 'summary', 'show', 'trip.md', '--json')
        expect(r.code).toBe(0)
        expect(r.json).toMatchObject({ summary: 'A March trip.', stale: false, points: [{ line: 3 }] })
    })

    test('a changed note is marked stale', async () => {
        const vault = makeVault({ 'trip.md': 'new text' })
        store(vault, [{ path: 'trip.md', hash: 'old', summary: 'A.', points: [] }])
        const r = await runCli(vault, 'summary', 'show', 'trip.md')
        expect(r.code).toBe(0)
        expect(r.err).toContain('changed since this summary')
    })

    test('a note with no summary names the build command', async () => {
        const vault = makeVault({ 'trip.md': 'x' })
        const r = await runCli(vault, 'summary', 'show', 'trip.md')
        expect(r.code).not.toBe(0)
        expect(r.err).toContain('bismuth summary build')
    })
})

describe('bismuth summary build', () => {
    test('--if-built does nothing for a vault that never built summaries', async () => {
        const vault = makeVault({ 'a.md': 'x' })
        const r = await runCli(vault, 'summary', 'build', '--if-built', '--json')
        expect(r.code).toBe(0)
        expect(r.json).toEqual({ skipped: 'not built' })
    })

    test('a bad --limit or --jobs is refused', async () => {
        const vault = makeVault({ 'a.md': 'x' })
        expect((await runCli(vault, 'summary', 'build', '--limit', '0')).err).toContain('--limit')
        expect((await runCli(vault, 'summary', 'build', '--jobs', 'x')).err).toContain('--jobs')
    })
})

describe('bismuth ask', () => {
    test('no question prints the usage', async () => {
        const vault = makeVault({ 'a.md': 'x' })
        const r = await runCli(vault, 'ask')
        expect(r.code).not.toBe(0)
        expect(r.err).toContain('usage: bismuth ask')
    })
})
