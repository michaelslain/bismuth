import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// A ChatSession cannot be mounted under bun's test runner (see chatSessionLocalMode.test.ts), so
// this is a structural guard on the source: `sendText` shares `send`'s delivery path and never
// reaches the draft or the attachments.
const src = readFileSync(new URL('./chatSession.ts', import.meta.url), 'utf8')

function body(name: string): string {
    const start = src.indexOf(`const ${name} = `)
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('\n    }\n', start)
    return src.slice(start, end)
}

describe('sendText', () => {
    test('delivers through the same path send() takes', () => {
        expect(body('send')).toContain('deliver(text, atts)')
        expect(body('sendText')).toContain('deliver(t, [])')
    })
    test('never touches the draft or the attachments', () => {
        const b = body('sendText')
        expect(b).not.toMatch(/setDraft|setAttachments|draft\(\)|attachments\(\)/)
    })
    test('is gated like send: blank, setup error, refusal', () => {
        const b = body('sendText')
        expect(b).toContain('!t')
        expect(b).toContain('setupError()')
        expect(b).toContain('gateRefusal()')
    })
    test('delivery carries the editor-context preamble + queueing while streaming', () => {
        const b = body('deliver')
        expect(b).toContain('buildEditorContext(')
        expect(b).toContain('if (streaming())')
        expect(b).toContain('setQueuedTurns(')
        expect(b).toContain("type: 'user'")
    })
    test('delivery leaves draft and attachments to the caller', () => {
        expect(body('deliver')).not.toMatch(/setDraft|setAttachments/)
    })
    test('ChatSession exposes sendText', () => {
        expect(src).toContain('sendText: (text: string) => void')
        expect(src).toMatch(/\n {8}send,\n {8}sendText,/)
    })
})
