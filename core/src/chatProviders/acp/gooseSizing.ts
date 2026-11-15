// core/src/chatProviders/acp/gooseSizing.ts
// Fit a goose chat on a local model to the model's loaded window before goose spawns: measure
// goose's opening request (gooseMeasure.ts), pick the profile (gooseBudget.ts), and return the
// local-model spawn with that profile's env, or the error to show when even the lean profile
// cannot fit.
import { tmpdir } from 'node:os'
import { bismuthHome } from '../../bismuthHome'
import type { ResolvedLocal } from '../../agentBackends/localModelProbe'
import {
    charsToTokens,
    gooseProfileEnv,
    gooseWindowMessage,
    pickGooseProfile,
    type GooseProfile,
} from './gooseBudget'
import { measureGooseOpening } from './gooseMeasure'

export type GooseSizing =
    | { kind: 'ready'; local: ResolvedLocal; profile: GooseProfile | null }
    | { kind: 'too-small'; message: string }

/**
 * `local` is the resolved local-model spawn; `baseEnv` the env goose spawns with before it;
 * `instructions` the chat instructions the first prompt carries; `mcpBin` the Bismuth MCP server a
 * session adds (null when not installed). A model with no reported window, or a measurement that
 * fails, keeps goose's own defaults.
 */
export async function sizeGooseChat(o: {
    bin: string
    local: ResolvedLocal
    baseEnv: Record<string, string>
    instructions: string
    mcpBin: string | null
}): Promise<GooseSizing> {
    const window = o.local.windows[o.local.model]
    if (!window) return { kind: 'ready', local: o.local, profile: null }
    const env = { ...o.baseEnv, ...o.local.env }
    // The tool schema does not depend on the vault, so one placeholder vault keeps one cache entry.
    const extension = o.mcpBin
        ? `bismuth:BISMUTH_VAULT=${tmpdir()} BISMUTH_CLI=${bismuthHome('bin', 'bismuth')} ${o.mcpBin}`
        : undefined
    const full = await measureGooseOpening(o.bin, env, 'full', extension)
    if (full === null) return { kind: 'ready', local: o.local, profile: null }
    const extra = charsToTokens(o.instructions.length)
    const fullPick = pickGooseProfile({
        window,
        opening: { full, lean: full },
        extra,
    })
    let pick = fullPick
    if (fullPick.profile === 'lean') {
        const lean = await measureGooseOpening(o.bin, env, 'lean', extension)
        if (lean === null) return { kind: 'ready', local: o.local, profile: null }
        pick = pickGooseProfile({ window, opening: { full, lean }, extra })
    }
    if (!pick.fits)
        return {
            kind: 'too-small',
            message: gooseWindowMessage({ model: o.local.model, window, tokens: pick.tokens }),
        }
    return {
        kind: 'ready',
        local: { ...o.local, env: { ...o.local.env, ...gooseProfileEnv(pick.profile) } },
        profile: pick.profile,
    }
}
