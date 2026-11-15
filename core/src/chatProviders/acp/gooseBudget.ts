// core/src/chatProviders/acp/gooseBudget.ts
// Which goose profile a chat on a local model runs, from the model's loaded window. Pure.
//
// goose's opening request is its system prompt plus its tool schemas. With goose 1.59.1's default
// extensions it lists every agent in the user's `~/.claude/agents` (its summon extension) and every
// skill it finds, so it runs to tens of thousands of tokens on a well-stocked machine. The lean
// profile keeps only goose's developer extension (shell, file reading and editing), set through
// goose's `EXTENSIONS` environment variable, which it reads before its config file, so the user's
// goose config is never edited. goose appends the skills list whatever the extensions are, so the
// lean profile still carries it.
import {
    CHAT_GROWTH_TOKENS,
    CHARS_PER_TOKEN,
} from '../opencode/opencodeBudget'

export type GooseProfile = 'full' | 'lean'

/** goose's `EXTENSIONS` value for the lean profile: the developer extension alone. */
export const GOOSE_LEAN_EXTENSIONS = JSON.stringify({
    developer: {
        bundled: true,
        enabled: true,
        name: 'developer',
        timeout: 300,
        type: 'builtin',
    },
})

/** The spawn env a profile adds: none for the full profile. */
export function gooseProfileEnv(profile: GooseProfile): Record<string, string> {
    return profile === 'lean' ? { EXTENSIONS: GOOSE_LEAN_EXTENSIONS } : {}
}

/** Tokens in `chars` characters of prompt text, at the measured qwen3.5 rate. */
export function charsToTokens(chars: number): number {
    return Math.ceil(chars / CHARS_PER_TOKEN)
}

export type GooseBudget = {
    /** The model's loaded context window, in tokens. */
    window: number
    /** goose's own opening request per profile, in tokens (gooseMeasure.ts). */
    opening: Record<GooseProfile, number>
    /** Bismuth's share of the first prompt (its chat instructions and MCP tool), in tokens. */
    extra: number
}

/**
 * The richest profile whose opening request leaves room for a chat's first exchange
 * (CHAT_GROWTH_TOKENS) inside the window, else lean. goose sends its first request whole at any
 * GOOSE_CONTEXT_LIMIT (verified on 1.59.1: no compaction before the first turn), so `fits` is
 * false when even the lean opening is larger than the window: the server would cut the prompt.
 */
export function pickGooseProfile(b: GooseBudget): {
    profile: GooseProfile
    fits: boolean
    tokens: number
} {
    const full = b.opening.full + b.extra
    if (full + CHAT_GROWTH_TOKENS <= b.window)
        return { profile: 'full', fits: true, tokens: full }
    const lean = b.opening.lean + b.extra
    return { profile: 'lean', fits: lean <= b.window, tokens: lean }
}

/** The turn error for a window smaller than goose's lean opening request. */
export function gooseWindowMessage(o: {
    model: string
    window: number
    tokens: number
}): string {
    const w = o.window.toLocaleString('en-US')
    const t = (Math.ceil(o.tokens / 100) * 100).toLocaleString('en-US')
    return `${o.model} is loaded with a ${w}-token context window, and goose's opening prompt alone is about ${t} tokens, mostly the skills it lists. Load the model with a larger context length and try again.`
}
