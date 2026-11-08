// Keyword + meaning search for `bismuth search`: core's BM25 ranking and the semantic sources fused by
// reciprocal rank, then reranked. Embedding and reranker stacks are lazy-imported (memoryEmbed.test.ts
// pins core boot's import graph); a caller with no model gets the keyword list in the same shape.
import { buildDenyPaths } from './visibility'
import type { DenyEntry } from './visibility'
import type { RequestChannel } from './ownerToken'
import { filterByPath } from './visibilityFilter'
import { rankCandidates } from './search'
import { readEmbeddingsEnabledSync } from './embeddingsSetting'
import { loadFusionModel, type FusionModel } from './sourceGate'

export type HybridHit = {
    path: string
    kind: 'note' | 'pdf' | 'image' | 'chat'
    score: number
    excerpt: string
    page?: number
    session?: string
    date?: string
}

export type HybridResult = { hits: HybridHit[]; mode: 'hybrid' | 'keyword'; reason?: string }

export type HybridOpts = {
    limit: number
    deny: DenyEntry[]
    channel: 'chat' | 'daemon'
    rerank?: boolean
    /** This process is the only one that will embed (a one-shot CLI with no core): build the index now. */
    build?: boolean
    /** Budget for the meaning side, ms (default: the semantic sources' own wait). */
    waitMs?: number
    /** Skip the meaning side and answer from keywords, with this as the `reason`. */
    keywordOnly?: string
    /** Test seam and bench override: the blend to use instead of the committed fit. */
    fusion?: FusionModel | null
}

/** Reciprocal-rank constant of callers with no fit of their own (docs search). */
const RRF_K = 60
/** Candidates each side contributes to the fusion. */
const POOL = 60
/** The fused head the cross-encoder reorders. */
const RERANK_TOP = 20
const EXCERPT_CHARS = 300
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|avif|svg)$/i

/** Reciprocal-rank fusion: each list's items score `weight / (k + rank)` (weight 1 when absent),
 *  summed by key; best first. The item kept for a key is the one from the first list that holds it.
 *  `bismuth search` passes the fitted weights and k; a caller with none gets equal weights. */
export function fuseRanks<T>(
    lists: { key: (t: T) => string; items: T[]; weight?: number }[],
    k = RRF_K,
): { item: T; score: number }[] {
    const by = new Map<string, { item: T; score: number }>()
    for (const l of lists) {
        l.items.forEach((item, i) => {
            const key = l.key(item)
            const add = (l.weight ?? 1) / (k + i + 1)
            const cur = by.get(key)
            if (cur) cur.score += add
            else by.set(key, { item, score: add })
        })
    }
    return [...by.values()].sort((a, b) => b.score - a.score)
}

const kindOf = (path: string): HybridHit['kind'] =>
    /\.pdf$/i.test(path) ? 'pdf' : IMAGE_EXT.test(path) ? 'image' : 'note'

const clip = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim()
    return t.length > EXCERPT_CHARS ? t.slice(0, EXCERPT_CHARS - 1) + '…' : t
}

/** The first line holding any query word, else the first non-empty line. */
function keywordExcerpt(body: string, query: string): string {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
    const hit = lines.find(l => {
        const low = l.toLowerCase()
        return words.some(w => low.includes(w))
    })
    return clip(hit ?? lines[0] ?? '')
}

const keyOf = (h: HybridHit) => `${h.kind}:${h.path}`

async function keywordHits(vault: string, query: string, deny: DenyEntry[]): Promise<HybridHit[]> {
    const ranked = await rankCandidates(vault, query, POOL + deny.length)
    return filterByPath(ranked, deny, r => r.path)
        .slice(0, POOL)
        .map(r => ({ path: r.path, kind: kindOf(r.path), score: 0, excerpt: keywordExcerpt(r.body, query) }))
}

/** Fused scores scaled so the best hit is 1. */
const normalise = (fused: { item: HybridHit; score: number }[]): HybridHit[] => {
    const top = fused[0]?.score || 1
    return fused.map(f => ({ ...f.item, score: Math.round((f.score / top) * 1e4) / 1e4 }))
}

type Semantic = { hits: HybridHit[] } | { unavailable: string }

async function meaningHits(vault: string, query: string, opts: HybridOpts): Promise<Semantic> {
    const { vaultSemanticSearch, isSemanticUnavailable } = await import('./vaultEmbed')
    const base = { k: POOL, deny: opts.deny, waitMs: opts.waitMs, build: opts.build }
    // A transcript may quote any restricted note, so a vault that restricts a note or folder
    // (per-chat levels alone do not count) recalls no chats: the rule `sourcesFor` keeps.
    const wantChats = !opts.deny.some(e => e.kind !== 'chat')
    const [files, chats] = await Promise.all([
        vaultSemanticSearch(vault, query, base),
        wantChats
            ? import('./chatEmbed').then(m =>
                  m.chatSemanticSearch(vault, query, {
                      k: POOL,
                      channel: opts.channel,
                      waitMs: opts.waitMs,
                      build: opts.build,
                  }),
              )
            : Promise.resolve([]),
    ])
    if (isSemanticUnavailable(files)) return { unavailable: files.unavailable }
    const fileHits: HybridHit[] = filterByPath(files, opts.deny, h => h.path).map(h => {
        const hit: HybridHit = { path: h.path, kind: h.kind ?? 'note', score: h.score, excerpt: h.excerpt }
        if (h.page !== undefined) hit.page = h.page
        return hit
    })
    // The chat source being unavailable leaves the files alone.
    const chatHits: HybridHit[] = Array.isArray(chats)
        ? chats.map(c => ({
              path: `chat ${c.id}`,
              kind: 'chat' as const,
              score: c.score,
              excerpt: c.excerpt,
              date: c.date,
              session: c.id,
          }))
        : []
    return { hits: [...fileHits, ...chatHits].sort((a, b) => b.score - a.score) }
}

/** Reorder the fused head by the cross-encoder when it answers inside its budget; scores stay the
 *  fused ones, handed out in the new order so they remain descending. */
async function rerankHead(query: string, hits: HybridHit[]): Promise<HybridHit[]> {
    try {
        const { sharedReranker, RERANK_TIMEOUT_MS } = await import('./memoryRerank')
        const reranker = sharedReranker()
        if (!reranker) return hits
        const head = hits.slice(0, RERANK_TOP)
        if (head.length < 2) return hits
        const work = reranker.rerank(query, head.map(h => h.excerpt))
        work.catch(() => {})
        let timer: ReturnType<typeof setTimeout> | undefined
        const late = new Promise<undefined>(res => {
            timer = setTimeout(() => res(undefined), RERANK_TIMEOUT_MS)
        })
        let logits: number[] | undefined
        try {
            logits = await Promise.race([work, late])
        } finally {
            clearTimeout(timer)
        }
        if (!logits || logits.length !== head.length) return hits
        const order = head.map((h, i) => ({ h, i, l: logits![i] })).sort((a, b) => b.l - a.l || a.i - b.i)
        const reordered = order.map((o, i) => ({ ...o.h, score: head[i].score }))
        return [...reordered, ...hits.slice(RERANK_TOP)]
    } catch {
        return hits
    }
}

/** Both candidate lists a search blends, each best first and `POOL` deep: the keyword ranking and the
 *  meaning ranking (files and chats). `bench/recallReplay.ts` reads them to fit the blend. */
export async function searchPools(
    vault: string,
    query: string,
    opts: HybridOpts,
): Promise<{ keyword: HybridHit[]; meaning: HybridHit[] } | { unavailable: string }> {
    const [keyword, meaning] = await Promise.all([keywordHits(vault, query, opts.deny), meaningHits(vault, query, opts)])
    if ('unavailable' in meaning) return meaning
    return { keyword, meaning: meaning.hits }
}

export async function hybridSearch(vault: string, query: string, opts: HybridOpts): Promise<HybridResult> {
    const keyword = () => keywordHits(vault, query, opts.deny)
    const keywordOnly = async (reason: string): Promise<HybridResult> => {
        const fused = fuseRanks([{ key: keyOf, items: await keyword() }])
        return { hits: normalise(fused).slice(0, opts.limit), mode: 'keyword', reason }
    }
    if (opts.keywordOnly !== undefined) return keywordOnly(opts.keywordOnly)
    if (!readEmbeddingsEnabledSync(vault)) return keywordOnly('off')
    // The blend is fit on measured searches (bench/fitSourceGate.ts); without it there is no honest
    // way to weigh the two lists, so the keyword list answers alone.
    const fusion = opts.fusion === undefined ? loadFusionModel() : opts.fusion
    if (!fusion) return keywordOnly('blend model missing')
    const pools = await searchPools(vault, query, opts)
    if ('unavailable' in pools) return keywordOnly(pools.unavailable)
    // The meaning list leads so a document found by both keeps the semantic best-chunk excerpt.
    let hits = normalise(
        fuseRanks(
            [
                { key: keyOf, items: pools.meaning, weight: fusion.weights.meaning },
                { key: keyOf, items: pools.keyword, weight: fusion.weights.keyword },
            ],
            fusion.k,
        ),
    )
    if (opts.rerank ?? fusion.rerank) hits = await rerankHead(query, hits)
    return { hits: hits.slice(0, opts.limit), mode: 'hybrid' }
}

export async function hybridSearchRoute(
    req: Request,
    ctx: { vault: string; deny: DenyEntry[]; channel: RequestChannel },
): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as {
        query?: unknown
        limit?: unknown
        channel?: unknown
        rerank?: unknown
        agent?: unknown
    }
    if (typeof body.query !== 'string' || !body.query.trim())
        return new Response('query is required', { status: 400 })
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : 10
    // The request proves its channel; only the owner may name the one whose chats it wants.
    const channel = ctx.channel === 'owner' ? (body.channel === 'daemon' ? 'daemon' : 'chat') : ctx.channel
    // The owner token is what the CLI authenticates with, so an agent's CLI names its channel and the
    // deny list is built here, before fusion. A non-owner caller cannot pick its own list.
    const deny =
        ctx.channel === 'owner' && (body.agent === 'chat' || body.agent === 'daemon')
            ? await buildDenyPaths(ctx.vault, body.agent)
            : ctx.deny
    const r = await hybridSearch(ctx.vault, body.query, {
        limit,
        deny,
        channel,
        rerank: body.rerank === false ? false : undefined,
    })
    return Response.json(r)
}
