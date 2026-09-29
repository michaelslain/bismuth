import { test, expect } from 'bun:test'
import { buildCodexExecArgs } from '../src/daemon/codexSession.ts'

const base = { jsonFlag: '--json', cwd: '/vault' } as const
const flagValue = (args: string[]) =>
    args.find(a => a.startsWith('developer_instructions='))

test('developer_instructions rides a new call and a resume call', () => {
    const persona = 'You are Atlas.'
    for (const threadId of [undefined, 'thr_1']) {
        const args = buildCodexExecArgs({
            ...base,
            threadId,
            developerInstructions: persona,
        })
        const i = args.indexOf(`developer_instructions=${JSON.stringify(persona)}`)
        expect(i).toBeGreaterThan(0)
        expect(args[i - 1]).toBe('--config')
        if (threadId) expect(args.slice(-2)).toEqual(['resume', threadId])
    }
})

test('the persona is a valid TOML basic string for a quote, a backslash and a newline', () => {
    const persona = 'say "hi"\\path\nnext'
    const args = buildCodexExecArgs({ ...base, developerInstructions: persona })
    const v = flagValue(args)!.slice('developer_instructions='.length)
    expect(v).toBe('"say \\"hi\\"\\\\path\\nnext"')
    expect(JSON.parse(v)).toBe(persona)
})

test('no developer_instructions flag without a persona', () => {
    expect(flagValue(buildCodexExecArgs({ ...base }))).toBeUndefined()
})
