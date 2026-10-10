// Semantic (embedding) queries for the CLI: `search --semantic` and `map --around`'s `similar:`.
// A reachable running core for this vault answers over POST /search/semantic; otherwise, when this
// build can run the embedding worker, the query runs in-process.
import { resolve } from 'node:path'
import { fail, flag, optionalVault } from './args'
import { tryCall } from './http'
import { readRunRecords, resolveRunRegistryBase } from '../../core/src/runRegistry'
import { workerAvailable } from '../../core/src/memoryEmbed'
import { readEmbeddingsEnabledSync } from '../../core/src/embeddingsSetting'
import {
    DEFAULT_WAIT_MS,
    isSemanticUnavailable,
    vaultSemanticNeighbours,
    vaultSemanticSearch,
    type SemanticHit,
    type SemanticUnavailable,
} from '../../core/src/vaultEmbed'
import { filterByPath } from '../../core/src/visibilityFilter'
import type { DenyEntry } from '../../core/src/visibility'

export type SemanticResult = SemanticHit[] | SemanticUnavailable

/** The running core to ask: an explicit --api / BISMUTH_API / CLAUDE_RELAY_URL, else the core the
 *  run registry lists for this vault. Never the :4321 guess, which may serve another vault. An
 *  explicit base whose port the run registry lists for a DIFFERENT vault (an app terminal for
 *  vault A exports its own core to every command) is ignored for this vault's registry core. */
function coreFor(args: string[], vault: string): string | undefined {
    const target = optionalVault(args) ?? vault
    const explicit = flag(args, 'api') ?? process.env.BISMUTH_API ?? process.env.CLAUDE_RELAY_URL
    if (explicit) {
        const base = explicit.replace(/\/+$/, '')
        let port = NaN
        try {
            port = Number(new URL(base).port)
        } catch {}
        const rec = Number.isFinite(port) ? readRunRecords().find(r => r.port === port) : undefined
        if (!rec || resolve(rec.vault) === resolve(target)) return base
    }
    return resolveRunRegistryBase(target)
}

const isHits = (v: unknown): v is { hits: SemanticHit[] } =>
    !!v && Array.isArray((v as { hits?: unknown }).hits)
const isUnavailable = (v: unknown): v is SemanticUnavailable =>
    !!v && typeof (v as { unavailable?: unknown }).unavailable === 'string'

const NO_WORKER: SemanticUnavailable = {
    unavailable: 'no-worker',
    message:
        'no running Bismuth app answered for this vault, and this build cannot run the embedding model: open the vault in the Bismuth app',
}
const OFF: SemanticUnavailable = {
    unavailable: 'off',
    message: 'embeddings are off: set `embeddings.enabled` to true in the vault .settings',
}
const WARMING: SemanticUnavailable = {
    unavailable: 'warming',
    message: 'the running server did not answer in time',
}

/** Test seam: replaces `workerAvailable` for one call. */
export type SemanticDeps = { workerAvailable?: () => boolean }

/** One semantic query (`query` or `around`). Hits are filtered by `deny` here as well, so an agent
 *  never sees a denied note whichever side answered. `timeoutMs` is ONE budget for the whole call,
 *  server attempt and in-process fallback together; without it the server gets the route's own
 *  wait plus a margin. A server that did not answer in time yields `warming`, never an in-process
 *  run: it is likely still loading the model against the same cache. */
export async function semanticQuery(
    args: string[],
    vault: string,
    q: { query?: string; around?: string },
    deny: DenyEntry[],
    k: number,
    timeoutMs?: number,
    deps: SemanticDeps = {},
): Promise<SemanticResult> {
    const started = Date.now()
    const base = coreFor(args, vault)
    if (base) {
        // The route only filters by the channel the REQUEST proves, and the CLI's owner token proves
        // "owner", so it returns the unfiltered top k. Ask for k + deny.length, then filter and cut
        // back to k: buildDenyPaths emits one entry per restricted file, so deny.length bounds the
        // notes the filter can remove.
        const r = await tryCall(base, 'POST', '/search/semantic', { ...q, k: k + deny.length }, timeoutMs ?? DEFAULT_WAIT_MS + 5000)
        if ('timeout' in r) return WARMING
        // A live core that answered with a failure is not an absent one: never load a model here.
        if ('error' in r) return fail(`POST /search/semantic → ${r.error}: ${r.message || 'the running server failed the request'}`)
        if ('value' in r) {
            if (isHits(r.value)) return filterByPath(r.value.hits, deny, h => h.path).slice(0, k)
            if (isUnavailable(r.value)) return r.value
        }
    }
    if (!readEmbeddingsEnabledSync(vault)) return OFF
    if (!(deps.workerAvailable ?? workerAvailable)()) return NO_WORKER
    const remaining = timeoutMs === undefined ? undefined : timeoutMs - (Date.now() - started)
    if (remaining !== undefined && remaining <= 0)
        return { unavailable: 'warming', message: 'the semantic index did not answer in time' }
    // No core will ever embed this vault for us, so the query builds the index itself.
    const opts = { k, deny, waitMs: remaining, build: true }
    const run =
        q.around !== undefined
            ? vaultSemanticNeighbours(vault, q.around, opts)
            : vaultSemanticSearch(vault, q.query ?? '', opts)
    let timer: ReturnType<typeof setTimeout> | undefined
    const r = remaining !== undefined
        ? await Promise.race([
              run,
              new Promise<SemanticUnavailable>(res => {
                  timer = setTimeout(
                      () => res({ unavailable: 'warming', message: 'the semantic index did not answer in time' }),
                      remaining,
                  )
              }),
          ])
        : await run
    clearTimeout(timer)
    return isSemanticUnavailable(r) ? r : filterByPath(r, deny, h => h.path)
}
