// core/src/chatProviders/claudeBudget.ts
// Pure: how much a claude chat opens with, given the loaded context window of a local model, and
// how many times the CLI retries a failed model call. A small window gets a lean opening (the
// vault's own CLAUDE.md and skills, Bismuth's MCP server, five tools) so the first request fits and
// the chat does not start by failing. The lean tier (below 14.5k) also drops Claude Code's preset
// prompt for the shared chat instructions plus the cwd: the preset is 8.4k characters, and at an
// 8192 window the opening plus one message did not fit with it (compaction on turn 1). The brain
// tier keeps the preset. An unknown or large window gets the full profile. Twin of opencode/opencodeBudget.ts. Every number is measured against the mock.

import type { AcpMcpServerStdio } from './acp/protocol'
import type { ChatFrame } from '../chat'

/** What a claude chat opens with, richest first: `full` is the CLI's own profile (user settings,
 *  every tool, plugins' session hooks) with the brain block; `brain` is the lean profile with the
 *  brain block; `lean` is the lean profile with the recall only and, in place of Claude Code's
 *  preset prompt, the shared chat instructions alone (the preset is 8.4k characters, and at an
 *  8192 window the opening plus one message did not fit with it: compaction turn 1). */
export type ClaudeTier = 'full' | 'brain' | 'lean'

/**
 * The room a chat needs past its opening request: the median tokens a chat grows over its first
 * message, measured on 254 in-app vault chats (the same figure opencodeBudget.ts carries).
 */
export const CHAT_GROWTH_TOKENS = 7_300

/**
 * The opening request of a full-profile claude chat on a real machine: 58,700 tokens (235,079
 * characters at the mock's 4 characters per token): user CLAUDE.md and rules ~29k, plugin
 * SessionStart hooks ~19k, 13 tool schemas ~8.5k, preset prompt ~2.3k. Measured with
 * dumpRun.ts against claude@mock, claude CLI 2.1.325 (diag-claude #1).
 */
export const CLAUDE_FULL_OPENING_TOKENS = 58_700

/**
 * The opening request of the lean profile with the CLI's bundled skills off
 * (`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, see claudeSkillsEnv), measured with claudeProbe.ts
 * against claude@mock, claude CLI 2.1.325, bench vault with its CLAUDE.md and one skill, brain
 * block off, a one-word message: 4,448 tokens (5,907 with the bundled skill listing, ~1,500
 * tokens). The vault skill, the Bismuth tool and the daemon name stay in it. Rounded up.
 */
export const CLAUDE_LEAN_OPENING_TOKENS = 4_450

/** The brain block's share of a first request: 9,457 characters, 2,693 tokens (opencodeBudget.ts). */
export const BRAIN_TOKENS = 2_700

/** Whether a tier carries the session-start brain block (profile, vault map, memory index). */
export function tierHasBrain(tier: ClaudeTier): boolean {
    return tier !== 'lean'
}

/** Whether a tier runs the lean profile rather than the CLI's own. */
export function tierIsLean(tier: ClaudeTier): boolean {
    return tier !== 'full'
}

/**
 * The tier for a loaded window: the richest whose opening plus a chat's growth fits. `null`
 * (a cloud model, a server that reports no window) is `full`.
 */
export function claudeTier(window: number | null | undefined): ClaudeTier {
    if (!window) return 'full'
    if (window >= CLAUDE_FULL_OPENING_TOKENS + CHAT_GROWTH_TOKENS) return 'full'
    if (window >= CLAUDE_LEAN_OPENING_TOKENS + BRAIN_TOKENS + CHAT_GROWTH_TOKENS)
        return 'brain'
    return 'lean'
}

/** The retry cap for the CLI's own model-call retries: 2 for a local model (a local server's 500 is
 *  not transient), 3 for cloud. The CLI's default of 10 with exponential backoff took over a
 *  minute to give up on a 500. The user's own `CLAUDE_CODE_MAX_RETRIES` wins. */
export function claudeRetryEnv(
    local: boolean,
    env: Record<string, string | undefined>,
): Record<string, string> {
    if (env.CLAUDE_CODE_MAX_RETRIES) return {}
    return { CLAUDE_CODE_MAX_RETRIES: local ? '2' : '3' }
}

/** The lean profile drops the CLI's bundled skill listing (dataviz, claude-api, ...: ~1,500
 *  tokens of every opening). The vault's own `.claude/skills` and the Bismuth MCP server are
 *  unaffected. The user's own value wins. */
export function claudeSkillsEnv(
    tier: ClaudeTier,
    env: Record<string, string | undefined>,
): Record<string, string> {
    if (!tierIsLean(tier) || env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS) return {}
    return { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1' }
}

/** The tokens a tier's first request takes: the lean opening, plus the brain block on `brain`. */
function openingTokens(tier: ClaudeTier): number {
    return CLAUDE_LEAN_OPENING_TOKENS + (tierHasBrain(tier) ? BRAIN_TOKENS : 0)
}

/**
 * The CLI refuses a prompt locally ("Prompt is too long", no request sent) when it plus the reply
 * it reserves exceeds the window. Its reserve is far larger than a small window can spare: on a
 * model it does not know, a 7,574-token opening (before bundled skills were dropped)
 * failed at every window below 32,000 and passed
 * once `CLAUDE_CODE_MAX_OUTPUT_TOKENS` was 1,024 (8,192 and 12,000 windows both opened; a 1,024 cap
 * still refused an 8,192 window's 5,900-token opening plus a 1,500-token message). So the lean
 * profile caps the reply at the room the tier leaves past its opening and a chat's growth, at most
 * a quarter of the window and at least 512 tokens: 8,192 gets 512, 32,768 gets 8,192, 65,536 gets
 * 16,384, so a mid-size Write still fits on a roomy window. The user's own value wins.
 */
export function claudeOutputEnv(
    tier: ClaudeTier,
    window: number | null | undefined,
    env: Record<string, string | undefined>,
): Record<string, string> {
    if (!tierIsLean(tier) || !window || env.CLAUDE_CODE_MAX_OUTPUT_TOKENS)
        return {}
    const room = window - openingTokens(tier) - CHAT_GROWTH_TOKENS
    return {
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(
            Math.max(512, Math.min(Math.floor(window / 4), room)),
        ),
    }
}

/** The tools the lean profile keeps: Bismuth's own CLI runs through Bash, the vault's skill through
 *  Skill; the rest (Agent, Workflow, AskUserQuestion, ...) are ~25k characters of schema. */
export const LEAN_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Skill'] as const

export type ClaudeLeanOptions = {
    settingSources: ['project']
    tools: string[]
    strictMcpConfig: true
    mcpServers: Record<
        string,
        { command: string; args: string[]; env: Record<string, string> }
    >
}

/** The `query()` options of the lean profile. `settingSources: ['project']` keeps the vault's own
 *  CLAUDE.md and `.claude/skills` and drops the user's CLAUDE.md, rules, plugins and MCP; the
 *  Bismuth MCP server is passed explicitly and strictly, so only it loads. */
export function claudeLeanOptions(mcp: AcpMcpServerStdio[]): ClaudeLeanOptions {
    const mcpServers: ClaudeLeanOptions['mcpServers'] = {}
    for (const m of mcp)
        mcpServers[m.name] = {
            command: m.command,
            args: m.args,
            env: Object.fromEntries(m.env.map(e => [e.name, e.value])),
        }
    return {
        settingSources: ['project'],
        tools: [...LEAN_TOOLS],
        strictMcpConfig: true,
        mcpServers,
    }
}

/** A CLI `api_retry` status message as a retry frame; null for any other message. */
export function retryFrameOf(msg: {
    type?: string
    subtype?: string
    attempt?: number
    max_retries?: number
    retry_delay_ms?: number
    error?: unknown
}): Extract<ChatFrame, { type: 'retry' }> | null {
    if (msg.type !== 'system' || msg.subtype !== 'api_retry') return null
    return {
        type: 'retry',
        attempt: msg.attempt ?? 1,
        ...(msg.max_retries ? { maxAttempts: msg.max_retries } : {}),
        ...(msg.retry_delay_ms !== undefined
            ? { delayMs: msg.retry_delay_ms }
            : {}),
        ...(typeof msg.error === 'string' ? { error: msg.error } : {}),
    }
}
