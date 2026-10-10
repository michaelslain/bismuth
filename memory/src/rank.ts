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
    /** stem → the indexed terms that share it (see `stem`); the keyword-only path matches across them */
    stems: Map<string, string[]>
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

/** Keyword-only evidence rules (no semantic scores at all; tool payloads keep their own rules).
 *  Set from `bun bench/recallEval.ts --service --embeddings off` on both eval suites; the values
 *  keep recall@5 at or above where it was and the sensitivity is in the verdict file.
 *
 *  A query term also matches the other forms of its stem, at this share of an exact match. */
const STEM_FORM_WEIGHT = 0.6
/** A lone body hit's word must still be rarer than this: found in under about a tenth of the notes. */
const LONE_HIT_MIN_IDF = 0.55
/** A lone body hit counts only when the note repeats the word (or holds it alone in the vault): at
 *  least this many mentions, at least this share of the note's length ("push" eight times in a git policy note, against one
 *  "time" in a log). A word mentioned this often is the note's subject even when it is a small
 *  part of the prompt, so the coverage check above is waived. */
const LONE_HIT_MIN_MENTIONS = 2
const LONE_HIT_MIN_DENSITY = 0.004
const LONE_HIT_TOPIC_MENTIONS = 4
/** A note matched only by words from its body needs one of them to be distinctive: a normalized idf
 *  (see `rankNotes`) of at least this: a word found in a handful of notes (two or three in a vault of
 *  50 to 150), not merely uncommon. "capital", "function" and "list" name no topic. Set from the
 *  eval: 0.85 loses a real expected note. */
const DISTINCT_MIN_IDF = 0.8
/** ...unless the note holds this share of the prompt's content terms: a short prompt that a note
 *  answers almost word for word is on topic even when its words are common. */
const ANSWERED_ENOUGH = 0.75
/** Prompts of at least this many content terms are checked for how much of them the vault knows. */
const UNKNOWN_MIN_TERMS = 3
/** When at least this share of those terms appears nowhere in the vault, the prompt is about
 *  something the vault holds no memory of and a note that merely shares a word with it is
 *  coincidence. Set from the eval: no prompt with an expected note has more than a third of its terms
 *  unknown (a bare follow-up carries its topic in context terms, which exempt a note), so 0.4 sits
 *  just above that. */
const UNKNOWN_MAX_SHARE = 0.4
/** A note whose name, tags or description share this many terms with the prompt is about it,
 *  whatever else the prompt says. */
const UNKNOWN_EXEMPT_HEAD_HITS = 2

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

const STEM_SUFFIXES = ['ations', 'ation', 'ments', 'ment', 'ings', 'ing', 'ies', 'ed', 'es', 's']
const STEM_MIN = 4

/** A light suffix stripper (plural, -ing, -ed, -ation, -ment): "recommend" and "recommendations"
 *  share a stem. Deliberately conservative: the stem keeps at least STEM_MIN letters, and digit
 *  tokens (codes, dates) are left whole. Only the keyword-only path matches across a stem. */
export function stem(term: string): string {
    if (/\d/.test(term)) return term
    for (const suf of STEM_SUFFIXES) {
        if (!term.endsWith(suf) || term.length - suf.length < STEM_MIN) continue
        if (suf === 's' && /(?:ss|us|is)$/.test(term)) return term
        const base = term.slice(0, -suf.length)
        return suf === 'ies' ? `${base}y` : dropFinalE(base)
    }
    return dropFinalE(term)
}

/** -e words share a stem with their inflections: "update" with "updated", "image" with "images". */
const dropFinalE = (word: string) => (word.length > STEM_MIN && word.endsWith('e') ? word.slice(0, -1) : word)

/** The names of the keyword-only evidence rules, as the eval's --explain prints them. */
export const RULE = {
    loneCoverage: 'lone-hit rule: one body word under 0.4 of the prompt',
    loneMention: 'lone-hit rule: one passing mention of the word',
    loneCommon: 'lone-hit rule: the word is found in many notes',
    unknownPrompt: 'unknown-prompt gate: most of the prompt is unknown to the vault',
    severalCommon: 'several-body-hits rule: no distinctive word among them',
    severalApart: 'several-body-hits rule: the words are not together in one paragraph',
    head: 'name/tags/description hit',
    loneAdmitted: 'lone-hit rule: a repeated body word',
    phrase: 'phrase exemption: two distinctive words side by side in the prompt and the note',
    severalAdmitted: 'several-body-hits rule: a distinctive word, together in a paragraph',
    other: 'body words (no rule dropped it)',
} as const

/** Unordered key for a pair of terms. */
const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`)

/** The pairs of content terms that sit next to each other (stop words dropped, either order). */
function adjacentPairs(tokens: string[]): Set<string> {
    const pairs = new Set<string>()
    for (let k = 1; k < tokens.length; k++) if (tokens[k] !== tokens[k - 1]) pairs.add(pairKey(tokens[k - 1]!, tokens[k]!))
    return pairs
}

/** Per note, the adjacent term pairs of its body, never across a paragraph break: its phrases. */
const phraseCache = new WeakMap<MemoryNote, { content: string; pairs: Set<string> }>()
function phrasePairs(note: MemoryNote): Set<string> {
    const hit = phraseCache.get(note)
    if (hit && hit.content === note.content) return hit.pairs
    const pairs = new Set<string>()
    for (const p of note.content.split(/\n{2,}|\n(?=#{1,6}\s)/)) for (const k of adjacentPairs(tokenize(p))) pairs.add(k)
    phraseCache.set(note, { content: note.content, pairs })
    return pairs
}

/** Per note, the term set of each paragraph (blank-line or heading split): what "found together" means. */
const windowCache = new WeakMap<MemoryNote, { content: string; windows: Set<string>[] }>()
function paragraphTerms(note: MemoryNote): Set<string>[] {
    const hit = windowCache.get(note)
    if (hit && hit.content === note.content) return hit.windows
    const windows = note.content.split(/\n{2,}|\n(?=#{1,6}\s)/).map(p => new Set(tokenize(p)))
    windowCache.set(note, { content: note.content, windows })
    return windows
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
    const stems = new Map<string, string[]>()
    for (const term of postings.keys()) {
        const k = stem(term)
        const forms = stems.get(k)
        if (forms) forms.push(term)
        else stems.set(k, [term])
    }
    return { notes, postings, heads, lengths, avgLength: avgLength || 1, stems }
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
        /** Filled with, per note name, the keyword-only rule that dropped or admitted it (the eval's
         *  --explain reads it). Never changes the ranking. */
        trace?: Map<string, string>
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
    // Keyword-only (no semantic scores at all): a query term also matches the other forms of its
    // stem, and the evidence rules below read the matched QUERY terms and their rarity. Tool
    // payloads (strictEvidence) have their own rules and stay exact.
    const keywordOnly = !(opts.semantic && opts.semantic.size > 0) && !opts.strictEvidence
    const primaryTerms = new Set(tokenize(query.primary))
    for (const t of primaryTerms) locationTerms.delete(t)
    // Keyword-only: query terms that share a stem are ONE term for every evidence rule below
    // ("capital capitals" is one content term, and a note holding only "capital" is a lone hit).
    const unitOf = (t: string) => (keywordOnly ? stem(t) : t)
    const primaryUnits = new Set([...primaryTerms].map(unitOf))
    const lexical = new Map<number, number>()
    const matched = new Map<number, string[]>()
    /** per doc: the query terms that hit it and how rare each hit term is (its own form's idf) */
    const matchedQuery = new Map<number, string[]>()
    const matchedIdf = new Map<number, number[]>()
    const knownTerms = new Set<string>()
    /** keyword-only, per doc: the stems of the query terms already counted as a hit */
    const unitsHit = new Map<number, Set<string>>()
    const idfOfDf = (df: number) => Math.log(1 + (n - df + 0.5) / (df + 0.5)) / maxIdf
    for (const [term, qw] of weights) {
        // doc → the best-scoring form of this term in it: the term itself at full weight, other
        // forms of its stem (keyword-only) at STEM_FORM_WEIGHT, each form on its own idf
        const best = new Map<number, { s: number; form: string; idf: number }>()
        const forms = [term]
        if (keywordOnly) for (const f of index.stems.get(stem(term)) ?? []) if (f !== term) forms.push(f)
        for (const form of forms) {
            const docs = index.postings.get(form)
            if (!docs) continue
            // "the vault holds this word": the word itself, or an inflection that is a topic of some note
            // (a name, tag or description). A body-only inflection ("configuration" for "configure")
            // would let every ordinary verb make a foreign prompt look known.
            if (form === term || [...docs.keys()].some(d => index.heads[d]!.has(form))) knownTerms.add(term)
            const idf = idfOfDf(docs.size)
            const w = form === term ? 1 : STEM_FORM_WEIGHT
            for (const [doc, tf] of docs) {
                const norm = 1 - B + (B * index.lengths[doc]!) / index.avgLength
                const s = (w * idf * qw * tf) / (tf + K1 * norm) / queryWeight
                const cur = best.get(doc)
                if (!cur || s > cur.s) best.set(doc, { s, form, idf })
            }
        }
        for (const [doc, b] of best) {
            lexical.set(doc, (lexical.get(doc) ?? 0) + b.s)
            if (keywordOnly) {
                const seen = unitsHit.get(doc)
                if (seen?.has(unitOf(term))) continue
                if (seen) seen.add(unitOf(term))
                else unitsHit.set(doc, new Set([unitOf(term)]))
            }
            const m = matched.get(doc)
            if (m) m.push(b.form)
            else matched.set(doc, [b.form])
            if (keywordOnly) {
                const mq = matchedQuery.get(doc)
                if (mq) mq.push(term)
                else matchedQuery.set(doc, [term])
                const mi = matchedIdf.get(doc)
                if (mi) mi.push(b.idf)
                else matchedIdf.set(doc, [b.idf])
            }
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
    // Keyword-only: when much of what the prompt says appears nowhere in the vault, it is about
    // something the vault holds no memory of, and one overlapping word is coincidence. A note that
    // matched a context term is exempt: a bare "yes go ahead" is carried by its context.
    const unknownShare = primaryUnits.size
        ? [...primaryUnits].filter(u => ![...primaryTerms].some(t => unitOf(t) === u && knownTerms.has(t))).length / primaryUnits.size
        : 0
    const unknownGate = keywordOnly && n >= SMALL_VAULT && primaryUnits.size >= UNKNOWN_MIN_TERMS && unknownShare >= UNKNOWN_MAX_SHARE
    // ...unless the note holds a phrase of the prompt: two distinctive words next to each other in
    // the prompt and next to each other in the note ("tauri updater" in "fix the tauri updater retry
    // logic in ci"). A small vault lacks everyday verbs, so an ordinary prompt crosses the unknown
    // share easily; a shared phrase is a topic, while two words that merely both occur in the note
    // ("write" and "email" in a long log) are still coincidence.
    const queryPairs = unknownGate ? adjacentPairs(tokenize(query.primary)) : new Set<string>()
    const sharesPhrase = (i: number, note: MemoryNote): boolean => {
        const terms = matchedQuery.get(i)!
        const forms = matched.get(i)!
        const idfs = matchedIdf.get(i)!
        for (let a = 0; a < terms.length; a++)
            for (let b = a + 1; b < terms.length; b++)
                if (
                    idfs[a]! >= DISTINCT_MIN_IDF &&
                    idfs[b]! >= DISTINCT_MIN_IDF &&
                    queryPairs.has(pairKey(terms[a]!, terms[b]!)) &&
                    phrasePairs(note).has(pairKey(forms[a]!, forms[b]!))
                )
                    return true
        return false
    }
    const docs = new Set([...lexical.keys(), ...semanticBonus.keys()])
    const ranked: RankedNote[] = []
    for (const i of docs) {
        const note = index.notes[i]!
        const lex = lexical.get(i) ?? 0
        const prior = TYPE_PRIOR[note.frontmatter.type] ?? 1
        const sem = cosine.get(i)
        const hits = matched.get(i) ?? []
        const headHits = hits.filter(t => index.heads[i]!.has(t)).length
        if (opts.strictEvidence && n >= SMALL_VAULT && hits.length === 1 && !index.heads[i]!.has(hits[0]!))
            continue
        if (n >= SMALL_VAULT && sem === undefined && hits.length === 1 && !index.heads[i]!.has(hits[0]!)) {
            // the QUERY term that hit (keyword-only may have hit through another form of its stem)
            const queryTerm = keywordOnly ? matchedQuery.get(i)![0]! : hits[0]!
            const coverage = primaryUnits.size ? (primaryTerms.has(queryTerm) ? 1 : 0) / primaryUnits.size : 0
            const mentions = index.postings.get(hits[0]!)?.get(i) ?? 0
            if (coverage < LONE_HIT_MIN_COVERAGE && !(keywordOnly && mentions >= LONE_HIT_TOPIC_MENTIONS)) {
                opts.trace?.set(note.name, RULE.loneCoverage)
                continue
            }
            // keyword-only: one passing mention in a log is not a note about the word, unless no
            // other note has the word at all
            const soleHolder = index.postings.get(hits[0]!)?.size === 1
            if (keywordOnly && ((!soleHolder && mentions < LONE_HIT_MIN_MENTIONS) || mentions / index.lengths[i]! < LONE_HIT_MIN_DENSITY)) {
                opts.trace?.set(note.name, RULE.loneMention)
                continue
            }
            // keyword-only: a word found in many notes ("capital") names no topic
            if (keywordOnly && matchedIdf.get(i)![0]! < LONE_HIT_MIN_IDF) {
                opts.trace?.set(note.name, RULE.loneCommon)
                continue
            }
        }
        if (
            unknownGate &&
            matchedQuery.get(i)!.every(t => primaryTerms.has(t)) &&
            headHits < UNKNOWN_EXEMPT_HEAD_HITS &&
            !sharesPhrase(i, note)
        ) {
            opts.trace?.set(note.name, RULE.unknownPrompt)
            continue
        }
        // Several body-only words count as a topic only when two of them sit together in one
        // paragraph (common words scatter across a long note by chance; a note about the subject
        // keeps them side by side) and one of them is distinctive.
        if (keywordOnly && n >= SMALL_VAULT && hits.length > 1 && headHits === 0) {
            const answered = primaryUnits.size ? matchedQuery.get(i)!.filter(t => primaryTerms.has(t)).length / primaryUnits.size : 0
            if (answered < ANSWERED_ENOUGH && Math.max(...matchedIdf.get(i)!) < DISTINCT_MIN_IDF) {
                opts.trace?.set(note.name, RULE.severalCommon)
                continue
            }
            if (!paragraphTerms(note).some(w => hits.filter(t => w.has(t)).length >= 2)) {
                opts.trace?.set(note.name, RULE.severalApart)
                continue
            }
        }
        if (opts.trace && keywordOnly) {
            const sole = hits.length === 1 && headHits === 0
            const phrase = unknownGate && headHits < UNKNOWN_EXEMPT_HEAD_HITS && matchedQuery.get(i)!.every(t => primaryTerms.has(t))
            opts.trace.set(
                note.name,
                headHits > 0 ? RULE.head : sole ? RULE.loneAdmitted : phrase ? RULE.phrase : hits.length > 1 ? RULE.severalAdmitted : RULE.other,
            )
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
