// How a chat reply renders reaches codex as `developer_instructions` on every `codex exec` call.
import { describe, expect, test } from 'bun:test'
import { buildCodexExecArgs } from '../../src/chatProviders/codex/driver'
import { CHAT_RENDERING_NOTE } from '../../src/chatRenderingNote'

const base = {
    jsonFlag: '--json' as const,
    cwd: '/v',
    threadId: null,
    imagePaths: [],
}

function developerInstructions(args: string[]): string | undefined {
    const value = args.find(a => a.startsWith('developer_instructions='))
    return value === undefined
        ? undefined
        : JSON.parse(value.slice('developer_instructions='.length))
}

describe('CHAT_RENDERING_NOTE', () => {
    test('names the delimiters the chat renderer parses', () => {
        expect(CHAT_RENDERING_NOTE).toContain('`$e^{i\\pi} + 1 = 0$`')
        expect(CHAT_RENDERING_NOTE).toContain('$$')
        expect(CHAT_RENDERING_NOTE).toContain('KaTeX')
    })
})

describe('buildCodexExecArgs', () => {
    test('a new thread carries the note as developer_instructions', () => {
        const args = buildCodexExecArgs(base)
        expect(developerInstructions(args)).toBe(CHAT_RENDERING_NOTE)
        expect(
            args[
                args.indexOf(
                    args.find(a => a.startsWith('developer_instructions='))!,
                ) - 1
            ],
        ).toBe('--config')
    })

    test('a resumed thread carries it too, before `resume <id>`', () => {
        const args = buildCodexExecArgs({ ...base, threadId: 't1' })
        expect(developerInstructions(args)).toBe(CHAT_RENDERING_NOTE)
        const at = args.findIndex(a => a.startsWith('developer_instructions='))
        expect(at).toBeLessThan(args.indexOf('resume'))
    })
})
