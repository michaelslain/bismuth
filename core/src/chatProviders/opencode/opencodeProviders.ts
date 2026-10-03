// core/src/chatProviders/opencode/opencodeProviders.ts
// The provider-connect surface over the running `opencode serve`: list what is connected / what can
// be, store an API key, and drive an OAuth sign-in. Every function takes an opencode CLIENT, so the
// tests drive them with a hand-written fake and no binary.
//
// SECRETS: an API key goes core -> `client.auth.set` (opencode's own credential store) and nowhere
// else. It is never logged, never written by Bismuth, and never appears in a thrown message — every
// message that leaves this module is run through `redact`.
import type { OpencodeClient } from '@opencode-ai/sdk'
import { LOCAL_PROVIDER_ID } from '../../agentBackends/localModel'

export type OpencodeAuthMethod = { type: 'api' | 'oauth'; label: string }
export type OpencodeProviderList = {
    connected: { id: string; name: string; kind: 'api' | 'oauth' | 'env' }[]
    available: { id: string; name: string; methods: OpencodeAuthMethod[] }[]
}
export type OpencodeAuthorization = {
    url: string
    method: 'auto' | 'code'
    instructions: string
}

/** opencode refused the request, or the request was malformed. `message` is safe to show: it never
 *  contains the API key. Routes map this to 400 `bad-request`. */
export class OpencodeBadRequest extends Error {}

const DEFAULT_METHODS: OpencodeAuthMethod[] = [
    { type: 'api', label: 'API key' },
]

/** Provider ids as opencode spells them (`github-copilot`, `amazon-bedrock`, `openrouter`). */
export function validProviderId(id: unknown): id is string {
    return typeof id === 'string' && /^[\w.:-]{1,100}$/.test(id)
}

function redact(text: string, secret?: string): string {
    return secret ? text.split(secret).join('[redacted]') : text
}

/** A displayable message out of whatever opencode (or fetch) returned, with `secret` scrubbed. */
function messageOf(err: unknown, fallback: string, secret?: string): string {
    let raw = ''
    if (typeof err === 'string') raw = err
    else if (err && typeof err === 'object') {
        const e = err as {
            message?: unknown
            data?: { message?: unknown }
            error?: unknown
        }
        if (typeof e.data?.message === 'string') raw = e.data.message
        else if (typeof e.message === 'string') raw = e.message
        else if (typeof e.error === 'string') raw = e.error
    }
    return redact(raw.trim() || fallback, secret)
}

/** Call into the client; a rejection OR an `{error}` result becomes an OpencodeBadRequest. */
async function call<T>(
    run: () => Promise<{ data?: T; error?: unknown }>,
    fallback: string,
    secret?: string,
): Promise<T | undefined> {
    let res: { data?: T; error?: unknown }
    try {
        res = await run()
    } catch (e) {
        throw new OpencodeBadRequest(messageOf(e, fallback, secret))
    }
    if (res.error)
        throw new OpencodeBadRequest(messageOf(res.error, fallback, secret))
    return res.data
}

/**
 * Connected providers + the ones that could be added. `kind` of a connected provider: `env` when one
 * of its documented env vars is set in `env` (the environment the opencode server inherited); else
 * `oauth` when its only reported sign-in is OAuth; else `api`. The local-model provider Bismuth
 * injects (`LOCAL_PROVIDER_ID`) is neither — it is configured in `.settings`, not connected here.
 */
export async function listProviders(
    client: OpencodeClient,
    env: Record<string, string | undefined> = process.env,
): Promise<OpencodeProviderList> {
    const list = await call(
        () => client.provider.list() as never,
        'opencode could not list providers',
    )
    const auth =
        (await call(
            () => client.provider.auth() as never,
            'opencode could not list sign-in methods',
        )) ?? {}
    const data = list as
        | {
              all?: { id: string; name: string; env?: string[] }[]
              connected?: string[]
          }
        | undefined
    const methodsOf = (id: string): OpencodeAuthMethod[] => {
        const m = (auth as Record<string, OpencodeAuthMethod[]>)[id]
        return Array.isArray(m) && m.length
            ? m.map(x => ({ type: x.type, label: x.label }))
            : DEFAULT_METHODS
    }
    const connectedIds = new Set(data?.connected ?? [])
    const all = (data?.all ?? []).filter(p => p.id !== LOCAL_PROVIDER_ID)
    const byName = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name)
    return {
        connected: all
            .filter(p => connectedIds.has(p.id))
            .map(p => {
                const methods = methodsOf(p.id)
                const kind: 'api' | 'oauth' | 'env' = (p.env ?? []).some(
                    v => env[v],
                )
                    ? 'env'
                    : methods.every(m => m.type === 'oauth')
                      ? 'oauth'
                      : 'api'
                return { id: p.id, name: p.name, kind }
            })
            .sort(byName),
        available: all
            .filter(p => !connectedIds.has(p.id))
            .map(p => ({ id: p.id, name: p.name, methods: methodsOf(p.id) }))
            .sort(byName),
    }
}

/** Store an API key in opencode's own credential store. */
export async function setProviderKey(
    client: OpencodeClient,
    id: string,
    key: string,
): Promise<void> {
    if (!validProviderId(id))
        throw new OpencodeBadRequest('Unknown provider id.')
    if (typeof key !== 'string' || !key.trim())
        throw new OpencodeBadRequest('An API key is required.')
    await call(
        () =>
            client.auth.set({
                path: { id },
                body: { type: 'api', key },
            }) as never,
        'opencode rejected the API key',
        key,
    )
}

/** Start an OAuth sign-in: the URL to open, and whether opencode finishes on its own (`auto`) or
 *  needs the pasted code (`code`). */
export async function oauthAuthorize(
    client: OpencodeClient,
    id: string,
    method: number,
): Promise<OpencodeAuthorization> {
    if (!validProviderId(id))
        throw new OpencodeBadRequest('Unknown provider id.')
    if (!Number.isInteger(method) || method < 0)
        throw new OpencodeBadRequest('Unknown sign-in method.')
    const res = await call(
        () =>
            client.provider.oauth.authorize({
                path: { id },
                body: { method },
            }) as never,
        'opencode could not start the sign-in',
    )
    const a = res as Partial<OpencodeAuthorization> | undefined
    if (!a || typeof a.url !== 'string' || !a.url)
        throw new OpencodeBadRequest('opencode returned no sign-in URL.')
    return {
        url: a.url,
        method: a.method === 'code' ? 'code' : 'auto',
        instructions: typeof a.instructions === 'string' ? a.instructions : '',
    }
}

/** Finish an OAuth sign-in. `auto` flows resolve when the browser callback lands (no code); `code`
 *  flows pass the pasted code. */
export async function oauthCallback(
    client: OpencodeClient,
    id: string,
    method: number,
    code?: string,
): Promise<void> {
    if (!validProviderId(id))
        throw new OpencodeBadRequest('Unknown provider id.')
    if (!Number.isInteger(method) || method < 0)
        throw new OpencodeBadRequest('Unknown sign-in method.')
    const res = await call(
        () =>
            client.provider.oauth.callback({
                path: { id },
                body: { method, ...(code ? { code } : {}) },
            }) as never,
        'opencode could not finish the sign-in',
        code,
    )
    if (res === false)
        throw new OpencodeBadRequest('opencode did not accept the sign-in.')
}
