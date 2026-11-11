// Keyword + meaning search over Bismuth's own docs for `bismuth docs search`: the BM25-style section
// hits of `searchDocs` and the nearest sections of `docsEmbed` fused by reciprocal rank. Everything
// that reads the disk or loads a model is lazy-imported: routes/vault.ts imports this file at boot,
// and mobile runs core in-process.
import type { DocHit } from '../../mcp/src/docs'
import { fuseRanks, rerankHead } from './hybridSearch'
import { loadDocsFusionModel, type FusionModel } from './sourceGate'
import { readEmbeddingsEnabledSync } from './embeddingsSetting'

export type DocsHybridResult = { hits: DocHit[]; mode: 'hybrid' | 'keyword'; reason?: string }

export type DocsHybridOpts = {
    limit: number
    /** The vault whose `embeddings.enabled` decides whether the meaning side runs; none = keyword only. */
    vault?: string
    /** Docs directory (default: core's own resolution). */
    docsRoot?: string
    /** This process is the only one that will embed (a one-shot CLI with no core): build the index now. */
    build?: boolean
    /** Budget for the meaning side, ms. */
    waitMs?: number
    /** Skip the meaning side and answer from keywords, with this as the `reason`. */
    keywordOnly?: string
    /** Test seam and bench override: the blend to use instead of the committed fit (null = equal weights). */
    fusion?: FusionModel | null
}

/** Candidates each side contributes to the fusion. */
const POOL = 60

/** Words that say nothing about a topic: left out of the query the keyword side of a blend scores, so
 *  "how do embeddings work" is not outvoted by every section that says "how it works". Plain keyword
 *  mode keeps the query whole. */
const FILLER = new Set(
    'a an and are can do does did for how i in is it my of on or the to what when where which who why with work works working'.split(' '),
)
export const topicWords = (query: string): string => {
    const words = query.split(/\s+/).filter(Boolean)
    const kept = words.filter(w => !FILLER.has(w.toLowerCase().replace(/[^a-z]/g, '')))
    return (kept.length > 0 ? kept : words).join(' ')
}

/** A meaning hit as a docs hit: the section heading is the part of the title after `Page // `. */
function asDocHit(h: { id: string; title?: string; excerpt: string; score: number }): DocHit {
    return { path: h.id, heading: (h.title ?? h.id).split(' // ').pop()!, snippet: h.excerpt, score: h.score }
}

export async function docsHybridSearch(query: string, opts: DocsHybridOpts): Promise<DocsHybridResult> {
    const { searchDocs } = await import('../../mcp/src/docs')
    const root = opts.docsRoot ?? (await import('./docsEmbed')).resolveDocsRoot()
    if (!root) return { hits: [], mode: 'keyword', reason: 'no-docs' }
    // The keyword answer is today's `searchDocs` result, scores and order untouched.
    const keywordOnly = (reason: string): DocsHybridResult => ({
        hits: searchDocs(root, query, opts.limit),
        mode: 'keyword',
        reason,
    })
    if (opts.keywordOnly !== undefined) return keywordOnly(opts.keywordOnly)
    if (!opts.vault || !readEmbeddingsEnabledSync(opts.vault)) return keywordOnly('off')
    const { docsQueryHits } = await import('./docsEmbed')
    const meaning = await docsQueryHits(query, { k: POOL, root, build: opts.build, waitMs: opts.waitMs })
    if ('unavailable' in meaning) return keywordOnly(meaning.unavailable)
    const keyword = searchDocs(root, topicWords(query), POOL)
    // The blend fit on docs questions (bench/docsSearchReplay.ts); none committed = equal weights.
    const fusion = opts.fusion === undefined ? loadDocsFusionModel() : opts.fusion
    // The keyword list leads so a section found by both keeps its match-centred snippet.
    const fused = fuseRanks<DocHit>(
        [
            { key: h => h.path, items: keyword, weight: fusion?.weights.keyword },
            { key: h => h.path, items: meaning.hits.map(asDocHit), weight: fusion?.weights.meaning },
        ],
        fusion?.k,
    )
    const top = fused[0]?.score || 1
    let hits = fused.map(f => ({ ...f.item, score: Math.round((f.score / top) * 1e4) / 1e4 }))
    if (fusion?.rerank) hits = await rerankHead(query, hits, h => `${h.heading}\n${h.snippet}`)
    return { hits: hits.slice(0, opts.limit), mode: 'hybrid' }
}

export async function docsSearchRoute(req: Request, ctx: { vault: string }): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { query?: unknown; limit?: unknown }
    if (typeof body.query !== 'string' || !body.query.trim()) return new Response('query is required', { status: 400 })
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : 8
    return Response.json(await docsHybridSearch(body.query, { limit, vault: ctx.vault }))
}
