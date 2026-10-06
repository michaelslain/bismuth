// app/src/chat/freeAgentClient.ts — pure client logic for the one-click free agent (no framework
// imports, so it is unit-testable). The routes live in core/src/freeAgent.ts; TYPES only come
// from there, never its runtime.
import type {
    FreeAgentProgress,
    FreeAgentStatus,
} from '../../../core/src/freeAgent'
import { modelStorageKeys } from '../chatProvider'

/** Mirror of core's ZEN_FREE_ROTATE_ID (opencodeTranslate.ts); a test pins equality. */
export const ZEN_FREE_ROTATE_ID = 'bismuth/zen-free-rotate'

export type FreeAgentApi = {
    freeAgentStatus: () => Promise<FreeAgentStatus>
    freeAgentInstall: () => Promise<FreeAgentProgress>
}

const BUSY = new Set(['idle', 'downloading', 'verifying', 'installing'])
const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Start (idempotent server-side) and poll every `intervalMs` until ready|error, reporting each progress. */
export async function runFreeAgentSetup(
    api: FreeAgentApi,
    onProgress: (p: FreeAgentProgress) => void,
    opts: { intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<FreeAgentProgress> {
    const sleep = opts.sleep ?? realSleep
    const interval = opts.intervalMs ?? 500
    let p: FreeAgentProgress
    try {
        p = await api.freeAgentInstall()
    } catch (e) {
        p = { phase: 'error', message: e instanceof Error ? e.message : String(e) }
    }
    onProgress(p)
    while (BUSY.has(p.phase)) {
        await sleep(interval)
        try {
            p = (await api.freeAgentStatus()).progress
            // core restarted mid-install: status reads idle forever, so rearm the install
            if (p.phase === 'idle') p = await api.freeAgentInstall()
        } catch (e) {
            p = { phase: 'error', message: e instanceof Error ? e.message : String(e) }
        }
        onProgress(p)
    }
    return p
}

/** After ready: seed opencode's global last-model key with Zen Free when it is empty. It no longer
 *  writes `chat.provider`: the setting defaults to `auto`, which picks an installed opencode by
 *  itself, and writing `opencode` would override a user's own Codex (or any other agent). */
export function freeAgentDefaults(
    storage: Pick<Storage, 'getItem' | 'setItem'>,
): void {
    const key = modelStorageKeys('opencode', '').global
    try {
        if (!storage.getItem(key)) storage.setItem(key, ZEN_FREE_ROTATE_ID)
    } catch {
        // storage unavailable: the provider's own default applies
    }
}

export type FreeAgentSession = {
    provider: () => string
    /** Still showing the setup screen? An `auto` chat with nothing installed starts on opencode by
     *  itself the moment `onStatus` lands the fresh status, so it has no error left to retry. */
    setupError: () => unknown
    retrySetup: () => void
    switchProvider: (p: string) => void
}

let inflight: Promise<FreeAgentProgress> | null = null
const listeners = new Set<(p: FreeAgentProgress) => void>()
const statusListeners = new Set<(s: FreeAgentStatus) => void>()

/** The whole ready flow in one place: run the setup, then (on ready) re-read status, apply the
 *  Zen Free defaults, hand the fresh status to `opts.onStatus` (the agent-availability store), and
 *  reopen the session on opencode. Single-flight: a concurrent caller awaits the same run (and gets
 *  its progress and its `onStatus`; the same callback from several callers runs once). */
export function completeFreeAgentSetup(
    api: FreeAgentApi,
    storage: Pick<Storage, 'getItem' | 'setItem'>,
    onProgress: (p: FreeAgentProgress) => void,
    session?: FreeAgentSession,
    opts: {
        intervalMs?: number
        sleep?: (ms: number) => Promise<void>
        onStatus?: (s: FreeAgentStatus) => void
    } = {},
): Promise<FreeAgentProgress> {
    listeners.add(onProgress)
    if (opts.onStatus) statusListeners.add(opts.onStatus)
    if (!inflight) {
        const run = (async () => {
            const done = await runFreeAgentSetup(
                api,
                p => listeners.forEach(l => l(p)),
                opts,
            )
            if (done.phase !== 'ready') return done
            const fresh = await api.freeAgentStatus()
            freeAgentDefaults(storage)
            statusListeners.forEach(l => l(fresh))
            return done
        })()
        inflight = run
        const clear = () => {
            inflight = null
            listeners.clear()
            statusListeners.clear()
        }
        run.then(clear, clear)
    }
    // the session step is per caller: a joiner's chat must reopen too. An auto chat already moved
    // onto opencode when onStatus landed (chatSession's start effect), so it is left alone — exactly
    // one reconnect either way.
    return inflight.then(done => {
        if (done.phase === 'ready' && session) {
            if (session.provider() !== 'opencode')
                session.switchProvider('opencode')
            else if (session.setupError()) session.retrySetup()
        }
        return done
    })
}

const mb = (bytes: number) => Math.round(bytes / 1e6)

/** The progress line text for a phase (acceptance copy). Empty for idle/ready. */
export function freeAgentLine(p: FreeAgentProgress): string {
    switch (p.phase) {
        case 'downloading':
            return p.total
                ? `downloading opencode  ${mb(p.received ?? 0)} / ${mb(p.total)} MB`
                : `downloading opencode  ${mb(p.received ?? 0)} MB`
        case 'verifying':
            return 'checking the download…'
        case 'installing':
            return 'installing…'
        case 'error':
            return `couldn't set up the free agent: ${p.message ?? 'unknown error'}`
        default:
            return ''
    }
}
