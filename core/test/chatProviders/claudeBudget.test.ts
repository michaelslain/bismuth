import { describe, expect, test } from 'bun:test'
import {
    CHAT_GROWTH_TOKENS,
    CLAUDE_FULL_OPENING_TOKENS,
    CLAUDE_LEAN_OPENING_TOKENS,
    claudeLeanOptions,
    claudeOutputEnv,
    claudeRetryEnv,
    claudeSkillsEnv,
    claudeTier,
    retryFrameOf,
    tierHasBrain,
    tierIsLean,
} from '../../src/chatProviders/claudeBudget'

describe('claudeTier', () => {
    test('an unknown window is full', () => {
        expect(claudeTier(null)).toBe('full')
        expect(claudeTier(undefined)).toBe('full')
    })
    test('131072 stays full', () => {
        expect(claudeTier(131_072)).toBe('full')
    })
    test('full needs the full opening plus a chat growth', () => {
        const edge = CLAUDE_FULL_OPENING_TOKENS + CHAT_GROWTH_TOKENS
        expect(claudeTier(edge)).toBe('full')
        expect(claudeTier(edge - 1)).toBe('brain')
    })
    test('a small window drops the brain block, then the profile stays lean', () => {
        expect(claudeTier(32_768)).toBe('brain')
        expect(claudeTier(8_192)).toBe('lean')
        expect(claudeTier(CLAUDE_LEAN_OPENING_TOKENS)).toBe('lean')
    })
    test('tier predicates', () => {
        expect(tierIsLean('full')).toBe(false)
        expect(tierIsLean('brain')).toBe(true)
        expect(tierHasBrain('brain')).toBe(true)
        expect(tierHasBrain('lean')).toBe(false)
    })
})

describe('claudeRetryEnv', () => {
    test('2 for a local model, 3 for cloud', () => {
        expect(claudeRetryEnv(true, {})).toEqual({ CLAUDE_CODE_MAX_RETRIES: '2' })
        expect(claudeRetryEnv(false, {})).toEqual({ CLAUDE_CODE_MAX_RETRIES: '3' })
    })
    test("the user's own value wins", () => {
        expect(claudeRetryEnv(true, { CLAUDE_CODE_MAX_RETRIES: '10' })).toEqual({})
    })
})

describe('claudeOutputEnv', () => {
    test('caps the reply at the room the tier leaves, at least 512, at most a quarter', () => {
        expect(claudeOutputEnv('lean', 8_192, {})).toEqual({
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: '512',
        })
        expect(claudeOutputEnv('brain', 32_768, {})).toEqual({
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192',
        })
        expect(claudeOutputEnv('brain', 65_536, {})).toEqual({
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: '16384',
        })
    })
    test('full, an unknown window and a user value leave it alone', () => {
        expect(claudeOutputEnv('full', 131_072, {})).toEqual({})
        expect(claudeOutputEnv('lean', null, {})).toEqual({})
        expect(
            claudeOutputEnv('lean', 8_192, { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '9' }),
        ).toEqual({})
    })
})

describe('claudeSkillsEnv', () => {
    test('the lean and brain tiers drop the bundled skills', () => {
        const on = { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1' }
        expect(claudeSkillsEnv('lean', {})).toEqual(on)
        expect(claudeSkillsEnv('brain', {})).toEqual(on)
    })
    test('full and a user value leave it alone', () => {
        expect(claudeSkillsEnv('full', {})).toEqual({})
        expect(
            claudeSkillsEnv('lean', { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '0' }),
        ).toEqual({})
    })
    test('the measured opening is the bundled-skills-off figure', () => {
        expect(CLAUDE_LEAN_OPENING_TOKENS).toBe(4_450)
    })
})

describe('claudeLeanOptions', () => {
    const opts = claudeLeanOptions([
        {
            name: 'bismuth',
            command: '/bin/bismuth-mcp',
            args: [],
            env: [{ name: 'BISMUTH_VAULT', value: '/v' }],
        },
    ])
    test('keeps the vault CLAUDE.md and skills, drops user settings', () => {
        expect(opts.settingSources).toEqual(['project'])
    })
    test('five tools and a strict explicit Bismuth server', () => {
        expect(opts.tools).toEqual(['Bash', 'Read', 'Edit', 'Write', 'Skill'])
        expect(opts.strictMcpConfig).toBe(true)
        expect(opts.mcpServers).toEqual({
            bismuth: {
                command: '/bin/bismuth-mcp',
                args: [],
                env: { BISMUTH_VAULT: '/v' },
            },
        })
    })
})

describe('retryFrameOf', () => {
    test('turns an api_retry status into a retry frame', () => {
        expect(
            retryFrameOf({
                type: 'system',
                subtype: 'api_retry',
                attempt: 2,
                max_retries: 3,
                retry_delay_ms: 1600,
                error: 'server_error',
            }),
        ).toEqual({
            type: 'retry',
            attempt: 2,
            maxAttempts: 3,
            delayMs: 1600,
            error: 'server_error',
        })
    })
    test('ignores every other message', () => {
        expect(retryFrameOf({ type: 'system', subtype: 'init' })).toBeNull()
        expect(retryFrameOf({ type: 'assistant' })).toBeNull()
    })
})

describe('claudeMcpServers', () => {
    test('equals the ACP driver spec for the same inputs', async () => {
        const { claudeMcpServers } = await import('../../src/chatProviders/claudeMcp')
        const { buildMcpServers } = await import('../../src/chatProviders/acp/driver')
        expect(claudeMcpServers('/v', '/m', '/bin/bismuth-mcp')).toEqual(
            buildMcpServers('/v', '/m', '/bin/bismuth-mcp'),
        )
        expect(claudeMcpServers('/v', undefined, null)).toEqual([])
    })
})
