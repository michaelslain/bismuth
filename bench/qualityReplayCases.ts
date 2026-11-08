// Pure half of the quality replay (bench/qualityReplay.ts): which prompts qualify, which sources each arm is
// shown, which tool calls the replayed agent may make, and the paired statistics and the junk cost that come
// out of the verdicts. No model; the path checks resolve symlinks, so they read the file system.
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { packSources } from '../core/src/sourcePack'
import type { SourceHit } from '../core/src/semanticSources'
import { bootstrapInterval, intervalOf } from './gateEval'

// ---- which prompts qualify ---------------------------------------------------------------------

export type ToolUse = { name: string; input: Record<string, unknown> }

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task'])
/** A shell command that changes something: removal, moves, redirects into a file, in-place edits, git writes,
 *  package installs, kills, and the `bismuth` verbs that write. */
const DESTRUCTIVE_BASH =
    /(^|[\s;&|(])(rm|rmdir|mv|cp|touch|mkdir|chmod|chown|ln|kill|pkill|tee|dd|truncate|install)\s|>\s*[^\s&|]|\bsed\s+-[a-z]*i|\bgit\s+(add|commit|push|checkout|reset|rebase|merge|stash|clean|restore|rm|mv|branch\s+-[dD]|tag)\b|\b(npm|bun|pnpm|yarn|pip|brew)\s+(install|add|remove|uninstall|i)\b|\bbismuth\s+(note\s+(new|write|append|move|delete)|prop\s+set|task\s+(add|set|done|toggle)|base\s+(create|migrate)|write|append|move|delete|backup|app)\b/
/** An MCP tool whose name says it writes. */
const WRITE_MCP = /(create|write|set_|_set|edit|delete|remove|move|rename|append|update|send|post|press|run_|trash|restore)/i

/** Why a tool call makes its turn a non-lookup turn, or null when it only reads. */
export function mutationReason(t: ToolUse): string | null {
    if (WRITE_TOOLS.has(t.name)) return `${t.name}`
    if (t.name === 'Bash') {
        const cmd = typeof t.input.command === 'string' ? t.input.command : ''
        // redirects that discard output or land in scratch space change nothing worth keeping
        const plain = cmd.replace(/\d?>>?\s*&?\d\b/g, ' ').replace(/\d?>>?\s*(\/dev\/null|\/tmp\/\S*|\/private\/tmp\/\S*|"?\$\{?TMPDIR\}?\S*)/g, ' ')
        return DESTRUCTIVE_BASH.test(plain) ? 'destructive Bash' : null
    }
    if (t.name.endsWith('bismuth_cli')) {
        const words = Object.values(t.input).flatMap(v => (Array.isArray(v) ? v : [v])).filter(v => typeof v === 'string').join(' ')
        return DESTRUCTIVE_BASH.test(`bismuth ${words}`) ? 'destructive bismuth_cli' : null
    }
    if (t.name.startsWith('mcp__') && WRITE_MCP.test(t.name.slice(t.name.lastIndexOf('__') + 2))) return `mcp write (${t.name})`
    return null
}

/** The tool calls an assistant made in the log lines [from, to), sidechains skipped. */
export function toolUsesBetween(lines: string[], from: number, to: number): ToolUse[] {
    const out: ToolUse[] = []
    for (let i = from; i < Math.min(to, lines.length); i++) {
        const l = lines[i]
        if (!l || !l.includes('"tool_use"')) continue
        try {
            const e = JSON.parse(l) as { type?: string; isSidechain?: boolean; message?: { content?: unknown } }
            if (e.isSidechain || e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
            for (const b of e.message!.content as { type?: string; name?: string; input?: Record<string, unknown> }[])
                if (b?.type === 'tool_use' && b.name) out.push({ name: b.name, input: b.input ?? {} })
        } catch {}
    }
    return out
}

export type CaseDrop = 'writes' | 'no-log' | 'empty-prompt' | 'command'

/** Keep a prompt whose turn only read (a question or lookup); name why not otherwise. */
export function lookupVerdict(prompt: string, uses: ToolUse[] | null): { keep: true } | { keep: false; why: CaseDrop; detail: string } {
    if (uses === null) return { keep: false, why: 'no-log', detail: 'session log is gone' }
    if (!prompt.trim()) return { keep: false, why: 'empty-prompt', detail: '' }
    if (/^\s*\//.test(prompt)) return { keep: false, why: 'command', detail: 'slash command' }
    for (const u of uses) {
        const r = mutationReason(u)
        if (r) return { keep: false, why: 'writes', detail: r }
    }
    return { keep: true }
}

/** A stable order for picking cases: by sha1 of the case id, so a pilot of the first n is a prefix of the full sweep. */
export const hashOrder = (ids: number[]): number[] =>
    [...ids].sort((a, b) => hashOf(`case|${a}`).localeCompare(hashOf(`case|${b}`)))

export const hashOf = (s: string): string => new Bun.CryptoHasher('sha1').update(s).digest('hex')

// ---- arms --------------------------------------------------------------------------------------

export type Cand = { key: string; kind: 'file' | 'chat' | 'docs'; cosine: number; text: string; y: 0 | 1 | null; matched: boolean; accepted: boolean }

/** The keys the shipped gate injects (already pack-capped), best cosine first. */
export const gateKeys = (cands: Cand[]): string[] => cands.filter(c => c.accepted).sort((a, b) => b.cosine - a.cosine).map(c => c.key)

/** The keys of the junk arm: `k` candidates judged irrelevant that no fetch matched. The gate's own junk goes
 *  first, then the highest-cosine irrelevant candidates (the near misses a gate loosened to this degree would
 *  let through). Fewer irrelevant candidates than `k` = all of them. */
export function junkKeys(cands: Cand[], k: number): string[] {
    const irrelevant = cands.filter(c => c.y === 0 && !c.matched)
    const own = irrelevant.filter(c => c.accepted).sort((a, b) => b.cosine - a.cosine)
    const rest = irrelevant.filter(c => !c.accepted).sort((a, b) => b.cosine - a.cosine)
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of [...own, ...rest]) {
        if (out.length >= k) break
        if (seen.has(c.key)) continue
        seen.add(c.key)
        out.push(c.key)
    }
    return out
}

/** The k a junk arm uses when the gate injected nothing for a case: the mean the gate injects where it fires, rounded up to a whole item. */
export const meanFired = (counts: number[]): number => {
    const fired = counts.filter(n => n > 0)
    return fired.length ? Math.max(1, Math.round(fired.reduce((a, b) => a + b, 0) / fired.length)) : 1
}

/** The recall sources block for a set of candidates, rendered as `packSources` renders it (so the agent sees what a hook would add). */
export function sourcesBlock(items: { cand: Cand; date?: string }[], vaultCopy: string): string | null {
    const hits: SourceHit[] = items.map(({ cand, date }) => {
        const i = cand.key.indexOf(':')
        const prefix = cand.key.slice(0, i)
        const id = cand.key.slice(i + 1)
        const nl = cand.text.indexOf('\n')
        const title = nl > 0 ? cand.text.slice(0, nl) : cand.text
        const titled = prefix === 'docs' || prefix === 'note'
        return {
            kind: (prefix === 'note' || prefix === 'pdf' || prefix === 'image' || prefix === 'chat' || prefix === 'docs' ? prefix : 'note') as SourceHit['kind'],
            id,
            score: cand.cosine,
            excerpt: titled && nl > 0 ? cand.text.slice(nl + 1) : cand.text,
            ...(titled ? { title } : {}),
            ...(prefix === 'chat' && date ? { date } : {}),
        }
    })
    return packSources(hits, 'prompt', 1_000_000, vaultCopy).text
}

// ---- what the replayed agent may call ----------------------------------------------------------

const SHELL_META = /[;&|<>`$()\\\n\r{}]/
/** What the shell would still act on in a quoted string: expansion (`$`, backtick, backslash) and line breaks. A pipe, `&` or
 *  parenthesis inside quotes is plain text, which a regex search needs (`"a|b"`). */
const QUOTED_ACTIVE = /[`$\\\n\r]/
/** The command with its inert quoted strings removed, or null when a quoted string holds something the shell would act on. */
const withoutQuotes = (c: string): string | null => {
    const quoted = c.match(/'[^']*'|"[^"]*"/g) ?? []
    if (quoted.some(q => q.startsWith('"') && QUOTED_ACTIVE.test(q))) return null
    return c.replace(/'[^']*'|"[^"]*"/g, '""')
}

/** Whether a Bash command is one read-only `bismuth` call. No chaining, redirects or substitution, no `--vault`
 *  (it would point the call at another vault), and no argument that names a path outside the working directory. */
export function bismuthAllowed(command: string): { ok: true } | { ok: false; why: string } {
    const c = command.trim()
    const bare = withoutQuotes(c)
    if (bare === null || SHELL_META.test(bare)) return { ok: false, why: 'shell metacharacters are not allowed' }
    const words = c.split(/\s+/)
    if (words[0] !== 'bismuth') return { ok: false, why: 'only `bismuth` commands run' }
    if (words.some(w => w === '--vault' || w.startsWith('--vault='))) return { ok: false, why: '--vault is not allowed' }
    if (words.slice(1).some(w => /^["']?(\/|~)/.test(w) || /(^|\/)\.\.(\/|["']?$)/.test(w))) return { ok: false, why: 'paths outside the vault are not allowed' }
    const [a, b] = [words[1] ?? '', words[2] ?? '']
    if (['read', 'map', 'brain', 'highlights'].includes(a)) return { ok: true }
    if (a === 'docs' && ['list', 'read', 'search'].includes(b)) return { ok: true }
    if (a === 'task' && b === 'list') return { ok: true }
    if (a === 'history' && b !== 'delete') return { ok: true }
    if (a === 'base' && ['read', 'render'].includes(b)) return { ok: true }
    if (a === 'calendar' && ['day', 'range', 'list', 'search', 'get', 'overlaps', 'bases', 'categories'].includes(b)) return { ok: true }
    if (a === 'card' && ['decks', 'all', 'note', 'due'].includes(b)) return { ok: true }
    if (a === 'search') return words.includes('--regex') ? { ok: true } : { ok: false, why: '`bismuth search` needs --regex (keyword only; the meaning index is not built here)' }
    return { ok: false, why: `\`bismuth ${a}${b ? ` ${b}` : ''}\` is not a read command in this run` }
}

/** The real path of `p`: itself when it exists, else its nearest existing ancestor's real path plus the rest. */
const realish = (p: string): string => {
    const parts: string[] = []
    let cur = resolve(p)
    while (!existsSync(cur) && dirname(cur) !== cur) {
        parts.unshift(basename(cur))
        cur = dirname(cur)
    }
    return resolve(realpathSync(cur), ...parts)
}

/** Whether a path the agent names lies inside `root` (relative paths resolve against it). Symlinks are resolved
 *  on both sides, so a link inside the clone that leads out of it does not pass. */
export function insideRoot(root: string, p: string): boolean {
    const r = realish(root)
    const abs = realish(isAbsolute(p) ? p : resolve(root, p))
    const rel = relative(r, abs)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Whether a Glob pattern or Grep glob stays relative to the search directory: no absolute path, no `~`, no `..`. */
export const globPatternOk = (pattern: string): boolean => !/^(\/|~)/.test(pattern) && !/[{,][\/~]/.test(pattern) && !/(^|[\/{,])\.\.([\/},]|$)/.test(pattern)

/** What the replayed (or judging) agent may call: the one policy behind both the PreToolUse hook and `canUseTool`.
 *  `bash` false removes Bash (the judge). */
export function toolPolicy(root: string, name: string, input: Record<string, unknown>, bash = true): { ok: true } | { ok: false; why: string } {
    if (name === 'Bash') return bash ? bismuthAllowed(String(input.command ?? '')) : { ok: false, why: 'this tool is not available' }
    if (name !== 'Read' && name !== 'Grep' && name !== 'Glob') return { ok: false, why: 'this tool is not available' }
    const p = input.file_path ?? input.path
    if (p !== undefined && !insideRoot(root, String(p))) return { ok: false, why: 'paths outside the vault are not readable' }
    const pattern = name === 'Glob' ? input.pattern : input.glob
    if (typeof pattern === 'string' && !globPatternOk(pattern)) return { ok: false, why: 'absolute or .. patterns are not allowed' }
    return { ok: true }
}

/** A PreToolUse hook callback enforcing `toolPolicy`. A hook fires for every call, including the read-only shell
 *  commands the permission system approves without asking `canUseTool`. `onDeny` records each refusal. */
export const policyHook = (root: string, onDeny: (name: string, input: Record<string, unknown>, why: string) => void, bash = true) =>
    async (hookInput: { tool_name?: string; tool_input?: unknown }) => {
        const name = String(hookInput.tool_name ?? '')
        const input = (hookInput.tool_input ?? {}) as Record<string, unknown>
        const v = toolPolicy(root, name, input, bash)
        if (v.ok) return { continue: true }
        onDeny(name, input, v.why)
        return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: v.why } }
    }

// ---- statistics --------------------------------------------------------------------------------

export type Outcome = 'win' | 'tie' | 'loss'

/** One case's comparison of an arm against `none`. Deltas are arm minus none. */
export type PairRow = {
    caseId: number
    session: string
    outcome: Outcome
    /** Items the arm injected. */
    items: number
    dTokens: number
    dTokensAll: number
    dToolCalls: number
    dTurns: number
    /** The arm's answer relies on an item the judge marked irrelevant. */
    misled: boolean
    /** gate arm: an injected item counts as a hit (a fetched label matched it; a past-chat or time case: the judge says relevant). */
    hit?: boolean
    /** Injected items the judge marked irrelevant. */
    junkItems?: number
}

type Unit = { n: number; win: number; tie: number; loss: number; items: number; dTokens: number; dTokensAll: number; dToolCalls: number; dTurns: number; misled: number }

const unitsBySession = (rows: PairRow[]): Unit[] => {
    const m = new Map<string, Unit>()
    for (const r of rows) {
        const u = m.get(r.session) ?? { n: 0, win: 0, tie: 0, loss: 0, items: 0, dTokens: 0, dTokensAll: 0, dToolCalls: 0, dTurns: 0, misled: 0 }
        u.n++
        u[r.outcome]++
        u.items += r.items
        u.dTokens += r.dTokens
        u.dTokensAll += r.dTokensAll
        u.dToolCalls += r.dToolCalls
        u.dTurns += r.dTurns
        u.misled += r.misled ? 1 : 0
        m.set(r.session, u)
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(e => e[1])
}

const sum = (us: Unit[], f: (u: Unit) => number) => us.reduce((a, u) => a + f(u), 0)
const ratio = (num: number, den: number) => (den ? num / den : 0)

/** Draws for a paired bootstrap over `n` session units. */
export type Draws = number[][]

/** Per-case rates and mean deltas with 95% bootstrap intervals, resampling sessions (a session's prompts share context). */
export function summarizePairs(rows: PairRow[], draws: (n: number) => Draws) {
    const us = unitsBySession(rows)
    const d = draws(us.length)
    const stat = (f: (s: Unit[]) => number) => bootstrapInterval(us, f, d)
    const per = (f: (u: Unit) => number) => (s: Unit[]) => ratio(sum(s, f), sum(s, u => u.n))
    return {
        cases: rows.length,
        sessions: us.length,
        win: stat(per(u => u.win)),
        tie: stat(per(u => u.tie)),
        loss: stat(per(u => u.loss)),
        net: stat(s => ratio(sum(s, u => u.win - u.loss), sum(s, u => u.n))),
        meanDTokens: stat(per(u => u.dTokens)),
        meanDTokensAll: stat(per(u => u.dTokensAll)),
        meanDToolCalls: stat(per(u => u.dToolCalls)),
        meanDTurns: stat(per(u => u.dTurns)),
        misledRate: stat(per(u => u.misled)),
        itemsPerCase: ratio(sum(us, u => u.items), rows.length),
    }
}

// ---- the junk cost -----------------------------------------------------------------------------

export type JunkCostInputs = {
    /** Tokens one injected item costs on its own (the exchange rate's measured item). */
    directTokens: number
    /** Tokens one corrective turn costs (the exchange rate's mean output per assistant turn). */
    turnTokens: number
    /** Tokens one saved fetch is worth (the exchange rate's fetch total). */
    fetchTokens: number
}

/** The cost of one junk item in tokens, from the junk-vs-none comparison, with every input shown:
 *    direct  the item's own tokens (measured by the exchange rate);
 *    extra   what it made the agent spend beyond that: (sum of token deltas - items x direct) / items;
 *    loss    net answers made worse, as corrective turns: (losses - wins) / items x turnTokens;
 *  cost = direct + extra + loss, with an interval from resampling sessions. */
export function junkCost(rows: PairRow[], inp: JunkCostInputs, draws: (n: number) => Draws) {
    const us = unitsBySession(rows)
    const d = draws(us.length)
    const comp = (s: Unit[]) => {
        const items = sum(s, u => u.items)
        const extra = items ? (sum(s, u => u.dTokens) - items * inp.directTokens) / items : 0
        const loss = items ? (sum(s, u => u.loss - u.win) / items) * inp.turnTokens : 0
        return { extra, loss, cost: inp.directTokens + extra + loss }
    }
    const point = comp(us)
    const iv = (f: (c: ReturnType<typeof comp>) => number) => intervalOf(d.map(dr => f(comp(dr.map(i => us[i]!)))))
    const lambdaOf = (cost: number) => (cost > 0 ? inp.fetchTokens / cost : Number.NaN)
    return {
        ...inp,
        items: sum(us, u => u.items),
        extraTokensPerItem: { point: point.extra, ...iv(c => c.extra) },
        lossTokensPerItem: { point: point.loss, ...iv(c => c.loss) },
        costTokensPerItem: { point: point.cost, ...iv(c => c.cost) },
        lambda: lambdaOf(point.cost),
        lambdaAtCostInterval: { atLo: lambdaOf(iv(c => c.cost).lo), atHi: lambdaOf(iv(c => c.cost).hi) },
    }
}


/** What a hit saves, in tokens, from the gate-vs-none rows of cases the gate hit in:
 *    tokens   what the agent no longer spends, `-dTokens`, with the cost of the case's junk items added back
 *             (the objective charges each junk item on its own, so a case's saving is read net of them);
 *    quality  net answers made better, as corrective turns: (wins - losses) x turnTokens.
 *  saved = tokens + quality, per hit case, with intervals from resampling sessions. */
export function savedPerHit(rows: PairRow[], inp: { junkTokensPerItem: number; turnTokens: number }, draws: (n: number) => Draws) {
    const hits = rows.filter(r => r.hit)
    const by = new Map<string, { n: number; tokens: number; quality: number }>()
    for (const r of hits) {
        const u = by.get(r.session) ?? { n: 0, tokens: 0, quality: 0 }
        u.n++
        u.tokens += -r.dTokens + (r.junkItems ?? 0) * inp.junkTokensPerItem
        u.quality += (r.outcome === 'win' ? 1 : r.outcome === 'loss' ? -1 : 0) * inp.turnTokens
        by.set(r.session, u)
    }
    const us = [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(e => e[1])
    const d = draws(us.length)
    const iv = (f: (u: { n: number; tokens: number; quality: number }) => number) => ({ point: ratio(us.reduce((a, u) => a + f(u), 0), hits.length), ...bootstrapInterval(us, s => ratio(s.reduce((a, u) => a + f(u), 0), s.reduce((a, u) => a + u.n, 0)), d) })
    return { hitCases: hits.length, ...inp, tokens: iv(u => u.tokens), quality: iv(u => u.quality), saved: iv(u => u.tokens + u.quality) }
}

/** Whether an interval is not below another: neither of its ends sits under the other's. */
export const intervalNotBelow = (a: { lo: number; hi: number }, b: { lo: number; hi: number }): boolean => a.lo >= b.lo && a.hi >= b.hi

// ---- parsing the judges' replies --------------------------------------------------------------

/** The first JSON object in a model reply, or null. */
export function jsonIn(text: string): Record<string, unknown> | null {
    const a = text.indexOf('{')
    const b = text.lastIndexOf('}')
    if (a < 0 || b <= a) return null
    try {
        const v = JSON.parse(text.slice(a, b + 1))
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
    } catch {
        return null
    }
}

/** A pairwise reply as the verdict for the shown side: 'A', 'B' or 'tie' plus its sentence. */
export function parsePairwise(text: string): { better: 'A' | 'B' | 'tie'; reason: string } | null {
    const j = jsonIn(text)
    const b = String(j?.better ?? '').trim()
    const better = b.toUpperCase() === 'A' ? 'A' : b.toUpperCase() === 'B' ? 'B' : b.toLowerCase() === 'tie' ? 'tie' : null
    return better ? { better, reason: String(j?.reason ?? '').slice(0, 400) } : null
}

/** Which side holds the arm, decided by a hash of the case and comparison, so the order is random but reproducible. */
export const armIsA = (caseId: number, comparison: string): boolean => parseInt(hashOf(`order|${caseId}|${comparison}`).slice(0, 2), 16) % 2 === 0

/** The arm's outcome against `none` given which side was which. */
export function outcomeOf(better: 'A' | 'B' | 'tie', armIsSideA: boolean): Outcome {
    if (better === 'tie') return 'tie'
    return (better === 'A') === armIsSideA ? 'win' : 'loss'
}

/** The sessions whose logs `bismuth history show` may open in the replay: train and validation. Test sessions hold the answers. */
export const historySessions = (split: { train: Set<string>; validation: Set<string> }, ids: string[]): string[] =>
    ids.filter(id => split.train.has(id) || split.validation.has(id))

/** The kept model when no refit was made: the current model scored at the old rate, never shipped, so `--write` writes the current weights. `refit` wins when it exists. */
export function keepModel<R extends { current: R['shippedRow']; ship: boolean; shipped: unknown; shippedRow: unknown }>(refit: R | null, atOldRate: () => R, model: R['shipped']): R {
    if (refit) return refit
    const base = atOldRate()
    return { ...base, ship: false, shipped: model, shippedRow: base.current }
}
