// core/src/agentBackends/contextWindowProbe.ts
// The I/O half of window detection: ask a local server which routes it answers, identify its kind,
// and list its models with the loaded window of each. Parsers are ./contextWindow.ts.
import {
    parseLlamaCppProps,
    parseLmStudioModels,
    parseOllamaPs,
    parseOpenAiModels,
    parseVllmModels,
    type LocalServerKind,
    type LocalServerModel,
} from './contextWindow'
import { normalizeUrl } from './localModel'

export type LocalServerProbe = {
    kind: LocalServerKind
    /** Normalized like `parseLocalModel`: no trailing `/`, no `/v1`. */
    url: string
    models: LocalServerModel[]
}

async function getJson(
    url: string,
    path: string,
    apiKey: string | undefined,
    timeoutMs: number,
): Promise<unknown | undefined> {
    try {
        const res = await fetch(`${url}${path}`, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) return undefined
        return await res.json()
    } catch {
        return undefined
    }
}

/**
 * Identify the server at `url` by which route answers (LM Studio `/api/v0/models`; Ollama `/api/ps`
 * with its list from `/v1/models`; llama.cpp `/props`; vLLM `/v1/models` carrying `max_model_len`;
 * else plain `/v1/models`) and list its models. Embedding models stay in the list, flagged. Null when
 * nothing answers.
 */
export async function probeLocalServer(
    url: string,
    apiKey?: string,
    timeoutMs = 1500,
): Promise<LocalServerProbe | null> {
    const base = normalizeUrl(url)
    if (!base) return null
    const [lm, ps, props, v1] = await Promise.all([
        getJson(base, '/api/v0/models', apiKey, timeoutMs),
        getJson(base, '/api/ps', apiKey, timeoutMs),
        getJson(base, '/props', apiKey, timeoutMs),
        getJson(base, '/v1/models', apiKey, timeoutMs),
    ])
    const lmModels = lm === undefined ? [] : parseLmStudioModels(lm)
    if (lmModels.length > 0) return { kind: 'lmstudio', url: base, models: lmModels }
    const listed = v1 === undefined ? null : parseOpenAiModels(v1)
    if (ps !== undefined && Array.isArray((ps as { models?: unknown }).models)) {
        const loaded = new Map(parseOllamaPs(ps).map(m => [m.id, m.window]))
        return {
            kind: 'ollama',
            url: base,
            models: (listed ?? []).map(m => ({
                ...m,
                window: loaded.get(m.id) ?? null,
            })),
        }
    }
    const n = props === undefined ? null : parseLlamaCppProps(props)
    if (n !== null)
        return {
            kind: 'llamacpp',
            url: base,
            models: (listed ?? []).map(m => ({ ...m, window: n })),
        }
    if (v1 === undefined) return null
    const vllm = parseVllmModels(v1)
    if (vllm.some(m => m.window !== null)) return { kind: 'vllm', url: base, models: vllm }
    return { kind: 'openai', url: base, models: listed ?? [] }
}

/** The loaded context window of `modelId` on the server at `url`, null when unknown or unreachable. */
export async function detectWindow(
    url: string,
    modelId: string,
    apiKey?: string,
): Promise<number | null> {
    const probe = await probeLocalServer(url, apiKey)
    return probe?.models.find(m => m.id === modelId)?.window ?? null
}
