// core/src/agentBackends/localModel.ts
// The vault's `localModel` setting → per-backend spawn-time env/argv. Pure: no I/O, only a type
// import from the import-free catalog, so it stays bundle-safe and trivially unit-testable. Reading
// `.settings` and asking the server which models it has live in ./localModelProbe.ts.
//
// The whole point is that Bismuth NEVER edits a CLI's own config to do this. Each mapping below is a
// mechanism the CLI itself documents for "use this other endpoint", applied only to the processes
// Bismuth spawns — so the user's terminal Claude/Codex keep their real accounts. The same mappings
// (minus the model plumbing) are what core/test/support/backendEnv.ts verified live against the mock
// LLM server: ANTHROPIC_BASE_URL for claude, a custom `wire_api="responses"` provider for codex
// (codex rejects `wire_api="chat"` and refuses to override its built-in "openai" provider), an inline
// `OPENCODE_CONFIG_CONTENT` provider for opencode, and GOOSE_PROVIDER + host env for goose.
import type { BackendId } from './catalog'

/** A resolved, enabled local-model setting. `url` carries no trailing `/` and no trailing `/v1`. */
export type LocalModel = { url: string; model: string; apiKey: string }

/** What a driver merges into its spawn: extra env, extra argv, and the model id it resolved to. */
export type LocalSpawn = {
    env: Record<string, string>
    args: string[]
    model: string
}

/** opencode's provider id for the local server — its models show up as `local/<id>`. */
export const LOCAL_PROVIDER_ID = 'local'

/** Codex's custom provider id. Not "openai": codex refuses to override a built-in provider. */
const CODEX_PROVIDER_ID = 'bismuth_local'
/** The env var codex's custom provider reads its key from (codex insists on SOME key). */
const CODEX_KEY_ENV = 'BISMUTH_LOCAL_MODEL_KEY'

/** Placeholder credential for servers that ignore auth but whose clients insist on one. */
const PLACEHOLDER_KEY = 'local'

/** Strip trailing slashes and a trailing `/v1` — every mapping appends its own path. */
function normalizeUrl(raw: string): string {
    let url = raw.trim()
    while (url.endsWith('/')) url = url.slice(0, -1)
    if (url.endsWith('/v1')) url = url.slice(0, -3)
    while (url.endsWith('/')) url = url.slice(0, -1)
    return url
}

/**
 * Parse the `localModel` section of a vault's `.settings`. Null unless it is an object with
 * `enabled: true` and a non-empty `url` — anything malformed degrades to "off", never throws.
 */
export function parseLocalModel(section: unknown): LocalModel | null {
    if (!section || typeof section !== 'object') return null
    const s = section as Record<string, unknown>
    if (s.enabled !== true) return null
    const url = typeof s.url === 'string' ? normalizeUrl(s.url) : ''
    if (!url) return null
    return {
        url,
        model: typeof s.model === 'string' ? s.model.trim() : '',
        apiKey: typeof s.apiKey === 'string' ? s.apiKey.trim() : '',
    }
}

/** The opencode inline config declaring the local server as an OpenAI-compatible provider. */
function opencodeConfig(
    lm: LocalModel,
    model: string,
    models: string[],
): string {
    const ids = models.includes(model) ? models : [model, ...models]
    const modelEntries: Record<string, { name: string }> = {}
    for (const id of ids) modelEntries[id] = { name: id }
    return JSON.stringify({
        provider: {
            [LOCAL_PROVIDER_ID]: {
                npm: '@ai-sdk/openai-compatible',
                name: 'Local model',
                options: {
                    baseURL: `${lm.url}/v1`,
                    ...(lm.apiKey ? { apiKey: lm.apiKey } : {}),
                },
                models: modelEntries,
            },
        },
        model: `${LOCAL_PROVIDER_ID}/${model}`,
    })
}

/**
 * The spawn-time env/argv that points one backend at the local server, or null when that backend
 * has no such mechanism (the catalog's `localModel: false`). `model` is the already-resolved id;
 * `models` (opencode only) is every id to declare in its provider block so the header picker can
 * switch between them — defaults to just `model`.
 */
export function localSpawnFor(
    id: BackendId,
    lm: LocalModel,
    model: string,
    models: string[] = [model],
): LocalSpawn | null {
    const key = lm.apiKey || PLACEHOLDER_KEY
    switch (id) {
        case 'claude':
            // Every model-role var, or background/subagent calls still name a Claude model the local
            // server has never heard of. AUTH_TOKEN (Bearer), not API_KEY: it is what satisfies Claude
            // Code's own auth check without an approval prompt. Attribution header + nonessential
            // traffic off: neither means anything to a local server.
            return {
                env: {
                    ANTHROPIC_BASE_URL: lm.url,
                    ANTHROPIC_AUTH_TOKEN: key,
                    ANTHROPIC_MODEL: model,
                    ANTHROPIC_DEFAULT_MODEL: model,
                    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
                    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
                    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
                    ANTHROPIC_DEFAULT_FABLE_MODEL: model,
                    CLAUDE_CODE_SUBAGENT_MODEL: model,
                    CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
                    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
                },
                args: [],
                model,
            }
        case 'codex':
            // The model itself rides the driver's own `--model` flag.
            return {
                env: { [CODEX_KEY_ENV]: key },
                args: [
                    '--config',
                    `model_provider="${CODEX_PROVIDER_ID}"`,
                    '--config',
                    `model_providers.${CODEX_PROVIDER_ID}.name="Local model"`,
                    '--config',
                    `model_providers.${CODEX_PROVIDER_ID}.base_url="${lm.url}/v1"`,
                    '--config',
                    `model_providers.${CODEX_PROVIDER_ID}.wire_api="responses"`,
                    '--config',
                    `model_providers.${CODEX_PROVIDER_ID}.env_key="${CODEX_KEY_ENV}"`,
                ],
                model,
            }
        case 'opencode':
            return {
                env: {
                    OPENCODE_CONFIG_CONTENT: opencodeConfig(lm, model, models),
                },
                args: [],
                model,
            }
        case 'goose':
            // goose's `openai` provider appends OPENAI_BASE_PATH to OPENAI_HOST, so the host carries
            // no `/v1`. Env outranks ~/.config/goose/config.yaml for the spawned process.
            return {
                env: {
                    GOOSE_PROVIDER: 'openai',
                    GOOSE_MODEL: model,
                    OPENAI_HOST: lm.url,
                    OPENAI_BASE_PATH: 'v1/chat/completions',
                    OPENAI_API_KEY: key,
                },
                args: [],
                model,
            }
        default:
            return null
    }
}
