// memory/src/sessionHistory.ts
// Pure logic behind `bismuth history`: the raw conversation record for a vault. Memory holds
// distilled FACTS (the dream folds each `auto-*` transcript note into canonical notes and deletes
// it), so "what did we talk about yesterday" has no answer in the graph. The full record is the
// agent CLI's own session log: Claude Code writes every session started in the vault (in-app chat
// and terminal tabs alike) to `<config>/projects/<encoded cwd>/<session-id>.jsonl`. This module
// parses one of those files into dated turns and matches a query against them; the CLI command does
// the directory walk.
import { extractTurns, trimToBudget, CRON_PREFIX, type TranscriptEntry, type Turn } from './transcript'
import { todayISO } from './dates'

/** Claude Code's project-dir name for a cwd: every character that is not a letter or digit
 *  becomes `-` (`/Users/m/My Vault` → `-Users-m-My-Vault`). */
export function encodeProjectDir(cwd: string): string {
    return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export interface SessionRecord {
    id: string
    /** Local date (YYYY-MM-DD) of the first prompt. */
    date: string
    /** ISO time of the first and last prompt. */
    started?: string
    ended?: string
    turns: Turn[]
}

/** Parse one JSONL session log. Subagent (sidechain) entries and unparseable lines are skipped.
 *  Returns null for a cron-fired session or one with no real prompt. */
export function parseSession(id: string, jsonl: string): SessionRecord | null {
    const entries: TranscriptEntry[] = []
    for (const line of jsonl.split('\n')) {
        if (!line) continue
        let d: TranscriptEntry & { isSidechain?: boolean }
        try {
            d = JSON.parse(line)
        } catch {
            continue
        }
        if (d.isSidechain) continue
        if (d.type === 'user' || d.type === 'assistant') entries.push(d)
    }
    const turns = extractTurns(entries).filter(t => t.user || t.claude)
    if (!turns.some(t => t.user)) return null
    if (turns.some(t => t.user.startsWith(CRON_PREFIX))) return null
    const stamped = turns.filter(t => t.at)
    const started = stamped[0]?.at
    return {
        id,
        date: started ? todayISO(new Date(started)) : '',
        started,
        ended: stamped[stamped.length - 1]?.at,
        turns,
    }
}

/** Lowercased words of a query; a turn matches when every word appears in its prompt or reply. */
export function queryWords(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(Boolean)
}

export function turnMatches(turn: Turn, words: string[]): boolean {
    if (!words.length) return true
    const hay = `${turn.user}\n${turn.claude}`.toLowerCase()
    return words.every(w => hay.includes(w))
}

/** Whether any turn of a session falls on a local date inside [since, until] (inclusive,
 *  YYYY-MM-DD; either bound optional). */
export function turnInRange(turn: Turn, since?: string, until?: string): boolean {
    if (!since && !until) return true
    if (!turn.at) return false
    const day = todayISO(new Date(turn.at))
    return (!since || day >= since) && (!until || day <= until)
}

export interface SessionPointer {
    id: string
    date: string
    turnCount: number
    /** How many of its turns matched the query and date range. */
    matched: number
    /** The session's first prompt, cut short. */
    opening: string
}

/** Printed size: JSON escaping (newlines, quotes) and the field names count against the budget. */
const turnsSize = (turns: Turn[]) =>
    turns.reduce((n, t) => n + JSON.stringify({ at: t.at, you: t.user, claude: t.claude }).length, 0)

/** Sessions in the order given (most recent first) keep their turns until the character budget is
 *  spent; every later session becomes a pointer, opened with `history show <id>`. The first session
 *  is always shown, trimmed to the budget when it alone exceeds it. */
export function budgetSessions(
    found: { session: SessionRecord; turns: Turn[] }[],
    budget: number,
): { shown: { session: SessionRecord; turns: Turn[] }[]; more: SessionPointer[] } {
    const shown: { session: SessionRecord; turns: Turn[] }[] = []
    const more: SessionPointer[] = []
    let used = 0
    for (const f of found) {
        const size = turnsSize(f.turns)
        if (!shown.length) {
            const turns = size > budget ? trimToBudget(f.turns, budget) : f.turns
            shown.push({ session: f.session, turns })
            used = Math.min(size, budget)
        } else if (!more.length && used + size <= budget) {
            shown.push(f)
            used += size
        } else {
            more.push({
                id: f.session.id,
                date: f.session.date,
                turnCount: f.session.turns.length,
                matched: f.turns.length,
                opening: (f.session.turns.find(t => t.user)?.user ?? '').slice(0, 120),
            })
        }
    }
    return { shown, more }
}
