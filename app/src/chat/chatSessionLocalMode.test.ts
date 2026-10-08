import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// A ChatSession cannot be mounted under bun's test runner (Solid resolves to its server build and
// createChatSession needs window/WebSocket), so this is a structural guard: the session-local
// setter must never reach the persistence seam, and only the persisting one may.
const src = readFileSync(new URL('./chatSession.ts', import.meta.url), 'utf8')

function body(name: string): string {
    const start = src.indexOf(`const ${name} = `)
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('\n    }\n', start)
    return src.slice(start, end)
}

describe('setPermissionModeLocal', () => {
    test('sets the signal and sends, but never persists', () => {
        const b = body('setPermissionModeLocal')
        expect(b).toContain('setPermMode(mode)')
        expect(b).toContain("type: 'set_permission_mode'")
        expect(b).not.toMatch(/persistMode|rememberMode|storage|localStorage/)
    })
    test('the persisting setter still persists (guard is meaningful)', () => {
        expect(body('setPermissionMode')).toContain('persistMode(storage, mode)')
    })
})
