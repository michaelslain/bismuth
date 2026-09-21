// core/src/search.ts
// Vault full-text search: a pure line matcher (findMatches) for snippets/replace,
// plus MiniSearch-backed ranking (searchVault) modeled on the Omnisearch plugin.
import MiniSearch from 'minisearch'
import { getFileAccess } from './fileAccess'
import { fileBasename } from './pathUtils'
import { INLINE_TAG_REGEX } from './tags'
import { stripCode } from './wikilinks'
import { mapWithConcurrency } from './concurrency'

export interface SearchOpts {
    caseSensitive: boolean
    wholeWord: boolean
    regex: boolean
}

/** Extra, optional controls over a `searchVault` call. */
export interface SearchVaultOptions {
    /** Max snippets returned PER note. `matchCount` is unaffected — it is always the
     *  true total occurrence count, never `snippets.length`. Default 20. */
    snippetLimit?: number
}

const DEFAULT_SNIPPET_LIMIT = 20

export interface MatchSnippet {
    /** 1-based line number of the match. */
    line: number
    /** Text on the line before the match. */
    before: string
    /** The matched text. */
    match: string
    /** Text on the line after the match. */
    after: string
}

export interface SearchResult {
    path: string
    matchCount: number
    snippets: MatchSnippet[]
    /** Optional one-line rationale — only set by the AI prompt-search path (searchPrompt.ts);
     *  the literal /search path never populates it. Rendered as a faint caption on the switcher's result card. */
    reason?: string
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a global RegExp for `query` honoring the toggles. Throws on an invalid
 * pattern when regex mode is on. Always global so callers can iterate matches.
 */
export function buildMatcher(query: string, opts: SearchOpts): RegExp {
    let source = opts.regex ? query : escapeRegExp(query)
    if (opts.wholeWord) source = `\\b(?:${source})\\b`
    const flags = 'g' + (opts.caseSensitive ? '' : 'i')
    return new RegExp(source, flags)
}

/** Find every match of `query` in `body`, with 1-based line numbers and split context. */
export function findMatches(
    body: string,
    query: string,
    opts: SearchOpts,
): MatchSnippet[] {
    if (!query) return []
    const re = buildMatcher(query, opts)
    const out: MatchSnippet[] = []
    const lines = body.split('\n')
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(line)) !== null) {
            out.push({
                line: i + 1,
                before: line.slice(0, m.index),
                match: m[0],
                after: line.slice(m.index + m[0].length),
            })
            if (m[0].length === 0) re.lastIndex++ // avoid zero-width infinite loop
        }
    }
    return out
}

/** Extract markdown heading text (lines starting with #) for index weighting. */
function extractHeadings(body: string): string {
    return body
        .split('\n')
        .filter(l => /^#{1,6}\s/.test(l))
        .map(l => l.replace(/^#{1,6}\s/, ''))
        .join(' ')
}

/** Extract #tags from the body for index weighting. */
function extractBodyTags(body: string): string {
    // Strip fenced/inline code first (exactly like tags.ts extractTags) so tags inside
    // code blocks don't get indexed — keeping search's tag set in sync with the graph's.
    return [...stripCode(body).matchAll(INLINE_TAG_REGEX)]
        .map(m => m[1])
        .join(' ')
}

interface IndexDoc {
    id: string // path
    basename: string
    headings: string
    tags: string
    body: string
}

// Per-vault cached search index: the built MiniSearch index plus the per-path body map.
// listMarkdown + readNote over the whole vault on every keystroke-driven search is the
// hot cost; this builds once and reuses until a file-watch change invalidates it (see
// invalidateSearchIndex, wired into the server's applyDirty path). Results are identical
// to the uncached path for a given vault state because the index/bodies are rebuilt from
// the same listMarkdown + readNote inputs.
interface SearchIndex {
    mini: MiniSearch<IndexDoc>
    bodies: Map<string, string>
    // Lowercased mirror of `bodies`, kept in sync alongside it. Lets the case-insensitive
    // non-regex path in searchVault screen every note with a plain indexOf before paying for
    // a findMatches scan (buildMatcher + a RegExp per line) — the "cost control for every
    // note" this uncapped search relies on.
    lowerBodies: Map<string, string>
    paths: string[]
}
const indexCache = new Map<string, SearchIndex>()
// Dedupe concurrent cold builds for the same vault (mirrors AsyncCache's in-flight guard).
const indexInFlight = new Map<string, Promise<SearchIndex>>()
// Per-root generation counter (mirrors AsyncCache's generation guard): captured when a
// build starts and re-checked when it settles, so an invalidateSearchIndex() during the
// build drops the now-stale result instead of repopulating the cache with it.
const indexGeneration = new Map<string, number>()

/** Drop the cached search index for a vault (or all vaults). Called on file-watch invalidation. */
export function invalidateSearchIndex(root?: string): void {
    if (root === undefined) {
        indexCache.clear()
        indexInFlight.clear()
        indexGeneration.clear()
    } else {
        indexCache.delete(root)
        indexInFlight.delete(root)
        indexGeneration.set(root, (indexGeneration.get(root) ?? 0) + 1)
    }
}

/**
 * Incrementally patch the cached search index for the changed `paths` — re-reading just those notes
 * instead of dropping the whole index and re-walking the vault on the next /search (which was the cold
 * cost paid after every edit). No-op when no .md changed. When nothing is cached yet, fall back to a
 * full invalidation (which also drops any in-flight build, so the next search rebuilds from current
 * files). Per path: gone-from-disk → discard; already-indexed → replace; new → add. `bodies` is the
 * authority for "is this path indexed". Mutates the cached index in place.
 */
export async function updateSearchIndex(
    root: string,
    paths: string[],
): Promise<void> {
    const idx = indexCache.get(root)
    if (!idx) {
        invalidateSearchIndex(root)
        return
    }
    const mdPaths = paths.filter(p => p.endsWith('.md'))
    if (mdPaths.length === 0) return
    const { readNote } = await getFileAccess()
    for (const p of mdPaths) {
        let body: string | null
        try {
            body = await readNote(root, p)
        } catch {
            body = null // unreadable / removed
        }
        const indexed = idx.bodies.has(p)
        if (body === null) {
            if (indexed) {
                idx.mini.discard(p)
                idx.bodies.delete(p)
                idx.lowerBodies.delete(p)
                const i = idx.paths.indexOf(p)
                if (i >= 0) idx.paths.splice(i, 1)
            }
            continue
        }
        const doc: IndexDoc = {
            id: p,
            basename: fileBasename(p),
            headings: extractHeadings(body),
            tags: extractBodyTags(body),
            body,
        }
        if (indexed) {
            idx.mini.replace(doc)
        } else {
            idx.mini.add(doc)
            idx.paths.push(p)
        }
        idx.bodies.set(p, body)
        idx.lowerBodies.set(p, body.toLowerCase())
    }
}

// Cap on concurrent file reads during a cold index build. Reading every note serially made the cold
// build's wall time the SUM of all per-file read latencies; reading them concurrently collapses that to
// roughly one round-trip. Bounded so a huge vault can't exhaust file descriptors / spike memory.
const BUILD_READ_CONCURRENCY = 32

async function buildSearchIndex(root: string): Promise<SearchIndex> {
    const { listMarkdown, readNote } = await getFileAccess()
    const paths = await listMarkdown(root)
    const bodies = new Map<string, string>()
    const lowerBodies = new Map<string, string>()
    const docs = await mapWithConcurrency(
        paths,
        BUILD_READ_CONCURRENCY,
        async p => {
            const body = await readNote(root, p)
            bodies.set(p, body)
            lowerBodies.set(p, body.toLowerCase())
            return {
                id: p,
                basename: fileBasename(p),
                headings: extractHeadings(body),
                tags: extractBodyTags(body),
                body,
            }
        },
    )
    const mini = new MiniSearch<IndexDoc>({
        fields: ['basename', 'headings', 'tags', 'body'],
        storeFields: ['id'],
        searchOptions: {
            boost: { basename: 6, headings: 3, tags: 2, body: 1 },
            prefix: true,
            fuzzy: term => (term.length > 3 ? 0.2 : false),
        },
    })
    // Index in chunks with a REAL macrotask yield between them (addAllAsync uses setTimeout 0),
    // instead of one synchronous addAll: a cold build after a broad invalidation tokenizes the
    // whole vault, and doing that in one shot inside the POST /search handler blocked Bun's
    // single thread — starving the PTY WS and every other request for its duration. Identical
    // final index; race-safe because getSearchIndex's generation guard already discards a build
    // that an invalidation overtook. (A microtask yield would NOT release the I/O poll phase.)
    await mini.addAllAsync(docs, { chunkSize: 200 })
    return { mini, bodies, lowerBodies, paths }
}

async function getSearchIndex(root: string): Promise<SearchIndex> {
    const cached = indexCache.get(root)
    if (cached) return cached
    const pending = indexInFlight.get(root)
    if (pending) return pending
    const gen = indexGeneration.get(root) ?? 0
    const build = buildSearchIndex(root).then(
        idx => {
            indexInFlight.delete(root)
            // Adopt the result only if no invalidation bumped the generation mid-build.
            if ((indexGeneration.get(root) ?? 0) === gen)
                indexCache.set(root, idx)
            return idx
        },
        err => {
            indexInFlight.delete(root)
            throw err
        },
    )
    indexInFlight.set(root, build)
    return build
}

/**
 * Rank vault notes for `query` and attach per-note match snippets. No cap on the number of
 * notes returned — every matching note comes back, and `matchCount` is always the note's TRUE
 * total occurrence count (never `snippets.length`, which is bounded by `extra?.snippetLimit`).
 *
 * Regex mode: MiniSearch can't parse an arbitrary pattern, so every note is scanned and the
 * results are ranked by match count, descending.
 *
 * Non-regex mode ranks in three tiers, each ordered internally, concatenated in this order:
 *   1. Literal hits MiniSearch also ranked — every note MiniSearch returned (BM25/fuzzy/prefix)
 *      that also contains a verbatim occurrence of `query` (honoring caseSensitive/wholeWord),
 *      in MiniSearch's own order.
 *   2. Literal hits MiniSearch missed — every OTHER note with a verbatim occurrence (typically
 *      mid-word, so no MiniSearch token/prefix match), sorted by total match count descending.
 *   3. Typo hits — only when `caseSensitive` is false. Notes with no verbatim occurrence that
 *      match a second, `combineWith: 'AND'` MiniSearch query (so a multi-word query requires
 *      every word to fuzzily match — no single-word OR noise), in that query's order. Snippets
 *      are built from each hit's matched document terms (the real words, not the mistyped
 *      query), merged by line then column. A hit whose matched terms occur only in its
 *      basename/headings/tags and never in the body is dropped — the switcher's file-name rows
 *      already cover names.
 *
 * Cost control: tiers 1 and 2 scan every candidate note's body for a literal match. For the
 * case-insensitive path (the common per-keystroke case) each note is first screened with a
 * plain `indexOf` against a cached lowercased body, so only notes that can possibly match pay
 * for a `findMatches` scan (a RegExp built + walked line by line).
 */
export async function searchVault(
    root: string,
    query: string,
    opts: SearchOpts,
    extra?: SearchVaultOptions,
): Promise<SearchResult[]> {
    if (!query) return []
    const snippetLimit = extra?.snippetLimit ?? DEFAULT_SNIPPET_LIMIT
    const { mini, bodies, lowerBodies, paths } = await getSearchIndex(root)

    if (opts.regex) {
        const results: SearchResult[] = []
        for (const p of paths) {
            const snippets = findMatches(bodies.get(p) ?? '', query, opts)
            if (snippets.length === 0) continue
            results.push({
                path: p,
                matchCount: snippets.length,
                snippets: snippets.slice(0, snippetLimit),
            })
        }
        results.sort((a, b) => b.matchCount - a.matchCount)
        return results
    }

    // Cheap pre-filter shared by tiers 1 and 2: a literal (non-regex) match implies the raw
    // query substring occurs in the body, regardless of wholeWord — so indexOf is always a
    // valid, cheaper necessary condition to check before paying for findMatches.
    const lowerQuery = query.toLowerCase()
    function literalSnippets(p: string): MatchSnippet[] {
        if (opts.caseSensitive) {
            const body = bodies.get(p) ?? ''
            if (body.indexOf(query) === -1) return []
            return findMatches(body, query, opts)
        }
        const lower = lowerBodies.get(p) ?? ''
        if (lower.indexOf(lowerQuery) === -1) return []
        return findMatches(bodies.get(p) ?? '', query, opts)
    }

    const seen = new Set<string>()
    const results: SearchResult[] = []

    // Tier 1: literal hits MiniSearch also ranked, in MiniSearch's own order.
    const miniHits = mini.search(query)
    for (const hit of miniHits) {
        const p = hit.id as string
        if (seen.has(p)) continue
        const snippets = literalSnippets(p)
        if (snippets.length === 0) continue
        seen.add(p)
        results.push({
            path: p,
            matchCount: snippets.length,
            snippets: snippets.slice(0, snippetLimit),
        })
    }

    // Tier 2: literal hits MiniSearch missed (typically mid-word), sorted by match count desc.
    const tier2: { path: string; snippets: MatchSnippet[] }[] = []
    for (const p of paths) {
        if (seen.has(p)) continue
        const snippets = literalSnippets(p)
        if (snippets.length === 0) continue
        seen.add(p)
        tier2.push({ path: p, snippets })
    }
    tier2.sort((a, b) => b.snippets.length - a.snippets.length)
    for (const t of tier2)
        results.push({
            path: t.path,
            matchCount: t.snippets.length,
            snippets: t.snippets.slice(0, snippetLimit),
        })

    // Tier 3: typo hits — only for case-insensitive search. AND-combined so a multi-word query
    // requires every word to fuzzily match.
    if (!opts.caseSensitive) {
        // A looser fuzzy fraction than the index's default (0.2): tier 3 exists specifically to
        // catch typos, so it deliberately tolerates more edit distance than everyday ranking
        // should. Still gated on term length like the default, so short terms stay exact.
        const typoHits = mini.search(query, {
            combineWith: 'AND',
            fuzzy: term => (term.length > 3 ? 0.34 : false),
        })
        for (const hit of typoHits) {
            const p = hit.id as string
            if (seen.has(p)) continue
            const body = bodies.get(p) ?? ''
            const merged: MatchSnippet[] = []
            for (const term of hit.terms)
                merged.push(
                    ...findMatches(body, term, {
                        caseSensitive: false,
                        wholeWord: true,
                        regex: false,
                    }),
                )
            if (merged.length === 0) continue // matched only in basename/headings/tags
            merged.sort(
                (a, b) => a.line - b.line || a.before.length - b.before.length,
            )
            seen.add(p)
            results.push({
                path: p,
                matchCount: merged.length,
                snippets: merged.slice(0, snippetLimit),
            })
        }
    }

    return results
}

/**
 * Rank vault notes for `query` and return the top `limit` as `{ path, body }` pairs — the SAME
 * MiniSearch ranking searchVault uses (BM25, fuzzy for longer terms, prefix, filename/heading/tag
 * boosts), but deliberately WITHOUT searchVault's post-ranking literal-snippet filter.
 *
 * searchVault drops every ranked hit whose body has no verbatim occurrence of the WHOLE query
 * string (`findMatches(...).length === 0 → continue`). For a natural-language question — "where did
 * I write about the Japan trip" — that sentence never appears literally in any note, so searchVault
 * returns [] for exactly the inputs the AI prompt-search feature targets. This accessor keeps the
 * useful tokenized/fuzzy ranking and hands the raw bodies to searchPrompt.ts, which re-derives a
 * byte-exact snippet from the real body around a model-chosen verbatim quote. Used ONLY by AI
 * prompt search; the literal /search path is unchanged.
 */
export async function rankCandidates(
    root: string,
    query: string,
    limit = 30,
): Promise<{ path: string; body: string }[]> {
    if (!query.trim()) return []
    const { mini, bodies } = await getSearchIndex(root)
    return mini
        .search(query)
        .slice(0, limit)
        .map(h => ({
            path: h.id as string,
            body: bodies.get(h.id as string) ?? '',
        }))
}
