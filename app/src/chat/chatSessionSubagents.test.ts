import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// A ChatSession cannot be mounted under bun's test runner (see chatSessionLocalMode.test.ts), so
// this is a structural guard on the source: where the agents strip clears.
const src = readFileSync(new URL('./chatSession.ts', import.meta.url), 'utf8')

function body(name: string): string {
    const start = src.indexOf(`const ${name} = `)
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('\n    }\n', start)
    return src.slice(start, end)
}

describe('subagents strip lifetime', () => {
    test('deliver clears only after the idle send succeeded, never on the mid-turn branches', () => {
        const b = body('deliver')
        expect(b.match(/setSubagents\(\[\]\)/g)?.length).toBe(1)
        const clear = b.indexOf('setSubagents([])')
        expect(clear).toBeGreaterThan(b.indexOf('if (streaming())'))
        expect(clear).toBeGreaterThan(b.indexOf('Not connected to the backend'))
        expect(b.slice(clear - 200, clear)).toContain('setTurnError(null)')
    })
    test('a staged turn starting clears the strip', () => {
        const b = body('dispatchQueued')
        expect(b).toMatch(/setQueuedTurns\(q\.slice\(1\)\)\n\s+\/\/[^\n]*\n\s+setSubagents\(\[\]\)/)
    })
    test('resetTranscript clears the strip', () => {
        expect(body('resetTranscript')).toContain('setSubagents([])')
    })
})
