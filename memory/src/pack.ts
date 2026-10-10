// Packing: turn ranked notes into the bounded `<bismuth-memory>` block that gets injected. The
// loop SKIPS a note that does not fit — it never ends the pass — and no note ships whole: each is
// an excerpt (header + description + its best-matching section) cut at perNoteChars.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isMemoryNoteVisibleToDaemon, noteDescription } from './graph'
import { memoryLinkIndex } from './health'
import type { MemoryNote } from './graph'
import { tokenize } from './rank'
import type { RankedNote } from './rank'
import { MEMORY_BANNER, MEMORY_BLOCK_TAG } from './recall'

export type RecallMode = 'prompt' | 'tool' | 'session-start' | 'subagent'

export type PackLimits = {
    maxNotes: number
    perNoteChars: number
    budgetChars: number
    pointers: number
    /** Lowest `RankedNote.score` that may be injected. That score is graph-size and query-length
     *  independent (roughly 0..1: the share of the query a perfect match would score, see
     *  `rankNotes`), so these values mean the same on a 5-note vault and a 500-note one. Set from
     *  `bun bench/recallEval.ts --sweep` on both eval suites: prompt/subagent keep the ranker's
     *  recall, tool is the highest value that still injects every labelled tool case. */
    minScore: number
    /** `minScore` when the semantic channel scored the request. It is stricter because with
     *  semantics in hand a real match carries a cosine lift, so a note still under this bar matched
     *  on a word or a tag, not on topic. Set from `bun bench/recallEval.ts` on the synthetic suite
     *  plus a real 135-note vault: 0.12 is the highest value keeping the synthetic recall@5 at 1.
     *  Unset = `minScore`. */
    semanticMinScore?: number
    /** Cosine below which a note gets no semantic lift in this mode (see `rankNotes`'s
     *  `semanticMinCosine`). Tool mode is stricter: mid-turn recall must not inject loose matches. */
    semanticMinCosine: number
    /** Ranker knobs for this mode's query shape (`rankNotes` opts): the weight of a context term,
     *  and a cap on the query weight a score is divided by. Tool mode sets both: a tool payload is
     *  mostly packaging around one subject, so "share of the query answered" would read every
     *  realistic payload as unanswered. Unset = the prompt-shaped defaults. */
    contextWeight?: number
    locationWeight?: number
    maxQueryWeight?: number
    /** Tool payloads: a lone body hit never qualifies a note, and a note matched only on context
     *  terms that are not in its name/tags/description needs three of them (`rankNotes`). */
    strictEvidence?: boolean
    /** Tool mode: how many tool batches may inject between two user prompts. Each batch's dedup
     *  pushes the next one down to the next-best unseen notes, so an uncapped turn of many small
     *  tool calls drips weaker and weaker matches. Unset = no cap. */
    maxBatchesPerTurn?: number
}

export const PACK_LIMITS: Record<Exclude<RecallMode, 'session-start'>, PackLimits> = {
    prompt: { maxNotes: 5, perNoteChars: 900, budgetChars: 6000, pointers: 5, minScore: 0.08, semanticMinScore: 0.12, semanticMinCosine: 0.55 },
    tool: { maxNotes: 2, perNoteChars: 600, budgetChars: 1800, pointers: 0, minScore: 0.21, semanticMinCosine: 0.65, contextWeight: 0.5, locationWeight: 0.3, maxQueryWeight: 3, strictEvidence: true, maxBatchesPerTurn: 1 },
    subagent: { maxNotes: 4, perNoteChars: 700, budgetChars: 4000, pointers: 4, minScore: 0.08, semanticMinCosine: 0.55 },
}

/** The `rankNotes` options a mode's limits imply, plus the semantic map when there is one. Core and
 *  the eval both rank through this, so a knob set here reaches both. */
export function rankOptions(
    mode: Exclude<RecallMode, 'session-start'>,
    semantic?: Map<string, number>,
): {
    semantic?: Map<string, number>
    semanticMinCosine?: number
    contextWeight?: number
    locationWeight?: number
    maxQueryWeight?: number
    strictEvidence?: boolean
} {
    const l = PACK_LIMITS[mode]
    return {
        ...(semantic ? { semantic, semanticMinCosine: l.semanticMinCosine } : {}),
        ...(l.contextWeight !== undefined ? { contextWeight: l.contextWeight } : {}),
        ...(l.locationWeight !== undefined ? { locationWeight: l.locationWeight } : {}),
        ...(l.maxQueryWeight !== undefined ? { maxQueryWeight: l.maxQueryWeight } : {}),
        ...(l.strictEvidence ? { strictEvidence: true } : {}),
    }
}

export type Packed = {
    text: string | null
    injected: { name: string; hash: string }[]
}

const SESSION_START_BUDGET = 9500
const PREFERENCE_BODY_MAX = 1200
/** All preference bodies together stay under this, so the index keeps room. */
const PREFERENCE_BODIES_BUDGET = 4000
/** Room kept for non-preference index lines when a lead is present. */
const OTHER_INDEX_RESERVE = 3000
const PREFERENCE_BODIES_FLOOR = 1500
const POINTER_DESC_MAX = 120
/** Index lines are dropped lowest-value type first. */
const INDEX_TYPE_ORDER = ['workflow', 'project', 'fact', 'person', 'daily', 'auto']

/** Stable short hash of everything recall shows from a note, so a changed note counts as new. */
export function noteHash(note: MemoryNote): string {
    const fm = note.frontmatter
    return createHash('sha1')
        .update(
            [note.name, fm.type, fm.tags.join(','), fm.description ?? '', note.content].join('\u0000'),
        )
        .digest('hex')
        .slice(0, 12)
}

/** The dedup key for `packRecall`'s `exclude`: a note is skipped when `exclude` has its bare
 *  name (always skip) or this name@hash key (skip until the content changes). */
export function excludeKey(name: string, hash: string): string {
    return `${name}@${hash}`
}

/** Keep a note's text from closing or opening the envelope early (stripInjectedBlocks keys on it). */
export function defang(text: string): string {
    return text.replace(new RegExp(`<(/?)${MEMORY_BLOCK_TAG}>`, 'g'), '[$1' + MEMORY_BLOCK_TAG + ']')
}

function cut(text: string, max: number): string {
    if (max <= 0) return ''
    if (text.length <= max) return text
    const head = text.slice(0, Math.max(0, max - 1))
    const soft = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '))
    return `${(soft > max * 0.6 ? head.slice(0, soft) : head).trimEnd()}…`
}

/** Split a body into sections: at headings, and long ones again at blank lines. */
function sections(body: string, soft: number): string[] {
    const out: string[] = []
    for (const part of body.split(/\n(?=#{1,6}\s)/)) {
        if (part.length <= soft * 2) {
            out.push(part.trim())
            continue
        }
        let acc = ''
        for (const para of part.split(/\n{2,}/)) {
            if (acc && acc.length + para.length > soft) {
                out.push(acc.trim())
                acc = ''
            }
            acc += `${acc ? '\n\n' : ''}${para}`
        }
        if (acc) out.push(acc.trim())
    }
    return out.filter(s => s && !/^#{1,6}\s[^\n]*$/.test(s))
}

function bestSection(body: string, matched: string[], soft: number): string {
    const parts = sections(body, soft)
    if (parts.length === 0) return ''
    if (matched.length === 0) return parts[0]!
    let best = parts[0]!
    let bestScore = -1
    for (const p of parts) {
        const terms = new Set(tokenize(p))
        const score = matched.filter(t => terms.has(t)).length
        if (score > bestScore) {
            best = p
            bestScore = score
        }
    }
    return best
}

function excerpt(r: RankedNote, perNoteChars: number, dir?: string): string {
    const { note } = r
    const fm = note.frontmatter
    const header = `## ${note.name} (${fm.type}) [${fm.tags.join(', ')}]`
    const path = `Path: ${dir ? join(dir, note.name) : note.name}.md`
    const desc = noteDescription(note)
    const section = bestSection(note.content, r.matched ?? [], perNoteChars)
    const lines = [header, path]
    // The fallback description is the note's own first sentence — skip it when the section opens with it.
    if (desc && !(!fm.description && section.startsWith(desc))) lines.push(desc)
    const fixed = lines.join('\n')
    const room = perNoteChars - fixed.length - 1
    return defang(cut(room > 40 ? `${fixed}\n${cut(section, room)}` : fixed, perNoteChars))
}

/** The text a note would be shown as when injected (header, description, best section), cut at
 *  `perNoteChars`: what the reranker judges, so it grades exactly what the agent would read. */
export function excerptText(r: RankedNote, perNoteChars: number): string {
    return excerpt(r, perNoteChars)
}

function envelope(parts: string[]): { open: string; close: string } {
    return {
        open: [`<${MEMORY_BLOCK_TAG}>`, MEMORY_BANNER, '', ...parts].join('\n'),
        close: `</${MEMORY_BLOCK_TAG}>`,
    }
}

export function packRecall(
    ranked: RankedNote[],
    mode: Exclude<RecallMode, 'session-start'>,
    exclude?: Set<string>,
    opts?: { dir?: string; semantic?: boolean },
): Packed {
    const limits = PACK_LIMITS[mode]
    const minScore = (opts?.semantic && limits.semanticMinScore) || limits.minScore
    const { open, close } = envelope(['# Memories', ''])
    // open + "\n" + body + close
    let remaining = limits.budgetChars - open.length - 1 - close.length
    const blocks: string[] = []
    const injected: Packed['injected'] = []
    const taken = new Set<string>()

    const isExcluded = (r: RankedNote) =>
        !!exclude &&
        (exclude.has(r.note.name) || exclude.has(excludeKey(r.note.name, noteHash(r.note))))

    for (const r of ranked) {
        if (injected.length >= limits.maxNotes) break
        if (r.score < minScore || isExcluded(r)) continue
        const text = excerpt(r, limits.perNoteChars, opts?.dir)
        // +2: the blank line after each block
        if (text.length + 2 > remaining) continue
        blocks.push(text, '')
        remaining -= text.length + 2
        injected.push({ name: r.note.name, hash: noteHash(r.note) })
        taken.add(r.note.name)
    }
    if (injected.length === 0) return { text: null, injected }

    if (limits.pointers > 0) {
        const lines: string[] = []
        for (const r of ranked) {
            if (lines.length >= limits.pointers) break
            if (r.score < minScore || taken.has(r.note.name) || isExcluded(r)) continue
            const d = cut(noteDescription(r.note), POINTER_DESC_MAX)
            lines.push(defang(`- [[${r.note.name}]] (${r.note.frontmatter.type})${d ? ` — ${d}` : ''}`))
        }
        const title = 'Also related notes (not included; read the file if needed):'
        const kept: string[] = []
        let cost = title.length + 2
        for (const l of lines) {
            if (cost + l.length + 1 > remaining) break
            kept.push(l)
            cost += l.length + 1
        }
        if (kept.length) blocks.push(title, ...kept, '')
    }

    return { text: `${open}\n${blocks.join('\n')}\n${close}`, injected }
}

function indexLine(note: MemoryNote): string {
    const d = noteDescription(note)
    return defang(`[[${note.name}]] (${note.frontmatter.type})${d ? ` — ${d}` : ''}`)
}

export type SessionStartOpts = { budgetChars?: number; lead?: string }

export const PROFILE_NOTE = 'user-profile'

const isProfileNote = (n: MemoryNote): boolean =>
    n.frontmatter.type === 'profile' || n.name === PROFILE_NOTE

/** The user-profile note's body, cut to `maxChars` at a line boundary; null when there is no
 *  profile note visible to the daemon. */
export function formatProfile(notes: MemoryNote[], maxChars: number = 1500): string | null {
    const profile = notes.find(n => isMemoryNoteVisibleToDaemon(n) && isProfileNote(n))
    const body = profile?.content.trim()
    if (!body) return null
    if (body.length <= maxChars) return defang(body)
    const kept: string[] = []
    let used = 0
    for (const line of body.split('\n')) {
        if (used + line.length + 1 > maxChars) break
        kept.push(line)
        used += line.length + 1
    }
    return defang(kept.length ? kept.join('\n').trimEnd() : cut(body, maxChars))
}

/** Rank value of a note for the index: how many other memory notes link to it. */
function inLinkCounts(notes: MemoryNote[]): Map<string, number> {
    const { inbound } = memoryLinkIndex(notes)
    return new Map([...inbound].map(([name, from]) => [name, from.size]))
}

/**
 * The always-on session-start block: a one-line index of every visible note plus the bodies of
 * short `preference` notes, at most `budgetChars` (default 9500; the hook's additionalContext cap
 * is 10,000). `opts.lead` (the profile and vault map) sits between the banner and the index and
 * counts against the budget. Every preference index line stays; the other lines are ordered by
 * value (hubs first, then in-links, recency, type) and each is kept or skipped on its own.
 */
export function formatSessionStart(notes: MemoryNote[], opts?: SessionStartOpts): string | null {
    const visible = notes.filter(isMemoryNoteVisibleToDaemon)
    if (visible.filter(n => !isProfileNote(n)).length === 0) return null
    const inLinks = inLinkCounts(visible)
    const typeRank = (t: string) => {
        const i = INDEX_TYPE_ORDER.indexOf(t)
        return i < 0 ? INDEX_TYPE_ORDER.length : i
    }
    const isHub = (n: MemoryNote) => n.frontmatter.type === 'hub'
    const byValue = (a: MemoryNote, b: MemoryNote) =>
        Number(isHub(b)) - Number(isHub(a)) ||
        (inLinks.get(b.name) ?? 0) - (inLinks.get(a.name) ?? 0) ||
        b.frontmatter.updated.localeCompare(a.frontmatter.updated) ||
        typeRank(a.frontmatter.type) - typeRank(b.frontmatter.type) ||
        a.name.localeCompare(b.name)
    const ranked = visible.filter(n => !isProfileNote(n)).sort(byValue)

    const footerReserve = 90
    const budget = opts?.budgetChars ?? SESSION_START_BUDGET
    const bare = envelope(['# Memory index', ''])
    // the lead is cut at a line boundary so envelope + lead + footer never exceed the budget
    const leadMax = budget - bare.open.length - 1 - bare.close.length - footerReserve - 2
    let lead = opts?.lead ? defang(opts.lead.trim()) : ''
    if (lead.length > leadMax) {
        const kept: string[] = []
        let used = 0
        for (const line of lead.split('\n')) {
            if (used + line.length + 1 > leadMax) break
            kept.push(line)
            used += line.length + 1
        }
        lead = kept.join('\n').trimEnd()
    }
    const { open, close } = envelope([...(lead ? [lead, ''] : []), '# Memory index', ''])
    let remaining = budget - open.length - 1 - close.length - footerReserve

    const prefs = ranked.filter(n => n.frontmatter.type === 'preference')
    const prefLines = new Map<string, string>()
    for (const n of prefs) {
        const l = indexLine(n)
        if (l.length + 1 > remaining) continue
        prefLines.set(n.name, l)
        remaining -= l.length + 1
    }

    // With a lead (profile + map) the index lines of hubs, projects, people and facts keep at
    // least this much room: preference bodies are the first thing to give way.
    const bodiesBudget = lead ? Math.min(PREFERENCE_BODIES_BUDGET, Math.max(PREFERENCE_BODIES_FLOOR, remaining - OTHER_INDEX_RESERVE)) : PREFERENCE_BODIES_BUDGET
    const bodies: string[] = []
    let bodyCost = 0
    for (const n of prefs) {
        const body = n.content.trim()
        if (!body || body.length > PREFERENCE_BODY_MAX) continue
        const block = defang(`## ${n.name}\n${body}`)
        if (bodyCost + block.length + 2 > bodiesBudget) continue
        // keep room for the section title
        if (block.length + 2 + 30 > remaining) continue
        bodies.push(block, '')
        bodyCost += block.length + 2
        remaining -= block.length + 2
        // a shown body replaces its index line
        const shown = prefLines.get(n.name)
        if (shown !== undefined) {
            prefLines.delete(n.name)
            remaining += shown.length + 1
        }
    }
    if (bodies.length) remaining -= '# Preferences'.length + 2

    const otherLines: string[] = []
    let dropped = prefs.length - prefLines.size - bodies.length / 2
    for (const n of ranked) {
        if (n.frontmatter.type === 'preference') continue
        const l = indexLine(n)
        if (l.length + 1 <= remaining) {
            otherLines.push(l)
            remaining -= l.length + 1
        } else dropped++
    }

    const out = [open.replace(/\n$/, ''), '', ...prefLines.values(), ...otherLines, '']
    if (bodies.length) out.push('# Preferences', '', ...bodies)
    if (dropped > 0) out.push(`(${dropped} more notes not listed; use the recall tool to search them)`, '')
    out.push(close)
    return out.join('\n')
}
