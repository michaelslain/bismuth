import { completeFreeAgentSetup, type FreeAgentApi } from '../chat/freeAgentClient'
import { providerLabel, sanitizeChatProvider } from '../chat/chatProvider'
import { FIRST_RUN_AGENT_KEY, FIRST_RUN_POWERUPS_KEY } from '../storageKeys'

type FreeAgentStatusCb = NonNullable<
    NonNullable<Parameters<typeof completeFreeAgentSetup>[4]>['onStatus']
>

export type FirstRunApi = FreeAgentApi & {
    setSetting: (path: string[], value: unknown) => Promise<unknown>
    daemonSetup: () => Promise<{ ok: boolean }>
    bismuthInstall: () => Promise<{ action?: string }>
}

export type FirstRunHandoffDeps = {
    api: FirstRunApi
    storage: Storage
    pushToast: (message: string) => unknown
    setAgentStatus: FreeAgentStatusCb
    delayMs?: number
}

/**
 * The intro has no backend, so it leaves its choices in localStorage; the first app launch after
 * it reads and clears them here. An ABSENT key means a normal launch and does nothing.
 * Delayed so the sidecar is listening.
 */
export function runFirstRunHandoff(deps: FirstRunHandoffDeps): void {
    const delayMs = deps.delayMs ?? 2500
    handoffAgent(deps, delayMs)
    handoffPowerUps(deps, delayMs)
}

// The agent chosen on the intro's "Pick an agent." slide. 'free-agent' runs the free-agent setup
// (the same helper the palette modal uses); a backend id is the user's explicit choice, so it is
// written to chat.provider.
function handoffAgent(deps: FirstRunHandoffDeps, delayMs: number): void {
    const { api, storage, pushToast, setAgentStatus } = deps
    const agent = storage.getItem(FIRST_RUN_AGENT_KEY)
    if (agent === null) return
    storage.removeItem(FIRST_RUN_AGENT_KEY)
    setTimeout(() => {
        if (agent === 'free-agent') {
            completeFreeAgentSetup(api, storage, () => {}, undefined, {
                onStatus: setAgentStatus,
            })
                .then(r => {
                    if (r.phase === 'error')
                        throw new Error(r.message ?? 'setup failed')
                    pushToast(
                        r.action === 'already-installed'
                            ? 'The free agent is already installed'
                            : 'Set up the free agent',
                    )
                })
                .catch(e =>
                    pushToast(
                        `Free agent setup failed: ${(e as Error).message}`,
                    ),
                )
            return
        }
        const provider = sanitizeChatProvider(agent)
        api.setSetting(['chat', 'provider'], provider)
            .then(() => pushToast(`Chat set to ${providerLabel(provider)}`))
            .catch(e =>
                pushToast(
                    `couldn't set the chat agent: ${(e as Error).message}`,
                ),
            )
    }, delayMs)
}

// Run the power-ups the user chose on the first-run intro. Fires once, then clears the flag.
function handoffPowerUps(deps: FirstRunHandoffDeps, delayMs: number): void {
    const { api, storage, pushToast } = deps
    // Only a post-intro launch carries this key. A normal launch has none — and an ABSENT
    // key must not be read as "deselected everything", or we'd PATCH settings on every boot.
    const raw = storage.getItem(FIRST_RUN_POWERUPS_KEY)
    if (raw === null) return
    storage.removeItem(FIRST_RUN_POWERUPS_KEY)
    let chosen: string[]
    try {
        chosen = JSON.parse(raw)
    } catch {
        return
    }
    if (!Array.isArray(chosen)) return
    // The daemon power-up doubles as the master-switch opt-in: enable the daemon
    // integration iff the user picked the daemon on the intro, disable it otherwise. Only
    // fires on the post-intro launch (key present), so it never overrides a later toggle.
    void api.setSetting(['daemon', 'enabled'], chosen.includes('daemon-setup'))
    if (chosen.length === 0) return
    // Each runner returns its installer result; `action` tells us whether it was a fresh
    // install or a no-op because it's already there ("adopted"/"up-to-date") — so we can
    // say "already installed" instead of falsely claiming a setup or showing an error.
    const ALREADY = new Set(['adopted', 'up-to-date', 'skipped-no-src'])
    const runners: Record<
        string,
        { label: string; run: () => Promise<{ action?: string }> }
    > = {
        // The bundled daemon installs the service rather than git-cloning, so map its {ok}
        // result onto the {action} shape this generic installer-runner expects.
        'daemon-setup': {
            label: 'the daemon',
            run: async () => {
                const r = await api.daemonSetup()
                return { action: r.ok ? 'installed' : 'failed' }
            },
        },
        'bismuth-install': {
            label: 'Bismuth CLI + MCP',
            run: () => api.bismuthInstall(),
        },
    }
    setTimeout(() => {
        for (const id of chosen) {
            const r = runners[id]
            if (!r) continue
            r.run()
                .then(res =>
                    pushToast(
                        ALREADY.has(res?.action ?? '')
                            ? `${r.label} already installed`
                            : `Set up ${r.label}`,
                    ),
                )
                .catch(e =>
                    pushToast(
                        `${r.label} setup failed: ${(e as Error).message}`,
                    ),
                )
        }
    }, delayMs)
}
