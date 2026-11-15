import { describe, expect, test } from 'bun:test'
import { CHAT_GROWTH_TOKENS } from '../../src/chatProviders/claudeBudget'
import {
    CODEX_FULL_OPENING_TOKENS,
    CODEX_LEAN_OPENING_TOKENS,
    codexCompactLimit,
    codexLeanArgs,
    codexLeanBasePrompt,
    codexSeededPrompt,
    codexSummaryBudget,
    codexTier,
    condenseChat,
    isCodexWindowOverflow,
} from '../../src/chatProviders/codex/codexBudget'
import { buildCodexExecArgs } from '../../src/chatProviders/codex/driver'

describe('codexTier', () => {
    test('an unknown window is full', () => {
        expect(codexTier(null)).toBe('full')
        expect(codexTier(undefined)).toBe('full')
    })
    test('131072 stays full', () => {
        expect(codexTier(131_072)).toBe('full')
    })
    test('full needs the full opening plus a chat growth', () => {
        const edge = CODEX_FULL_OPENING_TOKENS + CHAT_GROWTH_TOKENS
        expect(codexTier(edge)).toBe('full')
        expect(codexTier(edge - 1)).toBe('lean')
    })
    test('8192 is lean', () => {
        expect(codexTier(8_192)).toBe('lean')
    })
})

describe('codexCompactLimit', () => {
    test('three quarters of the window', () => {
        expect(codexCompactLimit(8_192)).toBe(6_144)
    })
    test('never below the lean opening plus a margin', () => {
        expect(codexCompactLimit(4_096)).toBe(CODEX_LEAN_OPENING_TOKENS + 512)
    })
})

describe('codexLeanArgs', () => {
    test('none for an unknown or large window', () => {
        expect(codexLeanArgs(null, '/p.md')).toEqual([])
        expect(codexLeanArgs(131_072, '/p.md')).toEqual([])
    })
    test('lean at 8192: features off, base prompt file, compact limit', () => {
        const args = codexLeanArgs(8_192, '/b/codex-lean/p.md')
        const kv = args.filter(a => a !== '--config')
        expect(kv).toEqual([
            'features.multi_agent=false',
            'features.goals=false',
            'web_search="disabled"',
            'model_instructions_file="/b/codex-lean/p.md"',
            'model_auto_compact_token_limit=6144',
        ])
        expect(args.filter(a => a === '--config')).toHaveLength(kv.length)
    })
})

describe('codexLeanBasePrompt', () => {
    test('carries the shared instructions', () => {
        const p = codexLeanBasePrompt('You are quill, this vault daemon')
        expect(p).toContain('You are quill')
        expect(p.length).toBeLessThan(2_500)
    })
})

describe('buildCodexExecArgs with the lean profile', () => {
    const base = {
        jsonFlag: '--json' as const,
        cwd: '/v',
        threadId: null,
        imagePaths: [],
    }
    test('lean args ride along and developer_instructions is sent once, in the base file', () => {
        const lean = buildCodexExecArgs({
            ...base,
            leanArgs: codexLeanArgs(8_192, '/p.md'),
            leanBase: true,
        })
        expect(lean).toContain('features.multi_agent=false')
        expect(lean.some(a => a.startsWith('developer_instructions='))).toBe(false)
    })
    test('the full profile keeps developer_instructions and adds nothing', () => {
        const full = buildCodexExecArgs(base)
        expect(full.some(a => a.startsWith('developer_instructions='))).toBe(true)
        expect(full).not.toContain('features.multi_agent=false')
    })
})

describe('condenseChat', () => {
    const line = (role: 'user' | 'assistant', n: number) => ({
        role,
        text: `${role} message ${n} ${'x'.repeat(2_000)}`,
    })
    test('an empty chat is empty and the prompt is the message', () => {
        expect(condenseChat([], 1_000)).toBe('')
        expect(codexSeededPrompt('', 'hi')).toBe('hi')
    })
    test('each earlier message is cut, and the newest claim the budget', () => {
        const lines = Array.from({ length: 40 }, (_, i) =>
            line(i % 2 ? 'assistant' : 'user', i),
        )
        const out = condenseChat(lines, codexSummaryBudget(8_192))
        expect(out).toContain('message 39')
        expect(out).not.toContain('message 0 ')
        expect(out).toMatch(/\(\d+ earlier messages omitted\)/)
        // fits the budget (3 chars a token) plus its header
        expect(out.length).toBeLessThan(codexSummaryBudget(8_192) * 3 + 200)
        expect(codexSeededPrompt(out, 'now')).toBe(
            `<bismuth-condensed-chat>\n${out}\n</bismuth-condensed-chat>\n\nnow`,
        )
    })
    test('the budget is a quarter of the window, never under 256', () => {
        expect(codexSummaryBudget(8_192)).toBe(2_048)
        expect(codexSummaryBudget(4_000)).toBe(256)
    })
    test('the overflow error is recognised', () => {
        expect(
            isCodexWindowOverflow(
                'tokens to keep from the initial prompt is greater than the context length (7000 > 4096)',
            ),
        ).toBe(true)
        expect(isCodexWindowOverflow('rate limited')).toBe(false)
    })
})
