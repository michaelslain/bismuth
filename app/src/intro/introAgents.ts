// app/src/intro/introAgents.ts
// The pick-an-agent slide's choices: every coding-agent CLI found on this machine, then the free
// agent. Pure (no framework, no Tauri) so a test can load it; detection itself is the Tauri
// `detect_agents` command, invoked by VaultIntro with the binaries from `binariesFor`.
import { AUTO_ORDER, BACKENDS } from '../../../core/src/agentBackends/catalog'

export type IntroAgentOption = {
    id: string
    icon: string
    name: string
    desc: string
}

export const FREE_AGENT_ID = 'free-agent'

const FREE_AGENT_OPTION: IntroAgentOption = {
    id: FREE_AGENT_ID,
    icon: 'Download',
    name: 'free agent',
    desc: 'Runs opencode on free models. No account, about 45 MB. Free models may keep your prompts.',
}

/** Backend ids -> the binary names to look for, de-duplicated, only picker-visible ids. */
export function binariesFor(ids: readonly string[]): string[] {
    const out: string[] = []
    for (const id of ids) {
        if (!AUTO_ORDER.includes(id as (typeof AUTO_ORDER)[number])) continue
        const bin = BACKENDS[id as (typeof AUTO_ORDER)[number]].binary
        if (!out.includes(bin)) out.push(bin)
    }
    return out
}

/** Binaries that were found -> the picker-visible backend ids that use them, in AUTO_ORDER. */
export function idsForBinaries(found: readonly string[]): string[] {
    return AUTO_ORDER.filter(id => found.includes(BACKENDS[id].binary))
}

/** The cards: installed agents in AUTO_ORDER, then the free agent. Unknown ids are dropped. */
export function introAgentOptions(
    installedIds: readonly string[],
): IntroAgentOption[] {
    const installed = AUTO_ORDER.filter(id => installedIds.includes(id)).map(
        id => ({
            id: id as string,
            icon: 'SquareTerminal',
            name: BACKENDS[id].label.toLowerCase(),
            desc: 'Installed on this machine.',
        }),
    )
    return [...installed, FREE_AGENT_OPTION]
}

/** The first installed agent when there is one, else the free agent. */
export function defaultIntroAgent(options: readonly IntroAgentOption[]): string {
    return options[0]?.id ?? FREE_AGENT_ID
}
