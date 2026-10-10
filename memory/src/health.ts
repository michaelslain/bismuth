// Brain health: structural checks over the memory graph (oversized, orphaned, duplicated, unlinked
// notes and the like) rendered as a numbered agenda for the dream cron. Pure: no fs, no clock
// unless `now` is omitted.
import type { MemoryNote } from './graph'

export type BrainHealthItem = { kind: 'oversized' | 'dated-name' | 'cluster' | 'orphan' | 'no-source' | 'status-lines' | 'dated-tags' | 'duplicate' | 'broken-link' | 'no-profile' | 'no-hub' | 'no-description'; notes: string[]; detail: string }
export type BrainHealth = { notes: number; bytes: number; items: BrainHealthItem[] }

const OVERSIZED_CHARS = 2000
const STATUS_LINES_MIN = 3
const STATUS_AGE_DAYS = 14
const DUPLICATE_JACCARD = 0.6
const HUB_GROUP_MIN = 4
const LIST_CAP = 10

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const STATUS_SUFFIXES = ['final', 'checkpoint', 'update', 'snapshot', 'status', 'latest', 'escalation', 'today']
const DATED_TAGS = new Set(['latest', 'status', 'current'])

const monthIndex = (word: string): number => {
    const w = word.toLowerCase()
    const full = MONTHS.indexOf(w)
    if (full >= 0) return full
    return MONTH_ABBR.indexOf(w === 'sept' ? 'sep' : w)
}

/** Lowercase link target with alias, heading and `.md` removed. */
function linkKey(target: string): string {
    return target.split('|')[0]!.split('#')[0]!.replace(/\.md$/i, '').trim().toLowerCase()
}

const baseOf = (name: string): string => name.slice(name.lastIndexOf('/') + 1)

/** For each note, the memory notes its `[[links]]` resolve to (folder-agnostic, never itself) and
 *  the targets that resolve to no memory note. */
export function memoryLinkIndex(notes: MemoryNote[]): {
    out: Map<string, Set<string>>
    inbound: Map<string, Set<string>>
    unresolved: Map<string, string[]>
} {
    const byKey = new Map<string, string>()
    for (const n of notes) byKey.set(n.name.toLowerCase(), n.name)
    for (const n of notes) {
        const b = baseOf(n.name).toLowerCase()
        if (!byKey.has(b)) byKey.set(b, n.name)
    }
    const out = new Map<string, Set<string>>()
    const inbound = new Map<string, Set<string>>()
    const unresolved = new Map<string, string[]>()
    for (const n of notes) {
        out.set(n.name, new Set())
        inbound.set(n.name, new Set())
        unresolved.set(n.name, [])
    }
    for (const n of notes) {
        for (const raw of n.backlinks) {
            const key = linkKey(raw)
            if (!key) continue
            const hit = byKey.get(key) ?? byKey.get(baseOf(key))
            if (hit === undefined) unresolved.get(n.name)!.push(key)
            else if (hit !== n.name) {
                out.get(n.name)!.add(hit)
                inbound.get(hit)!.add(n.name)
            }
        }
    }
    return { out, inbound, unresolved }
}

const nameTokens = (name: string): string[] =>
    baseOf(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

const isMonthToken = (t: string): boolean => monthIndex(t) >= 0
const isDateToken = (t: string): boolean => /^\d{4,8}$/.test(t) || /^\d{1,2}$/.test(t)

function datedName(name: string): boolean {
    const base = baseOf(name).toLowerCase()
    if (/\d{4}-\d{2}(-\d{2})?|\d{8}/.test(base)) return true
    const tokens = nameTokens(name)
    if (tokens.some(isMonthToken)) return true
    return tokens.length > 1 && STATUS_SUFFIXES.includes(tokens[tokens.length - 1]!)
}

/** The name with dates, months and status words removed: notes sharing one are a cluster. */
function stem(name: string): string {
    return nameTokens(name)
        .filter(t => !isMonthToken(t) && !isDateToken(t) && !STATUS_SUFFIXES.includes(t))
        .join('-')
}

function isProfile(n: MemoryNote): boolean {
    return n.frontmatter.type === 'profile' || n.name === 'user-profile'
}
const isHub = (n: MemoryNote): boolean => n.frontmatter.type === 'hub'

const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i

/** The date a line carries, or null. A month-day without a year is read as the most recent such day. */
function lineDate(line: string, now: Date): Date | null {
    const m = DATE_RE.exec(line)
    if (!m) return null
    if (m[1]) return new Date(Date.UTC(+m[1], +m[2]! - 1, +m[3]!))
    const month = monthIndex(m[4]!)
    const day = +m[5]!
    if (m[6]) return new Date(Date.UTC(+m[6], month, day))
    let d = new Date(Date.UTC(now.getUTCFullYear(), month, day))
    if (d.getTime() > now.getTime() + 30 * 86400000) d = new Date(Date.UTC(now.getUTCFullYear() - 1, month, day))
    return d
}

/** Lines with an explicit old date, outside a `History` section. */
function oldDatedLines(content: string, now: Date): { count: number; oldest: Date | null } {
    let count = 0
    let oldest: Date | null = null
    let historyLevel = 0
    const cutoff = now.getTime() - STATUS_AGE_DAYS * 86400000
    for (const line of content.split('\n')) {
        const h = /^(#{1,6})\s+(.*)$/.exec(line)
        if (h) {
            const level = h[1]!.length
            if (historyLevel && level <= historyLevel) historyLevel = 0
            if (!historyLevel && /^history\b/i.test(h[2]!.trim())) historyLevel = level
            continue
        }
        if (historyLevel) continue
        const d = lineDate(line, now)
        if (d && d.getTime() < cutoff) {
            count++
            if (!oldest || d < oldest) oldest = d
        }
    }
    return { count, oldest }
}

function datedTags(tags: string[]): string[] {
    return tags.filter(t => {
        const tag = t.toLowerCase()
        if (DATED_TAGS.has(tag)) return true
        const parts = tag.split(/[-_\s]+/)
        return parts.some(p => isMonthToken(p) || /^\d{4}$/.test(p))
    })
}

const wordSet = (n: MemoryNote): Set<string> =>
    new Set(
        `${baseOf(n.name)} ${n.frontmatter.description ?? ''}`
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(t => t.length >= 3),
    )

const kb = (chars: number): string => `${(chars / 1024).toFixed(1)}KB`
const cap = (names: string[]): string[] => names.slice(0, LIST_CAP)

// Worst first: a bigger weight sorts earlier; `magnitude` breaks ties within a kind.
const WEIGHT: Record<BrainHealthItem['kind'], number> = {
    'no-profile': 11,
    'status-lines': 10,
    oversized: 9,
    'dated-tags': 8,
    duplicate: 7,
    cluster: 6,
    'broken-link': 5,
    'no-hub': 4,
    'dated-name': 3,
    'no-source': 2,
    orphan: 1,
    'no-description': 0,
}

/** Transcript queue notes (`auto-*`): dream forgets them in Step 4, so no check applies to them. */
const isAutoNote = (n: MemoryNote): boolean => n.frontmatter.type === 'auto' || n.name.startsWith('auto-')

/** A fact taken from a transcript carries `(session YYYY-MM-DD)` instead of a vault link. */
const SESSION_SOURCE_RE = /\(session \d{4}-\d{2}-\d{2}\)/

export function brainHealth(allNotes: MemoryNote[], opts?: { vaultNames?: Set<string>; now?: Date }): BrainHealth {
    const now = opts?.now ?? new Date()
    const notes = allNotes.filter(n => !isAutoNote(n))
    const enc = new TextEncoder()
    const bytes = allNotes.reduce((s, n) => s + enc.encode(n.content).length, 0)
    const found: { item: BrainHealthItem; magnitude: number }[] = []
    const add = (item: BrainHealthItem, magnitude: number) => found.push({ item, magnitude })
    const byName = [...notes].sort((a, b) => a.name.localeCompare(b.name))

    // oversized
    const big = byName.filter(n => !isHub(n) && n.content.length > OVERSIZED_CHARS).sort((a, b) => b.content.length - a.content.length || a.name.localeCompare(b.name))
    if (big.length)
        add({ kind: 'oversized', notes: cap(big.map(n => n.name)), detail: `body over ${OVERSIZED_CHARS} chars (largest ${kb(big[0]!.content.length)}); split into focused notes or cut it down` }, big[0]!.content.length)

    // status-lines
    const status = byName
        .map(n => ({ n, ...oldDatedLines(n.content, now) }))
        .filter(s => s.count >= STATUS_LINES_MIN)
        .sort((a, b) => b.count - a.count || a.n.name.localeCompare(b.n.name))
    if (status.length)
        add({ kind: 'status-lines', notes: cap(status.map(s => s.n.name)), detail: `${status[0]!.count}+ dated lines older than ${STATUS_AGE_DAYS} days (most in ${status[0]!.n.name}); keep the durable fact, move the log to a History section or drop it` }, status[0]!.count)

    // dated-tags
    const tagged = byName.map(n => ({ n, tags: datedTags(n.frontmatter.tags) })).filter(t => t.tags.length)
    if (tagged.length)
        add({ kind: 'dated-tags', notes: cap(tagged.map(t => t.n.name)), detail: `time-bound tags (${[...new Set(tagged.flatMap(t => t.tags))].slice(0, 5).join(', ')}) go stale; drop them` }, tagged.length)

    // dated-name
    const dated = byName.filter(n => datedName(n.name))
    if (dated.length)
        add({ kind: 'dated-name', notes: cap(dated.map(n => n.name)), detail: 'name carries a date or status word; rename to the durable subject' }, dated.length)

    // cluster
    const stems = new Map<string, string[]>()
    for (const n of byName) {
        const s = stem(n.name)
        if (s) stems.set(s, [...(stems.get(s) ?? []), n.name])
    }
    const clusterStems = new Set<string>()
    for (const [s, names] of [...stems].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
        if (names.length < 2) continue
        clusterStems.add(s)
        add({ kind: 'cluster', notes: cap(names), detail: `${names.length} notes repeat the stem "${s}" once dates and status words are stripped; merge them into one` }, names.length)
    }

    // duplicate
    const sets = byName.map(n => ({ n, w: wordSet(n) }))
    for (let i = 0; i < sets.length; i++)
        for (let j = i + 1; j < sets.length; j++) {
            const a = sets[i]!.w
            const b = sets[j]!.w
            let shared = 0
            for (const t of a) if (b.has(t)) shared++
            const union = a.size + b.size - shared
            if (union < 3) continue
            const jac = shared / union
            if (jac >= DUPLICATE_JACCARD)
                add({ kind: 'duplicate', notes: [sets[i]!.n.name, sets[j]!.n.name], detail: `name and description overlap ${Math.round(jac * 100)}%; merge or sharpen each description` }, jac)
        }

    // links
    const { out, inbound, unresolved } = memoryLinkIndex(notes)
    const orphans = byName.filter(n => out.get(n.name)!.size === 0 && inbound.get(n.name)!.size === 0)
    if (orphans.length)
        add({ kind: 'orphan', notes: cap(orphans.map(n => n.name)), detail: 'no wikilink in or out; link each to the notes it relates to' }, orphans.length)

    const vault = opts?.vaultNames
    if (vault) {
        const vaultKeys = new Set([...vault].map(v => baseOf(linkKey(v))))
        const inVault = (key: string) => vaultKeys.has(key) || vaultKeys.has(baseOf(key))
        const noSource = byName.filter(n => !isProfile(n) && !isHub(n) && !SESSION_SOURCE_RE.test(n.content) && !n.backlinks.some(l => inVault(linkKey(l))))
        if (noSource.length)
            add({ kind: 'no-source', notes: cap(noSource.map(n => n.name)), detail: 'links to no vault note; add [[links]] to the notes it was learned from' }, noSource.length)
        const broken = byName
            .map(n => ({ n, bad: [...new Set(unresolved.get(n.name)!.filter(k => !inVault(k)))] }))
            .filter(b => b.bad.length)
            .sort((a, b) => b.bad.length - a.bad.length || a.n.name.localeCompare(b.n.name))
        if (broken.length)
            add({ kind: 'broken-link', notes: cap(broken.map(b => b.n.name)), detail: `links resolve to nothing (e.g. [[${broken[0]!.bad[0]}]] in ${broken[0]!.n.name}); fix or remove` }, broken.length)
    }

    // no-description: the session-start index shows only this line
    const undescribed = byName.filter(n => !isProfile(n) && !n.frontmatter.description?.trim())
    if (undescribed.length)
        add({ kind: 'no-description', notes: cap(undescribed.map(n => n.name)), detail: `${undescribed.length} notes have no frontmatter description; add a one-line description saying when the note matters (the session index shows only that line)` }, undescribed.length)

    // profile + hub
    if (!notes.some(isProfile))
        add({ kind: 'no-profile', notes: [], detail: 'no user-profile note; write one short note of who the user is and how they work' }, 1)
    const hubs = notes.filter(isHub)
    const groups = new Map<string, string[]>()
    for (const n of byName) {
        if (isHub(n)) continue
        for (const t of n.frontmatter.tags) {
            const tag = t.toLowerCase()
            if (!DATED_TAGS.has(tag) && datedTags([tag]).length === 0) groups.set(`tag ${tag}`, [...(groups.get(`tag ${tag}`) ?? []), n.name])
        }
    }
    for (const [s, names] of stems) if (names.length >= HUB_GROUP_MIN) groups.set(`stem ${s}`, names)
    for (const [label, names] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
        if (names.length < HUB_GROUP_MIN) continue
        const covered = hubs.some(h => names.filter(m => out.get(h.name)!.has(m)).length * 2 >= names.length)
        if (!covered)
            add({ kind: 'no-hub', notes: cap(names), detail: `${names.length} notes share ${label} and no hub note links them; add a hub note` }, names.length)
    }

    found.sort((a, b) => WEIGHT[b.item.kind] - WEIGHT[a.item.kind] || b.magnitude - a.magnitude || (a.item.notes[0] ?? '').localeCompare(b.item.notes[0] ?? ''))
    return { notes: allNotes.length, bytes, items: found.map(f => f.item) }
}

export function formatBrainHealth(h: BrainHealth, maxChars: number = 3000): string {
    const header = `notes=${h.notes} size=${(h.bytes / 1024).toFixed(1)}KB`
    if (h.items.length === 0) return `${header}\nno issues found`.slice(0, maxChars)
    const total = h.items.length
    const render = (budget: number): { lines: string[]; shown: number } => {
        const lines: string[] = [header]
        let used = header.length
        let shown = 0
        for (const item of h.items) {
            const names = item.notes.length ? `${item.notes.join(', ')} — ` : ''
            const line = `${shown + 1}. ${item.kind}: ${names}${item.detail}`
            if (used + line.length + 1 > budget) continue
            lines.push(line)
            used += line.length + 1
            shown++
        }
        return { lines, shown }
    }
    const all = render(maxChars)
    if (all.shown === total) return all.lines.join('\n')
    // Something is omitted: reserve room for the tail so it can never be the part that vanishes.
    const reserve = `(${total} more not shown)`.length + 1
    const { lines, shown } = render(maxChars - reserve)
    lines.push(`(${total - shown} more not shown)`)
    return lines.join('\n')
}
