// core/src/agentBackends/localModelProbe.ts
// The I/O half of the local-model setting: read it from a vault's `.settings`, ask the server which
// models it has, and resolve one backend's spawn. The pure mapping is ./localModel.ts.
import { readSettings } from '../settings'
import { can, type BackendId } from './catalog'
import {
    localSpawnFor,
    parseLocalModel,
    type LocalModel,
    type LocalSpawn,
} from './localModel'

/** The vault's enabled local-model setting, or null (off, absent, malformed, unreadable). */
export async function readLocalModel(
    vault: string,
): Promise<LocalModel | null> {
    try {
        const res = await readSettings(vault)
        return parseLocalModel(res?.data.localModel)
    } catch {
        return null
    }
}

/**
 * The model ids the server lists at `GET <url>/v1/models` (the OpenAI shape `{data:[{id}]}`, which
 * LM Studio and Ollama both serve). `[]` on any failure — a down server, a timeout, a body in some
 * other shape — so callers can treat "nothing listed" and "unreachable" alike.
 */
export async function listLocalModels(
    lm: LocalModel,
    timeoutMs = 1500,
): Promise<string[]> {
    try {
        const res = await fetch(`${lm.url}/v1/models`, {
            headers: lm.apiKey ? { Authorization: `Bearer ${lm.apiKey}` } : {},
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) return []
        const body = (await res.json()) as { data?: unknown }
        if (!Array.isArray(body.data)) return []
        return body.data
            .map(m =>
                m && typeof (m as { id?: unknown }).id === 'string'
                    ? (m as { id: string }).id
                    : '',
            )
            .filter(Boolean)
    } catch {
        return []
    }
}

export type ResolvedLocal = LocalSpawn & { lm: LocalModel; models: string[] }

export type LocalResolution =
    | { kind: 'off' }
    | { kind: 'ready'; local: ResolvedLocal }
    | { kind: 'unreachable'; url: string }

/**
 * Resolve one backend's local-model spawn for a vault. `off` when the setting is disabled or the
 * backend has no local mechanism; `unreachable` when it is on but the server lists no models (down,
 * or nothing loaded) — a driver must surface that, never silently fall back to the CLI's cloud
 * account. The model is the user's header pick (when the server lists it), else the
 * setting's, else the first listed id.
 */
export async function resolveLocalSpawn(
    id: BackendId,
    vault: string,
    requestedModel?: string,
): Promise<LocalResolution> {
    if (!can(id, 'localModel')) return { kind: 'off' }
    const lm = await readLocalModel(vault)
    if (!lm) return { kind: 'off' }
    const models = await listLocalModels(lm)
    // Every server this targets (LM Studio, Ollama, llama.cpp, vLLM) serves /v1/models, so an empty
    // list means down or nothing loaded — surface it before spawning rather than letting the CLI
    // fail mid-turn with a connection error that never names the setting.
    if (models.length === 0) return { kind: 'unreachable', url: lm.url }
    // opencode's picker values are `local/<id>`; a header pick arrives in that form. A pick the
    // server does not list (a cloud model remembered from before the setting was on, e.g. a resumed
    // Claude chat's "opus") is ignored rather than sent to a server that has never heard of it. The
    // setting's own `model` is trusted as written: LM Studio can JIT-load an id it does not list.
    const requested = requestedModel?.replace(/^local\//, '') || ''
    const model =
        (models.includes(requested) && requested) || lm.model || models[0]
    const spawn = localSpawnFor(id, lm, model, models)
    if (!spawn) return { kind: 'off' }
    return { kind: 'ready', local: { ...spawn, lm, models } }
}

/** The error a driver shows when the setting is on but the server is down or lists no models. */
export function localUnreachableMessage(url: string): string {
    return (
        `No local model server answered at ${url} (or it lists no models). ` +
        'Start LM Studio or Ollama, or turn off localModel in .settings.'
    )
}
