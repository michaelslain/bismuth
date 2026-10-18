import { completeFreeAgentSetup, type FreeAgentApi } from '../chat/freeAgentClient'
import type { ConvertJob } from './introEnterVault'
import { providerLabel, sanitizeChatProvider } from '../chat/chatProvider'
import {
    FIRST_RUN_AGENT_KEY,
    FIRST_RUN_CONVERT_KEY,
    FIRST_RUN_DAEMON_NAME_KEY,
    FIRST_RUN_POWERUPS_KEY,
    FIRST_RUN_PRIVACY_KEY,
} from '../storageKeys'

type FreeAgentStatusCb = NonNullable<
    NonNullable<Parameters<typeof completeFreeAgentSetup>[4]>['onStatus']
>

export type FirstRunApi = FreeAgentApi & {
    setSetting: (path: string[], value: unknown) => Promise<unknown>
    daemonSetup: () => Promise<{ ok: boolean }>
    bismuthInstall: () => Promise<{ action?: string }>
    setDaemonName: (name: string) => Promise<{ name: string }>
}

export type FirstRunHandoffDeps = {
    api: FirstRunApi
    storage: Storage
    pushToast: (message: string) => unknown
    setAgentStatus: FreeAgentStatusCb
    /** Open a new chat tab with `text` in its composer, and send it once the chat is ready. */
    openChatAndSend: (text: string) => void
    delayMs?: number
}

/** The message the post-restart chat sends for the obsidian slide's conversion: the picked source,
 *  and the vault that just opened as the target, which Bismuth created for it. */
export function convertPrompt(job: ConvertJob): string {
    return [
        `Convert my Obsidian vault at "${job.source}" into this Bismuth vault, "${job.target}".`,
        'First read the guide guides/converting-obsidian-to-bismuth.md with bismuth_docs_read and follow it.',
        'Bismuth created this vault for the conversion: when it holds nothing besides .settings and .daemon, copy into it without asking; when it holds anything else, ask me first.',
    ].join(' ')
}

/**
 * The intro has no backend, so it leaves its choices in localStorage; the first app launch after
 * it reads and clears them here. An ABSENT key means a normal launch and does nothing.
 * Delayed so the sidecar is listening.
 */
/** Copy the intro's hand-off, which Rust wrote to disk before the relaunch (`take_first_run`
 *  returns it once, as a JSON object of localStorage keys), into `storage`. Malformed or absent:
 *  nothing changes. Run before runFirstRunHandoff. */
export function restoreFirstRunHandoff(
    text: string | null | undefined,
    storage: Pick<Storage, 'setItem'>,
): void {
    if (!text) return
    let entries: unknown
    try {
        entries = JSON.parse(text)
    } catch {
        return
    }
    if (!entries || typeof entries !== 'object') return
    for (const [k, v] of Object.entries(entries))
        if (typeof v === 'string') storage.setItem(k, v)
}

export function runFirstRunHandoff(deps: FirstRunHandoffDeps): void {
    const delayMs = deps.delayMs ?? 2500
    const agentReady = handoffAgent(deps, delayMs)
    const mcpReady = handoffPowerUps(deps, delayMs)
    handoffPrivacy(deps)
    handoffDaemonName(deps, delayMs)
    handoffConvert(deps, delayMs, Promise.all([agentReady, mcpReady]))
}

// The privacy slide's switches: `{path, value}[]` JSON, written to .settings one at a time after the
// daemon.enabled write above. Malformed JSON or a malformed entry writes nothing.
function handoffPrivacy(deps: FirstRunHandoffDeps): void {
    const { api, storage, pushToast } = deps
    const raw = storage.getItem(FIRST_RUN_PRIVACY_KEY)
    if (raw === null) return
    storage.removeItem(FIRST_RUN_PRIVACY_KEY)
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return
    }
    if (!Array.isArray(parsed)) return
    const writes = parsed.filter(
        (w): w is { path: string[]; value: boolean } =>
            Array.isArray(w?.path) &&
            w.path.length > 0 &&
            w.path.every((k: unknown) => typeof k === 'string') &&
            typeof w.value === 'boolean',
    )
    void writes
        .reduce(
            (chain, w) => chain.then(() => api.setSetting(w.path, w.value)),
            Promise.resolve<unknown>(undefined),
        )
        .catch(e =>
            pushToast(`couldn't save your privacy choices: ${(e as Error).message}`),
        )
}

// The name typed on the intro's "Name your daemon" slide. The route creates identity.md when the
// daemon (set up by the power-up above) has not seeded it yet, and only edits `name:` when it has,
// so this needs no ordering against daemon setup.
function handoffDaemonName(deps: FirstRunHandoffDeps, delayMs: number): void {
    const { api, storage, pushToast } = deps
    const name = storage.getItem(FIRST_RUN_DAEMON_NAME_KEY)
    if (name === null) return
    storage.removeItem(FIRST_RUN_DAEMON_NAME_KEY)
    setTimeout(() => {
        api.setDaemonName(name)
            .then(r => pushToast(`Your daemon is named ${r.name}`))
            .catch(e =>
                pushToast(
                    `couldn't name the daemon: ${(e as Error).message}`,
                ),
            )
    }, delayMs)
}

// The obsidian slide's conversion: the vault that opened is `<source>-bismuth`, and a chat converts
// the source into it. It starts once the agent hand-off and the cli + mcp install have both
// settled, so it runs on the agent the user picked with the Bismuth MCP registered, and sends
// itself when that chat is ready.
function handoffConvert(
    deps: FirstRunHandoffDeps,
    delayMs: number,
    ready: Promise<unknown>,
): void {
    const { storage, openChatAndSend } = deps
    const raw = storage.getItem(FIRST_RUN_CONVERT_KEY)
    if (raw === null) return
    storage.removeItem(FIRST_RUN_CONVERT_KEY)
    let job: ConvertJob
    try {
        job = JSON.parse(raw)
    } catch {
        return
    }
    if (typeof job?.source !== 'string' || typeof job?.target !== 'string')
        return
    void ready.then(() =>
        setTimeout(() => openChatAndSend(convertPrompt(job)), delayMs),
    )
}

// The agent chosen on the intro's "Pick an agent." slide. 'free-agent' runs the free-agent setup
// (the same helper the palette modal uses); a backend id is the user's explicit choice, so it is
// written to chat.provider.
function handoffAgent(
    deps: FirstRunHandoffDeps,
    delayMs: number,
): Promise<void> {
    const { api, storage, pushToast, setAgentStatus } = deps
    const agent = storage.getItem(FIRST_RUN_AGENT_KEY)
    if (agent === null) return Promise.resolve()
    storage.removeItem(FIRST_RUN_AGENT_KEY)
    // Settles (never rejects) once the chosen agent is set up or has failed, so the conversion
    // chat starts on the agent the user picked.
    return new Promise<void>(resolve => {
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
                    .finally(resolve)
                return
            }
            const provider = sanitizeChatProvider(agent)
            api.setSetting(['chat', 'provider'], provider)
                .then(() =>
                    pushToast(`Chat set to ${providerLabel(provider)}`),
                )
                .catch(e =>
                    pushToast(
                        `couldn't set the chat agent: ${(e as Error).message}`,
                    ),
                )
                .finally(resolve)
        }, delayMs)
    })
}

// Run the power-ups the user chose on the first-run intro. Fires once, then clears the flag.
// Settles (never rejects) once the cli + mcp install has finished or failed, or at once when it was
// not chosen: the in-app chat reads its MCP servers from user scope, which that install writes, so
// the conversion chat must not start before it.
function handoffPowerUps(
    deps: FirstRunHandoffDeps,
    delayMs: number,
): Promise<void> {
    const { api, storage, pushToast } = deps
    // Only a post-intro launch carries this key. A normal launch has none — and an ABSENT
    // key must not be read as "deselected everything", or we'd PATCH settings on every boot.
    const raw = storage.getItem(FIRST_RUN_POWERUPS_KEY)
    if (raw === null) return Promise.resolve()
    storage.removeItem(FIRST_RUN_POWERUPS_KEY)
    let chosen: string[]
    try {
        chosen = JSON.parse(raw)
    } catch {
        return Promise.resolve()
    }
    if (!Array.isArray(chosen)) return Promise.resolve()
    // The daemon power-up doubles as the master-switch opt-in: enable the daemon
    // integration iff the user picked the daemon on the intro, disable it otherwise. Only
    // fires on the post-intro launch (key present), so it never overrides a later toggle.
    void api.setSetting(['daemon', 'enabled'], chosen.includes('daemon-setup'))
    if (chosen.length === 0) return Promise.resolve()
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
    return new Promise<void>(resolve => {
        setTimeout(() => {
            let mcpRun: Promise<unknown> = Promise.resolve()
            for (const id of chosen) {
                const r = runners[id]
                if (!r) continue
                const run = r
                    .run()
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
                if (id === 'bismuth-install') mcpRun = run
            }
            void mcpRun.finally(resolve)
        }, delayMs)
    })
}
