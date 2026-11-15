// core/src/chatProviders/acp/gooseBudget.ts
// Which goose profile a chat on a local model runs, from the model's loaded window.
//
// goose's opening request is its system prompt plus its tool schemas. With goose 1.59.1's default
// extensions it lists every agent in the user's `~/.claude/agents` (its summon extension) and every
// skill it finds, so it runs to tens of thousands of tokens on a well-stocked machine. The lean
// profile keeps only goose's developer extension (shell, file reading and editing), set through
// goose's `EXTENSIONS` environment variable, which it reads before its config file, so the user's
// goose config is never edited. goose's skills extension is not one of those extensions: it lists
// every skill under the home directory (`~/.claude/skills`, `~/.agents/skills`) plus the working
// directory's, whatever EXTENSIONS says, and nothing but the home directory moves them (goose 1.59.1
// has no skills switch, and XDG_* and GOOSE_PATH_ROOT leave them where they are). So the lean
// profile spawns goose with HOME set to a Bismuth-owned folder that links every home entry except
// `.claude` and `.agents`: the user's skills and agents vanish, the vault's own (found from the
// working directory) stay, and goose's config, sessions, git, ssh and the rest still resolve
// through the links to the real files. Nothing in the user's own folders is written or moved.
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readlinkSync,
    symlinkSync,
    unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bismuthHome } from '../../bismuthHome'
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

/** Home entries the lean home leaves out: where goose finds the user's skills and agents. */
const HIDDEN_FROM_LEAN_HOME = new Set(['.claude', '.agents'])

const isLink = (p: string) => {
    try {
        return lstatSync(p).isSymbolicLink()
    } catch {
        return false
    }
}

/**
 * Bismuth's own folder standing in for the home directory under the lean profile: one link per
 * entry of `realHome`, minus the skill and agent folders. Rebuilt in place (links only, so it is
 * cheap and a new home entry shows up next spawn). Only symlinks are ever replaced or removed: a
 * real file or folder in the farm is left alone. The top level is made read-only after the build,
 * so a file goose tries to create directly in `~` fails loudly instead of landing in the farm.
 * Returns its path.
 */
export function ensureGooseLeanHome(
    realHome = homedir(),
    dest = bismuthHome('goose-home'),
): string {
    mkdirSync(dest, { recursive: true })
    chmodSync(dest, 0o755)
    const want = new Set<string>()
    for (const name of readdirSync(realHome)) {
        if (HIDDEN_FROM_LEAN_HOME.has(name)) continue
        want.add(name)
        const link = join(dest, name)
        const target = join(realHome, name)
        try {
            const st = lstatSync(link)
            if (!st.isSymbolicLink()) continue // a real file goose wrote: keep it
            if (readlinkSync(link) === target) continue
            unlinkSync(link)
        } catch {}
        try {
            symlinkSync(target, link)
        } catch {}
    }
    for (const name of readdirSync(dest)) {
        const p = join(dest, name)
        if (!want.has(name) && isLink(p))
            try {
                unlinkSync(p)
            } catch {}
    }
    chmodSync(dest, 0o555)
    return dest
}

/**
 * The spawn env a profile adds: none for the full profile. The lean profile adds the developer-only
 * EXTENSIONS and the skill-free HOME, with `BISMUTH_HOME` pinned so the Bismuth tool, spawned by
 * goose under that HOME, still finds the real `~/.bismuth`.
 */
export function gooseProfileEnv(
    profile: GooseProfile,
    leanHome: () => string = ensureGooseLeanHome,
): Record<string, string> {
    if (profile !== 'lean') return {}
    const env: Record<string, string> = { EXTENSIONS: GOOSE_LEAN_EXTENSIONS }
    try {
        const home = leanHome()
        if (existsSync(home)) {
            env.HOME = home
            env.BISMUTH_HOME = bismuthHome()
        }
    } catch {}
    return env
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
    return `${o.model} is loaded with a ${w}-token context window, and goose's opening prompt alone is about ${t} tokens, mostly the skills and tools it lists. Load the model with a larger context length and try again.`
}
