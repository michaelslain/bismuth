// The `history` command group: past conversations in this vault, read from the agent CLI's own
// session logs (`<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<encoded vault>/*.jsonl`). Memory holds
// facts the dream distilled; this is the record of what was actually said, by date — the answer to
// "what did we talk about yesterday". Headless — no server. Parsing lives in
// memory/src/sessionHistory.ts; this file only walks the directory.
//
// Visibility: a transcript quotes whatever the session read, with no single path to check, so the
// CLI gate (core/src/visibilityCliGate.ts) puts `history` in the refuse-when-restricted tier, as it
// does `chat`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals } from '../args'
import { realpathLoose } from '../../../core/src/realPath'
import { resolveVaultRoot } from '../../../mcp/src/memory'
import {
    budgetSessions,
    encodeProjectDir,
    RESULT_BUDGET_CHARS,
    parseSession,
    queryWords,
    todayISO,
    trimToBudget,
    turnInRange,
    turnMatches,
    type SessionRecord,
    type Turn,
} from '../../../memory/src'

const BOOLEANS = [...BOOLEAN_FLAGS, 'all']
/** Default lookback when no date flag and no `--all` is given. */
const DEFAULT_DAYS = 30
/** Per-session budget for a listing; `history show` uses the transcript module's full budget. */
const LIST_SESSION_CHARS = 4000

function vaultDir(args: string[]): string {
    const v = flag(args, 'vault')
    const vault = v ? resolve(v) : resolveVaultRoot()
    if (!vault) fail('no vault — run inside one or pass --vault <dir>')
    try {
        return realpathLoose(vault)
    } catch {
        return vault
    }
}

function sessionsDir(vault: string): string {
    const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    return join(config, 'projects', encodeProjectDir(vault))
}

/** `today`, `yesterday`, or a literal YYYY-MM-DD. */
function parseDay(value: string | undefined, name: string): string | undefined {
    if (value === undefined) return undefined
    const v = value.toLowerCase()
    if (v === 'today') return todayISO()
    if (v === 'yesterday') return todayISO(new Date(Date.now() - 86_400_000))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        fail(`--${name} takes YYYY-MM-DD, today or yesterday`)
    return value
}

function dateRange(args: string[]): { since?: string; until?: string } {
    const on = parseDay(flag(args, 'on'), 'on')
    if (on) return { since: on, until: on }
    const since = parseDay(flag(args, 'since'), 'since')
    const until = parseDay(flag(args, 'until'), 'until')
    if (since || until || bool(args, 'all')) return { since, until }
    const days = Number(flag(args, 'days') ?? DEFAULT_DAYS)
    if (!Number.isFinite(days) || days < 1) fail('--days takes a positive number')
    return { since: todayISO(new Date(Date.now() - (days - 1) * 86_400_000)) }
}

/** Local midnight of a YYYY-MM-DD, for the mtime prefilter. */
function dayStart(day: string): number {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y!, m! - 1, d!).getTime()
}

function shape(s: SessionRecord, turns: Turn[], total: number) {
    return {
        id: s.id,
        date: s.date,
        started: s.started,
        ended: s.ended,
        turnCount: total,
        turns: turns.map(t => ({ at: t.at, you: t.user, claude: t.claude })),
    }
}

export const commands: CommandMap = {
    history: {
        summary:
            'Search past conversations in this vault by date and text (what was said, not distilled memory)',
        usage: '[query…] [--on <date>|--since <date> --until <date>|--days <n>|--all] [--limit <n>] [--vault <dir>] [--pretty]',
        run: async args => {
            const words = queryWords(positionals(args, BOOLEANS).join(' '))
            const { since, until } = dateRange(args)
            const limit = Number(flag(args, 'limit') ?? 10)
            const dir = sessionsDir(vaultDir(args))
            const self = process.env.CLAUDE_CODE_SESSION_ID
            let files: { name: string; mtime: number }[] = []
            try {
                files = readdirSync(dir)
                    .filter(f => f.endsWith('.jsonl'))
                    .map(f => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
            } catch {
                out({ dir, count: 0, sessions: [] }, args)
                return
            }
            // A session last written before `since` cannot hold a turn on or after it.
            const floor = since ? dayStart(since) : 0
            files = files
                .filter(f => f.mtime >= floor)
                .sort((a, b) => b.mtime - a.mtime)
            const found: { session: SessionRecord; turns: Turn[] }[] = []
            for (const f of files) {
                if (found.length >= limit) break
                const id = f.name.slice(0, -'.jsonl'.length)
                if (id === self) continue
                const text = readFileSync(join(dir, f.name), 'utf8')
                const lower = words.length ? text.toLowerCase() : ''
                if (words.some(w => !lower.includes(w))) continue
                const s = parseSession(id, text)
                if (!s) continue
                const hits = s.turns.filter(
                    t => turnInRange(t, since, until) && turnMatches(t, words),
                )
                if (!hits.length) continue
                const turns = words.length ? hits : trimToBudget(hits, LIST_SESSION_CHARS)
                found.push({ session: s, turns })
            }
            // Most recent sessions whole, the rest as pointers, so one call fits a tool result.
            const { shown, more } = budgetSessions(found, RESULT_BUDGET_CHARS)
            out(
                {
                    dir,
                    since,
                    until,
                    count: found.length,
                    sessions: shown.map(f => shape(f.session, f.turns, f.session.turns.length)),
                    more,
                },
                args,
            )
        },
    },
    'history show': {
        summary: 'Print one past conversation in this vault, turn by turn',
        usage: '<session-id> [--vault <dir>] [--pretty]',
        run: async args => {
            const [id] = positionals(args)
            if (!id || !/^[\w-]+$/.test(id)) fail('usage: bismuth history show <session-id>')
            const file = join(sessionsDir(vaultDir(args)), `${id}.jsonl`)
            let text: string
            try {
                text = readFileSync(file, 'utf8')
            } catch {
                fail(`no session ${id} in this vault`)
            }
            const s = parseSession(id, text)
            if (!s) fail(`session ${id} has no conversation`)
            out(shape(s, trimToBudget(s.turns, RESULT_BUDGET_CHARS), s.turns.length), args)
        },
    },
}
