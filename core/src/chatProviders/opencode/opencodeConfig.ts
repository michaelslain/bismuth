// core/src/chatProviders/opencode/opencodeConfig.ts
// Pure: the `OPENCODE_CONFIG_CONTENT` Bismuth injects into the opencode processes it spawns. It never
// edits opencode's own config files. Five things ride it: the vault's `localModel` provider, saved
// local servers as providers of their own, context limits for providers Bismuth did not declare, the
// Bismuth MCP server, and the compact profile (a small prompt for small windows).
import {
    LOCAL_PROVIDER_ID,
    THINKING_VARIANTS,
    normalizeUrl,
    opencodeLocalProviderBlock,
    windowLimit,
    type LocalModel,
} from '../../agentBackends/localModel'

export { THINKING_VARIANTS, windowLimit }

/** A limit for a provider Bismuth did not declare (the user's config, opencode's discovery). The
 *  merge into an existing provider is deep (limit-verdict.md), so `baseURL` is not written. */
export type OpencodeModelLimit = {
    providerID: string
    modelID: string
    context: number
    output: number
    baseURL: string
}

/** A saved local server, probed, ready to be declared as an opencode provider. */
export type OpencodeInjectedServer = {
    id: string
    name: string
    url: string
    apiKey: string
    models: { id: string; window: number | null }[]
}

export type OpencodeConfigInput = {
    local: {
        lm: LocalModel
        model: string
        models: string[]
        windows: Record<string, number>
    } | null
    servers: OpencodeInjectedServer[]
    limits: OpencodeModelLimit[]
    profile: 'default' | 'compact'
    /** The installed Bismuth MCP server, declared as opencode's `bismuth` MCP on both
     *  profiles. */
    mcp?: { command: string[]; environment: Record<string, string> } | null
    /** The chat's permission mode (the header's): `bypassPermissions` lets opencode edit without
     *  asking; any other mode asks before a file edit, so a write raises a permission frame. Absent
     *  adds no rule. */
    permissionMode?: string
}

/** Tools the compact profile removes from the schema (`r/d3.json`): read, edit, write, shell, grep
 *  and glob stay. `opencode_*` and `execute` go together, or the opencode tools become direct tools. */
export const COMPACT_PERMISSIONS = [
    'skill',
    'execute',
    'opencode_*',
    'question',
    'websearch',
    'webfetch',
    'subagent',
    'task',
].map(action => ({ action, resource: '*', effect: 'deny' }))

export const COMPACT_AGENT_SYSTEM =
    "You are a notes assistant working in the user's vault. Use the tools to read, search and edit files. Be brief."

/** The config object, or null when there is nothing to inject. */
export function buildOpencodeConfig(
    input: OpencodeConfigInput,
): Record<string, unknown> | null {
    const provider: Record<string, Record<string, unknown>> = {}
    const out: Record<string, unknown> = {}
    if (input.local) {
        const { lm, model, models, windows } = input.local
        provider[LOCAL_PROVIDER_ID] = opencodeLocalProviderBlock(
            lm,
            model,
            models,
            windows,
        )
        out.model = `${LOCAL_PROVIDER_ID}/${model}`
    }
    for (const s of input.servers) {
        const models: Record<string, unknown> = {}
        for (const m of s.models)
            models[m.id] = {
                name: m.id,
                variants: structuredClone(THINKING_VARIANTS),
                ...(m.window ? { limit: windowLimit(m.window, null) } : {}),
            }
        provider[s.id] = {
            npm: '@ai-sdk/openai-compatible',
            name: s.name,
            options: {
                baseURL: `${normalizeUrl(s.url)}/v1`,
                ...(s.apiKey ? { apiKey: s.apiKey } : {}),
            },
            models,
        }
    }
    for (const l of input.limits) {
        const p = (provider[l.providerID] ??= {})
        const models = ((p.models as Record<string, Record<string, unknown>>) ??=
            {})
        models[l.modelID] = {
            ...models[l.modelID],
            limit: { context: l.context, output: l.output },
        }
    }
    if (Object.keys(provider).length > 0) out.provider = provider
    if (input.mcp)
        // On both profiles: the compact one keeps the tool (a ~200-token schema) so a small window
        // still reaches Bismuth. Code Mode off: the tools are called directly, as a Claude chat
        // calls them.
        out.mcp = {
            bismuth: {
                type: 'local',
                command: [...input.mcp.command],
                environment: { ...input.mcp.environment },
                codemode: false,
            },
        }
    const rules: Record<string, unknown>[] = []
    if (input.profile === 'compact')
        rules.push(...COMPACT_PERMISSIONS.map(p => ({ ...p })))
    if (input.permissionMode)
        rules.push({
            action: 'edit',
            resource: '*',
            effect: input.permissionMode === 'bypassPermissions' ? 'allow' : 'ask',
        })
    if (rules.length > 0) out.permissions = rules
    if (input.profile === 'compact') {
        out.agents = {
            build: { system: COMPACT_AGENT_SYSTEM },
            plan: { system: COMPACT_AGENT_SYSTEM },
        }
    }
    return Object.keys(out).length > 0 ? out : null
}

/** `buildOpencodeConfig` as the env var's string, or null. */
export function opencodeConfigContent(input: OpencodeConfigInput): string | null {
    const cfg = buildOpencodeConfig(input)
    return cfg ? JSON.stringify(cfg) : null
}

/** `injected` deep-merged over `inherited`: objects merge key by key, and anything else (a scalar,
 *  an array) is taken from `injected` where both set a key. Pure. */
export function mergeOpencodeConfig(
    inherited: Record<string, unknown>,
    injected: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...inherited }
    for (const [k, v] of Object.entries(injected)) {
        const prev = out[k]
        out[k] =
            isPlainObject(prev) && isPlainObject(v)
                ? mergeOpencodeConfig(prev, v)
                : v
    }
    return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseConfigObject(raw: string | undefined): Record<string, unknown> | null {
    if (!raw) return null
    try {
        const v: unknown = JSON.parse(raw)
        return isPlainObject(v) ? v : null
    } catch {
        return null
    }
}

/** The env an opencode process spawns with: `base` (the inherited env) with `extra` laid over it,
 *  except that an inherited `OPENCODE_CONFIG_CONTENT` is kept and Bismuth's injected one is
 *  deep-merged over it (`mergeOpencodeConfig`), so a provider, model or other key set there
 *  survives. An inherited value that is not a JSON object is replaced. Pure. */
export function withInjectedConfig(
    base: Record<string, string>,
    extra?: Record<string, string> | null,
): Record<string, string> {
    const out = { ...base, ...(extra ?? {}) }
    const inherited = parseConfigObject(base.OPENCODE_CONFIG_CONTENT)
    const injected = parseConfigObject(extra?.OPENCODE_CONFIG_CONTENT)
    if (inherited && injected) {
        const merged = mergeOpencodeConfig(inherited, injected)
        // Permission rules are ordered and the last match wins: Bismuth's go first so the user's own
        // rules sit over them (a rule of theirs for `edit` is not overwritten).
        if (
            Array.isArray(inherited.permissions) &&
            Array.isArray(injected.permissions)
        )
            merged.permissions = [
                ...injected.permissions,
                ...inherited.permissions,
            ]
        out.OPENCODE_CONFIG_CONTENT = JSON.stringify(merged)
    }
    return out
}

/** One saved local server as `chat.opencodeServers` stores it. */
export type OpencodeSavedServerSetting = {
    id: string
    name: string
    url: string
    apiKey: string
}

/** Provider ids Bismuth mints: `local-<slug>`, `-2`, `-3` on collision. Always `[a-z0-9-]`. */
export function opencodeServerId(name: string, taken: readonly string[]): string {
    const slug =
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'server'
    const base = `local-${slug}`
    if (!taken.includes(base)) return base
    for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`
}

/** The raw `chat.opencodeServers` value. Malformed entries are dropped; never throws. */
export function parseOpencodeServers(section: unknown): OpencodeSavedServerSetting[] {
    if (!Array.isArray(section)) return []
    const out: OpencodeSavedServerSetting[] = []
    const taken: string[] = []
    for (const e of section) {
        if (!e || typeof e !== 'object') continue
        const r = e as Record<string, unknown>
        const url = typeof r.url === 'string' ? normalizeUrl(r.url) : ''
        if (!/^https?:\/\/\S+$/.test(url)) continue
        const name = typeof r.name === 'string' ? r.name.trim() : ''
        const given = typeof r.id === 'string' ? r.id.trim() : ''
        const id =
            /^local-[a-z0-9-]+$/.test(given) && !taken.includes(given)
                ? given
                : opencodeServerId(name || url, taken)
        taken.push(id)
        out.push({
            id,
            name: name || url,
            url,
            apiKey: typeof r.apiKey === 'string' ? r.apiKey.trim() : '',
        })
    }
    return out
}
