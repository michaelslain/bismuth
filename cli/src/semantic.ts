// Meaning queries for the CLI: the blended `search` (hybridQuery) and `map --around`'s `similar:`.
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
import { chatSemanticSearch } from '../../core/src/chatEmbed'
import { cliGateChannel } from '../../core/src/visibilityCliGate'
import { filterByPath } from '../../core/src/visibilityFilter'
import { hybridSearch, type HybridResult } from '../../core/src/hybridSearch'
import type { DenyEntry } from '../../core/src/visibility'

/** One semantic hit: a file (note, pdf with `page`, image by its binary path) or a chat
 *  (`path` is `chat <session-id>`, with `date` and `session`). */
export type SearchHit = Omit<SemanticHit, 'kind'> & {
    kind?: 'note' | 'pdf' | 'image' | 'chat'
    date?: string
    session?: string
}
export type SemanticResult = SearchHit[] | SemanticUnavailable

/** The running core to ask: an explicit --api / BISMUTH_API / CLAUDE_RELAY_URL, else the core the
 *  run registry lists for this vault. Never the :4321 guess, which may serve another vault. An
 *  explicit base whose port the run registry lists for a DIFFERENT vault (an app terminal for
 *  vault A exports its own core to every command) is ignored for this vault's registry core. */
export function coreFor(args: string[], vault: string): string | undefined {
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

const isHits = (v: unknown): v is { hits: SearchHit[] } =>
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

const agentChannel = (): 'chat' | 'daemon' | null => cliGateChannel() as 'chat' | 'daemon' | null

/** An agent in a vault that restricts anything gets no chat hits (the rule `bismuth history` keeps). */
const withoutChats = (hits: SearchHit[], deny: DenyEntry[]): SearchHit[] =>
    deny.length > 0 ? hits.filter(h => h.kind !== 'chat') : hits

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
        const r = await tryCall(base, 'POST', '/search/semantic', { ...q, k: k + deny.length, ...(deny.length > 0 ? { chats: false } : {}), ...(agentChannel() === 'daemon' ? { channel: 'daemon' } : {}) }, timeoutMs ?? DEFAULT_WAIT_MS + 5000)
        if ('timeout' in r) return WARMING
        // A live core that answered with a failure is not an absent one: never load a model here.
        if ('error' in r) return fail(`POST /search/semantic → ${r.error}: ${r.message || 'the running server failed the request'}`)
        if ('value' in r) {
            if (isHits(r.value)) return withoutChats(filterByPath(r.value.hits, deny, h => h.path), deny).slice(0, k)
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
    const wantChats = q.around === undefined && deny.length === 0
    const run: Promise<SemanticResult> =
        q.around !== undefined
            ? vaultSemanticNeighbours(vault, q.around, opts)
            : Promise.all([
                  vaultSemanticSearch(vault, q.query ?? '', opts),
                  wantChats
                      ? chatSemanticSearch(vault, q.query ?? '', {
                            k,
                            channel: agentChannel() === 'daemon' ? 'daemon' : 'chat',
                            waitMs: remaining,
                            build: true,
                        })
                      : Promise.resolve([]),
              ]).then(([files, chats]) => {
                  if (isSemanticUnavailable(files)) return files
                  // The chat source being unavailable leaves the files alone.
                  const chatHits: SearchHit[] = Array.isArray(chats)
                      ? chats.map(c => ({
                            path: `chat ${c.id}`,
                            score: c.score,
                            excerpt: c.excerpt,
                            kind: 'chat' as const,
                            date: c.date,
                            session: c.id,
                        }))
                      : []
                  const fileHits: SearchHit[] = files.map(h => ({ ...h, kind: h.kind ?? 'note' }))
                  return [...fileHits, ...chatHits].sort((a, b) => b.score - a.score).slice(0, k)
              })
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
    return !Array.isArray(r) ? r : withoutChats(filterByPath(r, deny, h => h.path), deny)
}

const isHybrid = (v: unknown): v is HybridResult =>
    !!v && Array.isArray((v as { hits?: unknown }).hits) && typeof (v as { mode?: unknown }).mode === 'string'

/** What `bismuth search <query>` runs: keyword and meaning blended (core's `hybridSearch`). A reachable
 *  running core answers over POST /search/hybrid; otherwise the query runs in-process, which builds
 *  the index itself when the build can host the model. Every way the meaning side can be missing (off,
 *  no worker, warming, a core too slow) yields the keyword list with a `reason`; a core that answers
 *  with an error is not an absent one and fails. Hits are filtered by `deny` here as well, so an agent
 *  never sees a denied note whichever side answered. */
export async function hybridQuery(
    args: string[],
    vault: string,
    query: string,
    deny: DenyEntry[],
    limit: number,
    timeoutMs?: number,
): Promise<HybridResult> {
    const channel = agentChannel() === 'daemon' ? 'daemon' : 'chat'
    const keywordOnly = (reason: string) => hybridSearch(vault, query, { limit, deny, channel, keywordOnly: reason })
    const base = coreFor(args, vault)
    if (base) {
        // The CLI's owner token proves "owner", so an agent names its channel and the route applies
        // that deny list to both lists before fusion.
        const agent = agentChannel()
        const r = await tryCall(
            base,
            'POST',
            '/search/hybrid',
            { query, limit, ...(agent ? { agent } : {}), ...(channel === 'daemon' ? { channel } : {}) },
            timeoutMs ?? DEFAULT_WAIT_MS + 5000,
        )
        if ('timeout' in r) return keywordOnly('warming')
        if ('error' in r) return fail(`POST /search/hybrid → ${r.error}: ${r.message || 'the running server failed the request'}`)
        if ('value' in r && isHybrid(r.value)) {
            return { ...r.value, hits: filterByPath(r.value.hits, deny, h => h.path) }
        }
    }
    return hybridSearch(vault, query, { limit, deny, channel, build: true, waitMs: timeoutMs ?? DEFAULT_WAIT_MS })
}
