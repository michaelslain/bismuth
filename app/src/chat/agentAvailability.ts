// app/src/chat/agentAvailability.ts — which coding agents this machine has, shared by every chat.
// One module-level store fed by `GET /agents/free`'s `backends` (owner-only), read by:
//   - chatSession.ts, whose `auto` provider resolves to the first INSTALLED backend and must not
//     spawn until this is known (chatProvider.ts's resolveChatProvider);
//   - ChatSetupGate.tsx's row of other installed agents;
//   - ChatControls.tsx's pre-session row, so an auto chat never shows a placeholder backend.
// A failed read (mobile's in-process backend has no such route, or a transient network error)
// records 'failed', which resolution treats as the old claude fallback rather than waiting forever.
import { createSignal } from 'solid-js'
import type { FreeAgentStatus } from '../../../core/src/freeAgent'
import type { InstalledBackends } from './chatProvider'
import { api } from '../api'

export type AgentBackend = FreeAgentStatus['backends'][number]

const [state, setState] = createSignal<AgentBackend[] | null | 'failed'>(null)
let inflight: Promise<void> | null = null
let loaded = false

const fetchStatus = (): Promise<void> => {
    const run = api.freeAgentStatus().then(
        s => {
            if (inflight === run) setAgentStatus(s)
        },
        () => {
            // keep a known list over a transient failure; only an unknown state becomes 'failed'
            if (inflight === run && state() === null) setState('failed')
        },
    )
    inflight = run
    run.finally(() => {
        if (inflight === run) inflight = null
    })
    return run
}

/** Fetch once (idempotent): later calls return the in-flight read, or resolve at once. */
export function loadAgentAvailability(): Promise<void> {
    if (loaded) return inflight ?? Promise.resolve()
    loaded = true
    return fetchStatus()
}

/** Refetch, e.g. after something was installed outside the app. */
export function refreshAgentAvailability(): Promise<void> {
    loaded = true
    return fetchStatus()
}

/** Set from a status already in hand (the free-agent setup's fresh read after ready). */
export function setAgentStatus(status: FreeAgentStatus): void {
    loaded = true
    inflight = null
    setState(status.backends ?? [])
}

/** Every picker-visible backend with whether it is installed, or null while unknown/failed. */
export function agentBackends(): AgentBackend[] | null {
    const s = state()
    return Array.isArray(s) ? s : null
}

/** The installed backend ids, null while the read is in flight, 'failed' when it can't answer. */
export function installedBackendIds(): InstalledBackends {
    const s = state()
    return Array.isArray(s) ? s.filter(b => b.installed).map(b => b.id) : s
}
