// Packing: turn ranked notes into the bounded `<bismuth-memory>` block that gets injected. The
// loop SKIPS a note that does not fit — it never ends the pass — and no note ships whole: each is
// an excerpt (header + description + its best-matching section) cut at perNoteChars.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isMemoryNoteVisibleToDaemon, noteDescription } from './graph'
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
}

export const PACK_LIMITS: Record<Exclude<RecallMode, 'session-start'>, PackLimits> = {
    prompt: { maxNotes: 5, perNoteChars: 900, budgetChars: 6000, pointers: 5, minScore: 0.08, semanticMinCosine: 0.55 },
    tool: { maxNotes: 2, perNoteChars: 600, budgetChars: 1800, pointers: 0, minScore: 0.21, semanticMinCosine: 0.65, contextWeight: 0.5, locationWeight: 0.3, maxQueryWeight: 3, strictEvidence: true },
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
function defang(text: string): string {
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
    opts?: { dir?: string },
): Packed {
    const limits = PACK_LIMITS[mode]
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
        if (r.score < limits.minScore || isExcluded(r)) continue
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
            if (r.score < limits.minScore || taken.has(r.note.name) || isExcluded(r)) continue
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

/**
 * The always-on session-start block: a one-line index of every visible note plus the bodies of
 * short `preference` notes, at most 9500 chars (the hook's additionalContext cap is 10,000).
 * Every preference index line stays; other index lines are dropped lowest-value type first.
 */
export function formatSessionStart(notes: MemoryNote[]): string | null {
    const visible = notes
        .filter(isMemoryNoteVisibleToDaemon)
        .sort((a, b) => b.frontmatter.updated.localeCompare(a.frontmatter.updated) || a.name.localeCompare(b.name))
    if (visible.length === 0) return null

    const { open, close } = envelope(['# Memory index', ''])
    const footerReserve = 90
    let remaining = SESSION_START_BUDGET - open.length - 1 - close.length - footerReserve

    const prefs = visible.filter(n => n.frontmatter.type === 'preference')
    const prefLines: string[] = []
    for (const n of prefs) {
        const l = indexLine(n)
        if (l.length + 1 > remaining) break
        prefLines.push(l)
        remaining -= l.length + 1
    }

    const bodies: string[] = []
    let bodyCost = 0
    for (const n of prefs) {
        const body = n.content.trim()
        if (!body || body.length > PREFERENCE_BODY_MAX) continue
        const block = defang(`## ${n.name}\n${body}`)
        if (bodyCost + block.length + 2 > PREFERENCE_BODIES_BUDGET) continue
        // keep room for the section title
        if (block.length + 2 + 30 > remaining) continue
        bodies.push(block, '')
        bodyCost += block.length + 2
        remaining -= block.length + 2
    }
    if (bodies.length) remaining -= '# Preferences'.length + 2

    const otherLines: string[] = []
    let dropped = 0
    let listing = true
    for (const type of INDEX_TYPE_ORDER) {
        for (const n of visible.filter(v => v.frontmatter.type === type)) {
            const l = indexLine(n)
            if (listing && l.length + 1 <= remaining) {
                otherLines.push(l)
                remaining -= l.length + 1
            } else {
                listing = false
                dropped++
            }
        }
    }
    // any note whose type is not in the order list and not preference
    for (const n of visible) {
        const t = n.frontmatter.type
        if (t !== 'preference' && !INDEX_TYPE_ORDER.includes(t)) dropped++
    }
    dropped += prefs.length - prefLines.length

    const out = [open.replace(/\n$/, ''), '', ...prefLines, ...otherLines, '']
    if (bodies.length) out.push('# Preferences', '', ...bodies)
    if (dropped > 0) out.push(`(${dropped} more notes not listed; use the recall tool to search them)`, '')
    out.push(close)
    return out.join('\n')
}
