// BM25 ranking over the memory graph. Pure: no I/O, no model. A semantic channel (cosine scores
// computed elsewhere — core owns the embedder) enters as an optional `semantic` map.
import type { MemoryNote } from './graph'

export const STOP_WORDS = new Set([
    'the',
    'is',
    'a',
    'an',
    'it',
    'to',
    'for',
    'of',
    'in',
    'on',
    'and',
    'or',
    'but',
    'with',
    'that',
    'this',
    'from',
    'what',
    'how',
    'why',
    'when',
    'where',
    'who',
    'can',
    'do',
    'does',
    'did',
    'will',
    'would',
    'should',
    'could',
    'have',
    'has',
    'had',
    'be',
    'been',
    'was',
    'were',
    'are',
    'am',
    'not',
    'no',
    'my',
    'your',
    'i',
    'me',
    'we',
    'you',
    'he',
    'she',
    'they',
    'them',
    'its',
    'their',
    'our',
    'just',
    'also',
    'about',
    'up',
    'out',
    'so',
    'if',
    'at',
    'by',
    'let',
    'all',
    'any',
    'some',
    'very',
    'too',
    'more',
    'than',
    'then',
    'into',
    'over',
    'such',
    'after',
    'before',
    'between',
    'each',
    'few',
    'both',
    'other',
    'own',
    'same',
    'here',
    'there',
    'now',
    'only',
    'even',
    'still',
    'already',
    'well',
    'much',
    'many',
    'most',
    'often',
    'never',
    'always',
    'yet',
    'which',
    'whose',
    'whom',
    'these',
    'those',
    'off',
])

export type RecallIndex = {
    notes: MemoryNote[]
    /** term → (doc index → field-weighted term frequency) */
    postings: Map<string, Map<number, number>>
    /** per doc: the terms of its name, tags and description — a hit there means the note is about it */
    heads: Set<string>[]
    /** field-weighted length per doc */
    lengths: number[]
    avgLength: number
}

export type RankedNote = {
    note: MemoryNote
    /** Graph-size independent, roughly 0..1: the lexical coverage below, plus the semantic bonus,
     *  times the type prior. `PACK_LIMITS[mode].minScore` is on this scale. */
    score: number
    /** Share of the query a perfect match would score (see `rankNotes`), before bonus and prior.
     *  0 for a note that only the semantic channel surfaced. */
    lexical: number
    semantic?: number
    /** Query terms that hit this note (post-tokenize), for picking the best-matching section. */
    matched?: string[]
}

const K1 = 1.2
const B = 0.75
/** Field weights: a hit in the name or a tag says more than one in the body. */
const FIELD_WEIGHT = { name: 3, tags: 3, description: 2, body: 1 }
/** Context terms count for less than the prompt's own. */
const CONTEXT_WEIGHT = 0.35
/** Semantic candidates considered, and the lexical-scale bonus a rank-1 semantic hit earns. */
const SEMANTIC_TOP = 10
const SEMANTIC_BONUS = 0.5
export const SEMANTIC_MIN_COSINE = 0.55 // tuned by the eval
/** bge-small cosines sit in a narrow band, so on a topical vault a query the vault knows nothing
 *  about still finds ten notes above the fixed floor (all ~0.60). The tenth-best cosine is this
 *  query's background level (core hands over exactly the top ten, the eval every note); a note earns a lift only when it clears that by this margin.
 *  Measured on a real 135-note vault: unmatched prompts top out within ~0.04 to ~0.07 of their own
 *  tenth cosine, matched ones clear it by 0.08 to 0.3. */
export const SEMANTIC_BACKGROUND_MARGIN = 0.07
const DEFAULT_LIMIT = 20
/** Lone-hit skepticism: a note whose only evidence is ONE query term found in its body (not its
 *  name, tags or description) is dropped unless that term is at least this share of the prompt's
 *  own content terms. "write a haiku about rain" hitting one body mention of "write" is junk;
 *  "what should i cook tonight" hitting "cook" is not. Set from the eval: any value in
 *  (1/3, 1/2] separates those two on both suites, and this one is the middle. */
const LONE_HIT_MIN_COVERAGE = 0.4
/** Strict evidence (tool payloads): a note whose matches name neither what the call was about (a
 *  primary term) nor the note's own subject (its name, tags or description) needs at least this many
 *  distinct matched terms, and location terms (where the file lives, which program ran) are never
 *  evidence on their own. A component file's "number" and "class" landing in a seminar note is
 *  coincidence; three shared terms are a topic. */
const STRICT_BROAD_HITS = 3
/** Below this many notes the vault is too small for term statistics to say anything about a
 *  lone hit, so the skepticism is off and a small vault is never silenced by it. */
const SMALL_VAULT = 12

/** Mild prior on note type: preferences and workflows are likelier to matter than a daily log. */
const TYPE_PRIOR: Record<string, number> = {
    preference: 1.1,
    workflow: 1.05,
    project: 1.03,
    fact: 1,
    person: 1,
    daily: 0.85,
    auto: 0.75,
}

/** Lowercased terms: splits on whitespace, punctuation, `- _ /` and camelCase; keeps digit-bearing
 *  tokens (`207b`); drops stopwords and tokens under 2 chars. */
export function tokenize(text: string): string[] {
    return text
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9\u00c0-\uffff]+/)
        .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
}

function addField(
    tf: Map<string, number>,
    tokens: string[],
    weight: number,
): number {
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + weight)
    return tokens.length * weight
}

export function buildRecallIndex(notes: MemoryNote[]): RecallIndex {
    const postings = new Map<string, Map<number, number>>()
    const lengths: number[] = []
    const heads: Set<string>[] = []
    notes.forEach((note, i) => {
        const tf = new Map<string, number>()
        let len = 0
        const nameTerms = tokenize(note.name)
        const tagTerms = tokenize(note.frontmatter.tags.join(' '))
        const descTerms = tokenize(note.frontmatter.description ?? '')
        heads.push(new Set([...nameTerms, ...tagTerms, ...descTerms]))
        len += addField(tf, nameTerms, FIELD_WEIGHT.name)
        len += addField(tf, tagTerms, FIELD_WEIGHT.tags)
        len += addField(tf, descTerms, FIELD_WEIGHT.description)
        len += addField(tf, tokenize(note.content), FIELD_WEIGHT.body)
        lengths.push(len)
        for (const [term, f] of tf) {
            let docs = postings.get(term)
            if (!docs) {
                docs = new Map()
                postings.set(term, docs)
            }
            docs.set(i, f)
        }
    })
    const avgLength = lengths.length
        ? lengths.reduce((a, b) => a + b, 0) / lengths.length
        : 1
    return { notes, postings, heads, lengths, avgLength: avgLength || 1 }
}

/**
 * BM25 with two changes that make the score mean the same thing on any graph and any query.
 * Each term's idf is divided by the largest idf this graph can give (a term found in one note), so
 * a term scores 0..1 by rarity instead of growing with log(graph size); and a note's summed score
 * is divided by the total query weight (floored at 1) with BM25's saturation numerator dropped
 * (a term's tf factor tops out at 1), so it reads as "how much of the query this note answers" and long prompts or tool calls are not
 * inflated. Terms the graph has never seen still count toward the query weight: a prompt that is
 * mostly about things the vault does not contain scores low.
 */
export function rankNotes(
    index: RecallIndex,
    query: { primary: string; context?: string; location?: string },
    opts: {
        semantic?: Map<string, number>
        limit?: number
        semanticMinCosine?: number
        /** Weight of a context-only term (default CONTEXT_WEIGHT). */
        contextWeight?: number
        /** Cap on the query weight a score is divided by (see `PackLimits.maxQueryWeight`). */
        maxQueryWeight?: number
        /** Weight of a location-only term (default: the context weight). */
        locationWeight?: number
        /** Tool-payload evidence rule (see `PackLimits.strictEvidence`). */
        strictEvidence?: boolean
    } = {},
): RankedNote[] {
    const weights = new Map<string, number>()
    const contextWeight = opts.contextWeight ?? CONTEXT_WEIGHT
    const locationTerms = new Set(tokenize(query.location ?? ''))
    for (const t of locationTerms) weights.set(t, opts.locationWeight ?? contextWeight)
    for (const t of tokenize(query.context ?? '')) {
        weights.set(t, contextWeight)
        locationTerms.delete(t)
    }
    for (const t of tokenize(query.primary)) weights.set(t, 1)

    const n = index.notes.length
    const maxIdf = Math.log(1 + (n - 1 + 0.5) / 1.5)
    const queryWeight = Math.max(
        1,
        Math.min(opts.maxQueryWeight ?? Infinity, [...weights.values()].reduce((a, b) => a + b, 0)),
    )
    const primaryTerms = new Set(tokenize(query.primary))
    for (const t of primaryTerms) locationTerms.delete(t)
    const lexical = new Map<number, number>()
    const matched = new Map<number, string[]>()
    for (const [term, qw] of weights) {
        const docs = index.postings.get(term)
        if (!docs) continue
        const idf = Math.log(1 + (n - docs.size + 0.5) / (docs.size + 0.5)) / maxIdf
        for (const [doc, tf] of docs) {
            const norm = 1 - B + (B * index.lengths[doc]!) / index.avgLength
            const s = (idf * qw * tf) / (tf + K1 * norm) / queryWeight
            lexical.set(doc, (lexical.get(doc) ?? 0) + s)
            const m = matched.get(doc)
            if (m) m.push(term)
            else matched.set(doc, [term])
        }
    }

    // Semantic: the top cosines, by rank, add a bonus on the lexical scale (RRF's 1/(60+rank) shape,
    // scaled so a rank-1 hit is worth SEMANTIC_BONUS). Kept additive rather than a pure RRF so the
    // fused score stays on the same 0..1 scale as the lexical coverage PACK_LIMITS' minScore reads.
    const semanticBonus = new Map<number, number>()
    const cosine = new Map<number, number>()
    let floor = opts.semanticMinCosine ?? SEMANTIC_MIN_COSINE
    if (opts.semantic && opts.semantic.size >= SEMANTIC_TOP)
        floor = Math.max(
            floor,
            [...opts.semantic.values()].sort((a, b) => b - a)[SEMANTIC_TOP - 1]! +
                SEMANTIC_BACKGROUND_MARGIN,
        )
    if (opts.semantic && opts.semantic.size > 0) {
        const byName = new Map(index.notes.map((note, i) => [note.name, i]))
        const top = [...opts.semantic]
            .filter(([name, c]) => c >= floor && byName.has(name))
            .sort((a, b) => b[1] - a[1])
            .slice(0, SEMANTIC_TOP)
        top.forEach(([name, c], rank) => {
            const i = byName.get(name)!
            cosine.set(i, c)
            semanticBonus.set(
                i,
                ((SEMANTIC_BONUS * 61) / (60 + rank + 1)) * ((c - floor) / (1 - floor)),
            )
        })
    }

    // With a full semantic map in hand, body-only lexical evidence must be seconded by meaning: a
    // note none of whose names, tags or description the query touched, and that the embedder does
    // not place above this query's background, matched on words, not on topic ("notes", "ai",
    // "marked" in a course log for "which notes are marked off limits to ai").
    const semanticVouches =
        !opts.strictEvidence && !!opts.semantic && opts.semantic.size >= SEMANTIC_TOP && n >= SMALL_VAULT
    const docs = new Set([...lexical.keys(), ...semanticBonus.keys()])
    const ranked: RankedNote[] = []
    for (const i of docs) {
        const note = index.notes[i]!
        const lex = lexical.get(i) ?? 0
        const prior = TYPE_PRIOR[note.frontmatter.type] ?? 1
        const sem = cosine.get(i)
        const hits = matched.get(i) ?? []
        if (opts.strictEvidence && n >= SMALL_VAULT && hits.length === 1 && !index.heads[i]!.has(hits[0]!))
            continue
        if (n >= SMALL_VAULT && sem === undefined && hits.length === 1 && !index.heads[i]!.has(hits[0]!)) {
            const coverage = primaryTerms.size ? (primaryTerms.has(hits[0]!) ? 1 : 0) / primaryTerms.size : 0
            if (coverage < LONE_HIT_MIN_COVERAGE) continue
        }
        if (semanticVouches && !semanticBonus.has(i) && !hits.some(t => index.heads[i]!.has(t)))
            continue
        // Strict mode applies to semantic hits too: a cosine is a bonus on lexical evidence there,
        // never a reason on its own.
        if (opts.strictEvidence && n >= SMALL_VAULT) {
            const content = hits.filter(t => !locationTerms.has(t))
            if (
                content.length === 0 ||
                (content.length < STRICT_BROAD_HITS &&
                    !content.some(t => primaryTerms.has(t) || index.heads[i]!.has(t)))
            )
                continue
        }
        ranked.push({
            note,
            lexical: lex,
            score: (lex + (semanticBonus.get(i) ?? 0)) * prior,
            ...(sem !== undefined ? { semantic: sem } : {}),
            ...(matched.has(i) ? { matched: matched.get(i)! } : {}),
        })
    }
    ranked.sort((a, b) => b.score - a.score || a.note.name.localeCompare(b.note.name))
    return ranked.slice(0, opts.limit ?? DEFAULT_LIMIT)
}
