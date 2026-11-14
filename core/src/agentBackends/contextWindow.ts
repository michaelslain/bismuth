// core/src/agentBackends/contextWindow.ts
// Pure parsers for what a local model server says about its models and the context window each is
// LOADED with. The window matters because opencode only compacts before an over-window request when
// its `limit.context` equals the real loaded window (see opencodeConfig.ts `windowLimit`); a model
// card's maximum is what the model supports, never what the server allocated. No imports: bundle-safe.

/** Which server answered, identified by the route that did (contextWindowProbe.ts). */
export type LocalServerKind = 'lmstudio' | 'ollama' | 'llamacpp' | 'vllm' | 'openai'

/** One model a server lists. `window` is the loaded context window, null when not known. */
export type LocalServerModel = {
    id: string
    window: number | null
    embedding: boolean
}

/** The id fallback for "is this an embedding model" when a server reports no type. */
export function isEmbeddingModelId(id: string): boolean {
    return /embed/i.test(id)
}

const positive = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null

const rows = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
        ? v.filter(
              (m): m is Record<string, unknown> =>
                  !!m && typeof m === 'object' && !Array.isArray(m),
          )
        : []

/**
 * LM Studio `GET /api/v0/models`. `window` is `loaded_context_length` for a loaded model and null
 * otherwise: `max_context_length` is what the model supports, not what the load allocated.
 */
export function parseLmStudioModels(body: unknown): LocalServerModel[] {
    const data = (body as { data?: unknown } | null)?.data
    const out: LocalServerModel[] = []
    for (const m of rows(data)) {
        if (typeof m.id !== 'string' || !m.id) continue
        out.push({
            id: m.id,
            window: m.state === 'loaded' ? positive(m.loaded_context_length) : null,
            embedding: m.type === 'embeddings',
        })
    }
    return out
}

/** Ollama `GET /api/ps`: the loaded models with the context length each was allocated. */
export function parseOllamaPs(body: unknown): { id: string; window: number }[] {
    const models = (body as { models?: unknown } | null)?.models
    const out: { id: string; window: number }[] = []
    for (const m of rows(models)) {
        const id =
            typeof m.name === 'string' && m.name
                ? m.name
                : typeof m.model === 'string'
                  ? m.model
                  : ''
        const window = positive(m.context_length)
        if (id && window) out.push({ id, window })
    }
    return out
}

/** llama.cpp `GET /props`: the per-slot window (`n_ctx`), which is what one chat can use. */
export function parseLlamaCppProps(body: unknown): number | null {
    const s = (body as { default_generation_settings?: { n_ctx?: unknown } } | null)
        ?.default_generation_settings
    return positive(s?.n_ctx)
}

function idsOf(body: unknown): Record<string, unknown>[] {
    return rows((body as { data?: unknown } | null)?.data).filter(
        m => typeof m.id === 'string' && m.id,
    )
}

/** vLLM `GET /v1/models`: `max_model_len` is the serving limit. */
export function parseVllmModels(body: unknown): LocalServerModel[] {
    return idsOf(body).map(m => ({
        id: m.id as string,
        window: positive(m.max_model_len),
        embedding: isEmbeddingModelId(m.id as string),
    }))
}

/** A plain OpenAI-shaped `GET /v1/models`: ids only, no windows. */
export function parseOpenAiModels(body: unknown): LocalServerModel[] {
    return idsOf(body).map(m => ({
        id: m.id as string,
        window: null,
        embedding: isEmbeddingModelId(m.id as string),
    }))
}

/** The product name of a server kind, for UI and error text. */
export function serverKindName(kind: LocalServerKind): string {
    switch (kind) {
        case 'lmstudio':
            return 'LM Studio'
        case 'ollama':
            return 'Ollama'
        case 'llamacpp':
            return 'llama.cpp'
        case 'vllm':
            return 'vLLM'
        default:
            return 'OpenAI-compatible server'
    }
}
