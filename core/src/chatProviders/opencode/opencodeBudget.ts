// core/src/chatProviders/opencode/opencodeBudget.ts
// Pure: how much a chat turn injects into a model whose loaded context window is known. A model
// with a small window gets a leaner opening (the compact opencode profile, then no brain block) so
// its first request fits and the chat does not start by compacting; a model whose window is
// unknown or large gets everything. Every number here is measured, not chosen. No imports.

/** opencode's profile: its own agent prompt and full tool set, or the compact one (a one-line agent
 *  system and fewer tools, opencodeConfig.ts COMPACT_PERMISSIONS). */
export type OpencodeProfile = 'default' | 'compact'

/**
 * What a turn injects, richest first: `full` is the default profile with the brain block; `brain`
 * is the compact profile with the brain block; `lean` is the compact profile with the recall only.
 */
export type InjectTier = 'full' | 'brain' | 'lean'

export const TIERS: readonly InjectTier[] = ['full', 'brain', 'lean']

/** The opencode profile a tier runs on. */
export function tierProfile(tier: InjectTier): OpencodeProfile {
    return tier === 'full' ? 'default' : 'compact'
}

/** Whether a tier carries the session-start brain block (profile, vault map, memory index). */
export function tierHasBrain(tier: InjectTier): boolean {
    return tier !== 'lean'
}

/** The leaner of two tiers: a chat that stepped down never steps back up mid-conversation. */
export function leanerTier(a: InjectTier, b: InjectTier): InjectTier {
    return TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b
}

/**
 * Characters per token of Bismuth's injected text. Measured with qwen3.5's tokenizer on a real
 * vault's brain block: 9,457 characters, 2,693 tokens.
 */
export const CHARS_PER_TOKEN = 3.5

/**
 * opencode's own share of a turn's opening request (agent system prompt, environment block, tool
 * schemas), per profile, without Bismuth's text or the message. Measured on opencode 2.3.0 through
 * LM Studio's tokenizer: default 9,916 tokens and compact 2,402 for a one-line message, less
 * Bismuth's 197-token chat note. A turn that reports its input tokens replaces these
 * (`observedBase`), so a user's own MCP servers or agents are counted once seen.
 */
export const OPENCODE_BASE_TOKENS: Record<OpencodeProfile, number> = {
    default: 9_700,
    compact: 2_200,
}

/**
 * The room a chat needs past its opening request: the median tokens a chat grows over its first
 * message (the reply, its tool calls and their results), measured on 254 in-app vault chats. Held
 * out: fit on the older half (7,142), 46% of the newer half's first messages fit inside it.
 */
export const CHAT_GROWTH_TOKENS = 7_300

/**
 * The share of a loaded window opencode lets a request fill before it compacts the chat: the window
 * less 15%, and at least 16,000 tokens once the window is 32,000 or more. Read from opencode 2.3.0's
 * session compaction (no `compaction.buffer` configured); a request estimated past it is compacted
 * before it is sent, and an opening request past it fails ("cannot be reduced further").
 */
export function opencodeUsable(window: number): number {
    return window - Math.max(Math.floor(window * 0.15), window >= 32_000 ? 16_000 : 0)
}

/** Estimated tokens of a text Bismuth injects or the user sent. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export type TurnBudget = {
    /** The model's loaded context window; null when unknown (a cloud model, a server that does
     *  not report one). */
    window: number | null
    /** opencode's own opening tokens per profile. */
    base: Record<OpencodeProfile, number>
    /** Tokens of the text every tier carries: the chat note, the line-ref note, the recall. */
    always: number
    /** Tokens of the brain block. */
    brain: number
    /** Tokens of the user's message. */
    message: number
}

/** Tokens a tier's opening request is expected to take. */
export function tierOpening(tier: InjectTier, b: TurnBudget): number {
    return (
        b.base[tierProfile(tier)] +
        b.always +
        (tierHasBrain(tier) ? b.brain : 0) +
        b.message
    )
}

/**
 * The richest tier whose opening request leaves a chat's first-message growth inside the share of
 * the window opencode fills before compacting (`opencodeUsable`); the leanest when none does. An
 * unknown window injects everything.
 */
export function pickTier(b: TurnBudget): InjectTier {
    if (b.window === null) return 'full'
    const usable = opencodeUsable(b.window)
    return (
        TIERS.find(t => tierOpening(t, b) + CHAT_GROWTH_TOKENS <= usable) ??
        'lean'
    )
}

/**
 * opencode's own share of a turn, from the input tokens its first step reported: the input less
 * what Bismuth injected and the message. Null when the report cannot be a whole opening request.
 */
export function observedBase(
    inputTokens: number,
    injected: number,
    message: number,
): number | null {
    const base = inputTokens - injected - message
    return base > 0 ? base : null
}
