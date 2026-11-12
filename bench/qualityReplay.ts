// Quality replay: does what recall injects make the agent's answer better or worse?
//   bun bench/qualityReplay.ts --vault <dir> --from <replay dir> --judged <candidates-judged.jsonl> --logs <claude project dir>
//       --exchange <exchange-rate.json> --out <dir> [--target 200] [--samples 2] [--pilot n] [--dry] [--concurrency n] [--search-slots n]
//       [--agent-model m] [--judge-model m] [--reliance-model m] [--write core/src/sourceGateModel.json]
// Cases are the question/lookup prompts (the agent's turn after them only read) of every session with a log, kept
// when the replay labelled them (`labelled`, `past`, `time`; `quiet` is excluded). `pickRoundRobin` takes `--target` of
// them, one per session before any second one. Test-split sessions are `heldOut`: the gate was not fit on them. Every
// case runs five arms, K samples each, on a copy of the vault, from the conversation the prompt had:
//   none        no sources block              references  the sources the shipped gate injects, rendered as references
//   excerpts    the same items with their text  junk        irrelevant items (the gate's own junk first), as references
//   search      no block, SEARCH_FIRST appended to the system prompt
// Every arm has the same tools: blended `bismuth search` (the meaning index is built once on the copy, under --out, never in
// the real cache) and `bismuth history`, which sees only the sessions that started before the case's prompt. Each arm's sample i
// is judged against none's sample i in both orders (the judge is not told the arm); the two verdicts merge, and a pair whose
// orders disagree is a tie. The control is none#i against none#K+i, from K more none runs per case. Reliance verdicts name the items a block-arm answer used.
// The junk-vs-none cost of an item refits the gate's exchange rate (bench/fitSourceGate.ts refitOnJunkCost) from the
// held-out references and junk rows of sample 1. Every run and verdict is cached under --out, keyed by what it was given, so
// a rerun resumes. `--pilot n` runs the first n chosen cases (a prefix of the full sweep) and writes pilot-usage.json.
// Search stays honest under the sweep's concurrency: one `bismuth search` is a whole process holding about 2 GB (it scans the vault and loads the
// model itself) under a 20 s budget, so the case wrappers gate the commands that embed through `--search-slots` slots sized from the machine, every
// index (vault, chats, docs) is built once before any agent runs, and each case's search is run and checked before its agents start: a case whose
// search stays keyword-only is dropped and counted, never run with worse tools. Each run records how many of its searches fell back to keywords.
// The vault copy is a clone made under --out and removed at the end; the vault and the logs are only read. The copy is
// today's vault, so an older prompt can see notes written after it, equally in every arm. Outputs hold your prompts: keep
// --out out of the repo.
import { spawn } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { cpus, homedir, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { readEmbeddingsEnabledSync } from '../core/src/embeddingsSetting'
import { gateAccepts, loadGateModel, type GateModel } from '../core/src/sourceGate'
import { encodeProjectDir } from '../memory/src/sessionHistory'
import { extractText, stripInjectedBlocks } from '../memory/src/transcript'
import { parseReplaySession, judgePoolSize } from './recallReplayCases'
import { parseNeedles, type Needle } from './needleCases'
import { refitOnJunkCost, shippedFitOn, type CandRow } from './fitSourceGate'
import { sessionStart } from './gateAB'
import { bootstrapDraws, injectedBy, splitSessions, type CaseInfo, type EvalRow } from './gateEval'
import { labelOfJudged } from './fitSourceGate'
import {
    gateKeys,
    hashOf,
    policyHook,
    toolPolicy,
    junkCost,
    junkKeys,
    excerptsBlock,
    historyVisible,
    mergeOrders,
    netIntervals,
    openedReferences,
    pickRoundRobin,
    SEARCH_FIRST,
    keepModel,
    lookupVerdict,
    meanFired,
    parsePairwise,
    jsonIn,
    savedPerHit,
    sourcesBlock,
    summarizePairs,
    toolUsesBetween,
    type Cand,
    type EvalCase,
    type Outcome,
    type PairRow,
    type PromptNet,
    type RealArm,
    type Verdict,
} from './qualityReplayCases'

/** Claude's side is Haiku only (the user's ruling); each role takes a flag. */
export const DEFAULT_MODEL = 'claude-haiku-5-5'
export const AGENT_MODEL = DEFAULT_MODEL
export const PAIRWISE_MODEL = DEFAULT_MODEL
export const RELIANCE_MODEL = DEFAULT_MODEL
const AGENT_MAX_TURNS = 30
const AGENT_TIMEOUT_MS = 10 * 60_000

export const AGENT_SYSTEM = [
    "You are the assistant in the user's Bismuth vault: a folder of markdown notes, PDFs and images, with a `bismuth` command line.",
    'Answer the user\'s latest message. Your tools are read-only: Read, Grep, Glob, and Bash for `bismuth` read commands only',
    '(`bismuth read <note>`, `bismuth search <words>` (keyword and meaning blended; add `--regex` for a pattern), `bismuth history [words]`, `bismuth docs list|read|search`, `bismuth task list`, `bismuth map`, `bismuth brain`).',
    'You cannot edit; when the request needs an edit, say what you would change. Look things up instead of guessing, say plainly when you cannot find something,',
    'and finish with one direct reply.',
].join(' ')

const PROBE_SYSTEM = `${AGENT_SYSTEM} For this check, reply with the single word ok.`

const PAIRWISE_SYSTEM =
    'You compare two answers an assistant gave to the same user message in a personal-notes vault. You see the conversation so far, the user\'s message, and for each answer its final reply and a short trace of what it looked at. ' +
    'You can Read, Grep and Glob the vault to check what an answer claims: a note or file it mentions may exist and say what it says, so check before calling anything invented. Decide which answer serves the user better: correct, grounded in the vault rather than invented, complete for what was asked, and direct. Do not prefer an answer for its length or confidence. If they are equal in value, say tie. ' +
    'Reply with one JSON object and nothing else: {"better":"A"|"B"|"tie","reason":"one sentence"}.'

const RELIANCE_SYSTEM =
    'You are shown numbered items that were placed in an assistant\'s context before it answered, then the assistant\'s tool trace and final answer. List the numbers of the items the answer actually depends on: a fact taken from the item, or a file opened because the item named it. ' +
    'An item that is merely present, or whose content the answer does not use, is not relied on. Reply with one JSON object and nothing else: {"relied":[numbers]}.'

// ---- the sdk ----------------------------------------------------------------------------------

export type Usage = { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number }
export type Msg = { type: string; subtype?: string; result?: string; usage?: Usage; num_turns?: number; total_cost_usd?: number; duration_ms?: number; is_error?: boolean; model?: string; message?: { id?: string; usage?: Usage; content?: { type?: string; name?: string; input?: Record<string, unknown>; content?: unknown }[] } }

let sdk: Promise<{ query: (a: unknown) => AsyncIterable<Msg>; bin: string; env: () => Record<string, string | undefined> }> | null = null
const loadSdk = () =>
    (sdk ??= (async () => {
        const { whichClaude, claudeSpawnEnv } = await import('../core/src/claudeWhich')
        const bin = whichClaude()
        if (!bin) throw new Error('claude binary not found')
        const { query } = await import('../core/node_modules/@anthropic-ai/claude-agent-sdk')
        return { query: query as never, bin, env: () => claudeSpawnEnv() as never }
    })())

/** One model reply, no tools. */
async function ask(model: string, system: string, text: string, cwd: string, timeoutMs = 180_000, lookup = false): Promise<{ text: string; usage: Usage; cost: number } | null> {
    // `lookup`: the judge may Read, Grep and Glob the vault copy (nothing else) to check what an answer claims
    async function* streamed() {
        yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' }
    }
    const guard = async (name: string, input: Record<string, unknown>) => (toolPolicy(cwd, name, input, false).ok ? { behavior: 'allow' as const, updatedInput: input } : { behavior: 'deny' as const, message: 'not available' })
    const hooks = { PreToolUse: [{ hooks: [policyHook(cwd, () => {}, false)] }] }
    const { query, bin, env } = await loadSdk()
    for (let attempt = 1; attempt <= 2; attempt++) {
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), timeoutMs)
        try {
            let out = ''
            let usage: Usage = {}
            let cost = 0
            const stream = lookup
                ? query({ prompt: streamed(), options: { model, pathToClaudeCodeExecutable: bin, cwd, env: env(), tools: ['Read', 'Grep', 'Glob'], canUseTool: guard, hooks, permissionMode: 'default', maxTurns: 12, persistSession: false, settingSources: [], systemPrompt: system, abortController: abort } })
                : query({ prompt: text, options: { model, pathToClaudeCodeExecutable: bin, cwd, env: env(), tools: [], maxTurns: 1, persistSession: false, settingSources: [], systemPrompt: system, abortController: abort } })
            for await (const m of stream) if (m.type === 'result' && m.subtype === 'success') (out = m.result ?? ''), (usage = m.usage ?? {}), (cost = m.total_cost_usd ?? 0)
            if (out) return { text: out, usage, cost }
        } catch {
            // retry once
        } finally {
            clearTimeout(timer)
        }
    }
    return null
}

// ---- cached runs and verdicts -----------------------------------------------------------------

export type RunResult = {
    status: 'ok' | 'max_turns' | 'timeout' | 'error'
    answer: string
    toolCalls: number
    turns: number
    tools: { name: string; arg: string }[]
    denied: number
    /** Each refused call and why (the PreToolUse hook's and the permission callback's). */
    denials: { tool: string; arg: string; why: string }[]
    /** `bismuth search` and `bismuth docs search` calls the agent made. */
    searches: number
    /** How many of those fell back to keywords: the CLI's stderr line `meaning search unavailable (<reason>)` in the tool results. */
    searchFallbacks: number
    usage: Usage
    /** The context at the last model call (fresh + cache write + cache read) plus the output tokens. Every token the
     *  run held or wrote, counted once, whether it was written to the cache or read from it, so another run's cache
     *  entries do not change it. */
    tokens: number
    /** The same with cache reads. */
    tokensAll: number
    costUsd: number
    durationMs: number
    model: string
    /** Wall time the run spent with the machine asleep, from the heartbeat's gaps (`watchSleep`). A run that spans a
     *  lid-closed sleep times out mid-flight and reads long. */
    sleptMs?: number
}

/** A heartbeat gap longer than this is the process not running: the machine slept. */
const SLEEP_GAP_MS = 5_000
const HEARTBEAT_MS = 1_000

/** Wall-clock spans the process did not run. Clock-agnostic: a 1 s heartbeat that finds more than SLEEP_GAP_MS since the
 *  last beat records the gap. */
export const sleepGaps: { from: number; to: number }[] = []
export function watchSleep(now: () => number = Date.now): () => void {
    let last = now()
    const t = setInterval(() => {
        const at = now()
        if (at - last > SLEEP_GAP_MS) sleepGaps.push({ from: last, to: at })
        last = at
    }, HEARTBEAT_MS)
    t.unref()
    return () => clearInterval(t)
}

/** How much of [from, to] lies inside recorded sleep gaps. */
export const sleptDuring = (from: number, to: number, gaps = sleepGaps): number =>
    gaps.reduce((a, g) => a + Math.max(0, Math.min(to, g.to) - Math.max(from, g.from)), 0)

/** One agent call with retries: a failed or timed-out run is retried once, and up to three more times while each failed
 *  attempt overlapped a machine sleep, so a closed lid costs a rerun instead of a missing pair. */
export async function runWithRetry<C>(agent: (c: C) => Promise<RunResult>, call: C, log?: (s: string) => void): Promise<RunResult> {
    let r = await agent(call)
    for (let attempt = 1; attempt <= 4 && (r.status === 'error' || r.status === 'timeout'); attempt++) {
        const slept = (r.sleptMs ?? 0) > SLEEP_GAP_MS
        if (attempt > 1 && !slept) break
        if (slept) log?.(`  machine slept ${Math.round(r.sleptMs! / 1000)}s during a run that ended ${r.status}; retrying`)
        r = await agent(call)
    }
    return r
}

export const loadCache = <T,>(path: string): Map<string, T> => {
    const m = new Map<string, T>()
    if (existsSync(path)) {
        const text = readFileSync(path, 'utf8')
        // a sweep killed mid-append leaves a last line with no newline; the next append would glue its record onto it and lose both
        if (text && !text.endsWith('\n')) appendFileSync(path, '\n')
        for (const l of text.split('\n'))
            try {
                const j = JSON.parse(l)
                m.set(j.k, j.v)
            } catch {}
    }
    return m
}

const FALLBACK_LINE = /meaning search unavailable \(([^)]*)\)/g
const SEARCH_COMMAND = /\bbismuth\s+(?:docs\s+)?search\b/g

/** The keyword fallbacks one SDK message reports: the CLI's stderr line, once per search that fell back, inside a Bash tool result. */
export function fallbacksIn(m: Msg): number {
    if (m.type !== 'user') return 0
    let n = 0
    for (const b of m.message?.content ?? []) {
        if (b.type !== 'tool_result') continue
        const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(x => (x as { text?: string }).text ?? '').join('\n') : ''
        n += text.match(FALLBACK_LINE)?.length ?? 0
    }
    return n
}

/** How many searches one Bash command line runs. */
export const searchesIn = (command: string): number => command.match(SEARCH_COMMAND)?.length ?? 0

export const argOf = (i: Record<string, unknown> | undefined): string => {
    const v = i?.command ?? i?.file_path ?? i?.pattern ?? i?.path ?? i?.args
    return String(Array.isArray(v) ? v.join(' ') : (v ?? '')).slice(0, 1000)
}

/** Run one agent turn on the vault copy. `denied` counts tool calls the guard refused. The guard is a PreToolUse hook
 *  callback, which fires for every call, including the read-only shell commands the permission system approves
 *  without asking; `canUseTool` repeats the same policy unless `hookOnly` (the guard probe) is set. */
async function runAgent(userMessage: string, copy: string, binDir: string, model: string, system: string, hookOnly = false): Promise<RunResult> {
    const { query, bin, env } = await loadSdk()
    const started = Date.now()
    const res: RunResult = { status: 'error', answer: '', toolCalls: 0, turns: 0, tools: [], denied: 0, denials: [], searches: 0, searchFallbacks: 0, usage: {}, tokens: 0, tokensAll: 0, costUsd: 0, durationMs: 0, model }
    const abort = new AbortController()
    const timer = setTimeout(() => {
        res.status = 'timeout'
        abort.abort()
    }, AGENT_TIMEOUT_MS)
    const deny = (tool: string, input: Record<string, unknown>, why: string) => {
        res.denied++
        res.denials.push({ tool, arg: argOf(input), why })
    }
    const guard = async (name: string, input: Record<string, unknown>) => {
        const v = toolPolicy(copy, name, input)
        if (v.ok) return { behavior: 'allow' as const, updatedInput: input }
        deny(name, input, `canUseTool: ${v.why}`)
        return { behavior: 'deny' as const, message: v.why }
    }
    async function* input() {
        yield { type: 'user', message: { role: 'user', content: userMessage }, parent_tool_use_id: null, session_id: '' }
    }
    let lastCall: Usage = {}
    try {
        const e = env()
        const stream = query({
            prompt: input(),
            options: {
                model,
                pathToClaudeCodeExecutable: bin,
                cwd: copy,
                env: { ...e, PATH: `${binDir}:${e.PATH ?? ''}` },
                tools: ['Read', 'Grep', 'Glob', 'Bash'],
                hooks: { PreToolUse: [{ hooks: [policyHook(copy, (n, i, why) => deny(n, i, `hook: ${why}`))] }] },
                ...(hookOnly ? {} : { canUseTool: guard }),
                permissionMode: 'default',
                maxTurns: AGENT_MAX_TURNS,
                persistSession: false,
                settingSources: [],
                systemPrompt: system,
                abortController: abort,
            },
        })
        for await (const m of stream) {
            if (m.type === 'assistant') {
                if (m.message?.usage) lastCall = m.message.usage
                for (const b of m.message?.content ?? []) if (b.type === 'tool_use') (res.toolCalls++, res.tools.push({ name: b.name ?? '?', arg: argOf(b.input) }), b.name === 'Bash' && (res.searches += searchesIn(argOf(b.input))))
            } else if (m.type === 'user') {
                res.searchFallbacks += fallbacksIn(m)
            } else if (m.type === 'result') {
                res.status = m.subtype === 'success' ? 'ok' : m.subtype === 'error_max_turns' ? 'max_turns' : 'error'
                res.answer = m.result ?? ''
                res.turns = m.num_turns ?? 0
                res.usage = m.usage ?? {}
                res.costUsd = m.total_cost_usd ?? 0
            }
        }
    } catch {
        if (res.status !== 'timeout') res.status = 'error'
    } finally {
        clearTimeout(timer)
    }
    const u = res.usage
    res.tokens = (lastCall.input_tokens ?? 0) + (lastCall.cache_creation_input_tokens ?? 0) + (lastCall.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0)
    res.tokensAll = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    res.durationMs = Date.now() - started
    res.sleptMs = sleptDuring(started, started + res.durationMs)
    return res
}

/** Run jobs on a pool of workers. */
export async function pool<T>(items: T[], workers: number, f: (x: T, i: number) => Promise<void>) {
    let next = 0
    await Promise.all(
        Array.from({ length: Math.min(workers, items.length) }, async () => {
            for (;;) {
                const i = next++
                if (i >= items.length) return
                await f(items[i]!, i)
            }
        }),
    )
}

// ---- the sweep --------------------------------------------------------------------------------

export type CaseLine = { set: EvalRow['set']; session: string; at: string; prompt: string; candItems: { key: string; text: string }[] }
type Judged = CandRow

const readJsonl = <T,>(path: string): T[] =>
    readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as T)

export const REAL_ARMS: RealArm[] = ['none', 'references', 'excerpts', 'junk', 'search']
/** The arms compared against none. */
export const COMPARED: Exclude<RealArm, 'none'>[] = ['references', 'excerpts', 'junk', 'search']
/** The arms that put a sources block in the message. */
export const BLOCK_ARMS: RealArm[] = ['references', 'excerpts', 'junk']
// eval4: runs now carry their search fallback counts, and the eval3 runs were measured with searches that fell back by chance
const TAG = 'eval4'

/** A conversation as the agent was given it: the last turns before the prompt's line, injected blocks stripped. Not yet cleaned of the vault path. */
export function conversationOf(lines: string[], lineNo: number): string {
    const turns: string[] = []
    for (const l of lines.slice(Math.max(0, lineNo - 400), lineNo)) {
        try {
            const e = JSON.parse(l) as { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: never }
            if (e.isSidechain || e.isMeta || (e.type !== 'user' && e.type !== 'assistant')) continue
            const t = stripInjectedBlocks(extractText(e.message)).trim()
            if (t) turns.push(`${e.type}: ${t.slice(0, 700)}`)
        } catch {}
    }
    return turns.slice(-8).join('\n\n').slice(-5000)
}

/** One case, with everything the arms need. `convo` already has the vault path replaced by the copy's. */
export type CaseInput = { id: number; session: string; set: EvalRow['set']; heldOut: boolean; at: string; prompt: string; convo: string; visible: string[]; cands: Cand[]; dates: (key: string) => string | undefined }

export type Job = { caseId: number; arm: RealArm; sample: number; keys: string[]; message: string; system: string; runKey: string; /** a none run that only the control uses: samples K..2K-1 */ control?: true }

const runKeyOf = (model: string, system: string, message: string, sample: number, visible: string[]) => hashOf([TAG, 'run', model, system, message, `sample${sample}`, hashOf(visible.join(','))].join('\u0000'))

/** Every (case, arm, sample) run. An arm whose block is empty has the same message as none, so the same key: one run. `search` has none's
 *  message under a longer system prompt, so its key differs. Each case also gets K more none runs, samples K..2K-1, marked `control`:
 *  the control pairs none#i with none#K+i, so it averages K independent pairs as every arm does and its interval is the noise floor at K. */
export function buildJobs(cases: CaseInput[], o: { samples: number; agentModel: string; copy: string; kFallback: number }): Job[] {
    const jobs: Job[] = []
    for (const c of cases) {
        const byKey = new Map(c.cands.map(x => [x.key, x]))
        const gate = gateKeys(c.cands)
        const junk = junkKeys(c.cands, gate.length || o.kFallback)
        for (const arm of REAL_ARMS) {
            const keys = arm === 'references' || arm === 'excerpts' ? gate : arm === 'junk' ? junk : []
            const items = keys.map(k => ({ cand: byKey.get(k)!, date: c.dates(k) }))
            const block = keys.length ? (arm === 'excerpts' ? excerptsBlock(items, o.copy) : sourcesBlock(items, o.copy)) : null
            const message = [`Today is ${c.at.slice(0, 10)}.`, c.convo ? `<conversation-so-far>\n${c.convo}\n</conversation-so-far>` : '', block ? `<bismuth-memory>\n${block}</bismuth-memory>` : '', c.prompt].filter(Boolean).join('\n\n')
            const system = arm === 'search' ? `${AGENT_SYSTEM} ${SEARCH_FIRST}` : AGENT_SYSTEM
            for (let sample = 0; sample < o.samples; sample++) jobs.push({ caseId: c.id, arm, sample, keys: block ? keys : [], message, system, runKey: runKeyOf(o.agentModel, system, message, sample, c.visible) })
            if (arm === 'none')
                for (let sample = o.samples; sample < 2 * o.samples; sample++) jobs.push({ caseId: c.id, arm, sample, keys: [], message, system, runKey: runKeyOf(o.agentModel, system, message, sample, c.visible), control: true })
        }
    }
    return jobs
}

export type PairArm = Exclude<RealArm, 'none'> | 'control'
export type PairJob = { arm: PairArm; caseId: number; sample: number; base: Job; other: Job; /** the same run on both sides: a tie by construction */ same: boolean; /** verdict keys: [arm shown as A, arm shown as B] */ keys: [string, string]; texts: [string, string] }
export type RelJob = { job: Job; text: string; key: string }
export type Rec<R> = { r: R; tokens: number; usage: Usage; cost: number }
export type ProbeRec = { n: number; tokens: number; cost: number }

/** What the work is, before any call: distinct agent runs, the pair judgements (two orders each) and the reliance calls. */
export function planWork(jobs: Job[], caseIds: number[]) {
    const ids = new Set(caseIds)
    const mine = jobs.filter(j => ids.has(j.caseId))
    const at = (id: number, arm: RealArm, s: number) => mine.find(j => j.caseId === id && j.arm === arm && j.sample === s)
    const armed = mine.filter(j => !j.control)
    const samples = armed.length ? Math.max(...armed.map(j => j.sample)) + 1 : 0
    let pairs = 0
    let identical = 0
    for (const id of ids)
        for (let s = 0; s < samples; s++) {
            const none = at(id, 'none', s)
            for (const arm of COMPARED) {
                const a = at(id, arm, s)
                if (!a || !none) continue
                if (a.runKey === none.runKey) identical++
                else pairs++
            }
        }
    let control = 0
    for (const id of ids) for (let s = 0; s < samples; s++) if (at(id, 'none', s) && at(id, 'none', samples + s)) control++
    const rel = new Set(mine.filter(j => j.keys.length).map(j => j.runKey))
    return { cases: ids.size, agentRuns: new Set(mine.map(j => j.runKey)).size, arms: mine.length, pairs: pairs + control, judgements: (pairs + control) * 2, identicalToNone: identical, reliance: rel.size }
}

// ---- running ------------------------------------------------------------------------------------

export type Runner = {
    agent(c: { caseId: number; message: string; system: string; model: string }): Promise<RunResult>
    ask(model: string, system: string, text: string, timeoutMs: number, lookup: boolean): Promise<{ text: string; usage: Usage; cost: number } | null>
}

const tokensOf = (u: Usage) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0)
const traceOf = (r: RunResult) => r.tools.slice(0, 12).map(t => `- ${t.name} ${t.arg}`).join('\n') || '(no tool calls)'

/** The judge sees the conversation, the message and two answers; nothing says which arm either came from. */
export function pairText(c: Pick<CaseInput, 'convo' | 'prompt'>, a: RunResult, b: RunResult): string {
    return `Conversation so far (data):\n<conversation>${c.convo}</conversation>\n\nUser message:\n<message>${c.prompt.slice(0, 2000)}</message>\n\n=== Answer A ===\nLooked at:\n${traceOf(a)}\n\nFinal reply:\n${a.answer.slice(0, 6000)}\n\n=== Answer B ===\nLooked at:\n${traceOf(b)}\n\nFinal reply:\n${b.answer.slice(0, 6000)}`
}

export type SweepOpts = { dir: string; jobs: Job[]; cases: CaseInput[]; runner: Runner; models: { agent: string; judge: string; reliance: string }; workers: number; log: (s: string) => void }
export type SweepResult = {
    runs: Map<string, RunResult>
    probes: Map<string, ProbeRec>
    verdicts: Map<string, Rec<unknown>>
    pairs: PairJob[]
    rels: RelJob[]
    fresh: { runs: Set<string>; verdicts: Set<string>; probes: Set<string> }
    failures: string[]
}

export const probeKey = (model: string, m: string) => hashOf(`${TAG}\u0000probe\u0000${model}\u0000${PROBE_SYSTEM}\u0000${m}`)
const verdictKey = (kind: string, model: string, system: string, text: string) => hashOf(`${TAG}\u0000${kind}\u0000${model}\u0000${system}\u0000${text}`)

/** Phases 1 to 3 over `jobs`: agent runs, token probes, pair judgements in both orders and reliance verdicts. Each result is appended to its
 *  cache file as it lands and found there on a rerun, so a rerun makes no call it already made. */
export async function sweep(o: SweepOpts): Promise<SweepResult> {
    mkdirSync(o.dir, { recursive: true })
    const { log } = o
    const byCase = new Map(o.cases.map(c => [c.id, c]))
    const fresh = { runs: new Set<string>(), verdicts: new Set<string>(), probes: new Set<string>() }
    const failures: string[] = []

    const runsPath = join(o.dir, 'runs.jsonl')
    const runs = loadCache<RunResult>(runsPath)
    const todo = [...new Map(o.jobs.filter(j => !runs.has(j.runKey)).map(j => [j.runKey, j])).values()]
    const distinct = new Set(o.jobs.map(j => j.runKey))
    // a run is found by a key that holds the tag, the model, the prompts and what history shows; records under other keys were made for other inputs and stay unused
    log(`agent runs: ${todo.length} to run of ${distinct.size} distinct (${o.jobs.length} arm-samples), ${distinct.size - todo.length} reused from ${runs.size} cached in runs.jsonl, ${o.workers} workers`)
    let done = 0
    let spent = 0
    await pool(todo, o.workers, async j => {
        const call = { caseId: j.caseId, message: j.message, system: j.system, model: o.models.agent }
        const r = await runWithRetry(o.runner.agent, call, log)
        if (r.status === 'ok' || r.status === 'max_turns') {
            runs.set(j.runKey, r)
            fresh.runs.add(j.runKey)
            appendFileSync(runsPath, JSON.stringify({ k: j.runKey, v: r }) + '\n')
        }
        spent += r.costUsd
        log(`  [${++done}/${todo.length}] case ${j.caseId} ${j.arm}#${j.sample + 1} ${r.status} calls ${r.toolCalls} turns ${r.turns} tokens ${r.tokens} ${Math.round(r.durationMs / 1000)}s  ($${spent.toFixed(2)} so far)`)
    })

    // what each sources block costs, measured: one reply-"ok" turn per distinct message; the first-turn input tokens of an arm's message less the same case's none message
    const probesPath = join(o.dir, 'probes.jsonl')
    const probes = loadCache<ProbeRec>(probesPath)
    const probeTodo = [...new Set(o.jobs.filter(j => j.sample === 0 && (j.arm === 'none' || j.keys.length)).map(j => j.message))].filter(m => !probes.has(probeKey(o.models.agent, m)))
    log(`token probes: ${probeTodo.length} to run`)
    await pool(probeTodo, o.workers, async m => {
        const r = await o.runner.ask(o.models.agent, PROBE_SYSTEM, m, 180_000, false)
        if (!r) return
        const rec = { n: (r.usage.input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0), tokens: tokensOf(r.usage), cost: r.cost }
        probes.set(probeKey(o.models.agent, m), rec)
        fresh.probes.add(probeKey(o.models.agent, m))
        appendFileSync(probesPath, JSON.stringify({ k: probeKey(o.models.agent, m), v: rec }) + '\n')
    })

    // pair judgements: sample i of an arm against sample i of none, each in both orders; the control is none#i against none#K+i
    const at = (id: number, arm: RealArm, s: number) => o.jobs.find(j => j.caseId === id && j.arm === arm && j.sample === s)
    const pairs: PairJob[] = []
    const addPair = (arm: PairArm, caseId: number, sample: number, base: Job | undefined, other: Job | undefined) => {
        if (!base || !other) return
        const [rb, ro] = [runs.get(base.runKey), runs.get(other.runKey)]
        if (!rb || !ro) return void failures.push(`case ${caseId} ${arm}#${sample + 1} run`)
        const c = byCase.get(caseId)!
        // order 1 shows the arm as A, order 2 as B
        const texts: [string, string] = [pairText(c, ro, rb), pairText(c, rb, ro)]
        pairs.push({ arm, caseId, sample, base, other, same: base.runKey === other.runKey, texts, keys: [verdictKey('pair', o.models.judge, PAIRWISE_SYSTEM, texts[0]), verdictKey('pair', o.models.judge, PAIRWISE_SYSTEM, texts[1])] })
    }
    for (const c of o.cases) {
        const samples = [...new Set(o.jobs.filter(j => j.caseId === c.id && !j.control).map(j => j.sample))]
        for (const arm of COMPARED) for (const s of samples) addPair(arm, c.id, s, at(c.id, 'none', s), at(c.id, arm, s))
        for (const s of samples) addPair('control', c.id, s, at(c.id, 'none', s), at(c.id, 'none', samples.length + s))
    }
    const rels: RelJob[] = []
    for (const j of o.jobs) {
        const r = runs.get(j.runKey)
        if (!j.keys.length || !r || rels.some(x => x.job.runKey === j.runKey)) continue
        const cands = byCase.get(j.caseId)!.cands
        const items = j.keys.map((k, i) => `${i + 1}. ${k}\n${(cands.find(x => x.key === k)?.text ?? '').slice(0, 600)}`).join('\n\n')
        const text = `Items placed in context:\n${items}\n\nAssistant's tool trace:\n${traceOf(r)}\n\nAssistant's final answer:\n${r.answer.slice(0, 6000)}`
        rels.push({ job: j, text, key: verdictKey('rel', o.models.reliance, RELIANCE_SYSTEM, text) })
    }
    const verdictsPath = join(o.dir, 'verdicts.jsonl')
    const verdicts = loadCache<Rec<unknown>>(verdictsPath)
    type Ask = { kind: 'pair' | 'rel'; key: string; model: string; system: string; text: string }
    const asks: Ask[] = [
        ...pairs.filter(p => !p.same).flatMap(p => [0, 1].map(i => ({ kind: 'pair' as const, key: p.keys[i]!, model: o.models.judge, system: PAIRWISE_SYSTEM, text: p.texts[i]! }))),
        ...rels.map(r => ({ kind: 'rel' as const, key: r.key, model: o.models.reliance, system: RELIANCE_SYSTEM, text: r.text })),
    ]
    const todoV = [...new Map(asks.filter(a => !verdicts.has(a.key)).map(a => [a.key, a])).values()]
    log(`verdicts: ${todoV.length} to ask of ${new Set(asks.map(a => a.key)).size}`)
    await pool(todoV, o.workers, async v => {
        const r = await o.runner.ask(v.model, v.system, v.text, v.kind === 'pair' ? 420_000 : 180_000, v.kind === 'pair')
        if (!r) return
        const parsed = v.kind === 'pair' ? parsePairwise(r.text) : { relied: ((jsonIn(r.text)?.relied as unknown[]) ?? []).map(Number).filter(Number.isFinite) }
        if (!parsed) return
        const rec: Rec<unknown> = { r: parsed, tokens: tokensOf(r.usage), usage: r.usage, cost: r.cost }
        verdicts.set(v.key, rec)
        fresh.verdicts.add(v.key)
        appendFileSync(verdictsPath, JSON.stringify({ k: v.key, v: rec }) + '\n')
    })
    return { runs, probes, verdicts, pairs, rels, fresh, failures }
}

// ---- reading the results ------------------------------------------------------------------------

export type PairVerdict = { outcome: Outcome; orders: [Verdict, Verdict] | null; reasons: string[]; byConstruction: boolean }

/** The merged outcome of one pair, or null when a judgement is missing. */
export function pairVerdict(p: PairJob, verdicts: Map<string, Rec<unknown>>): PairVerdict | null {
    if (p.same) return { outcome: 'tie', orders: null, reasons: [], byConstruction: true }
    const [a, b] = [verdicts.get(p.keys[0]), verdicts.get(p.keys[1])] as (Rec<{ better: Verdict; reason: string }> | undefined)[]
    if (!a || !b) return null
    return { outcome: mergeOrders(a.r.better, b.r.better), orders: [a.r.better, b.r.better], reasons: [a.r.reason, b.r.reason], byConstruction: false }
}

const score = (o: Outcome) => (o === 'win' ? 1 : o === 'loss' ? -1 : 0)

/** An arm's (or the control's) result: net per prompt (the mean over its samples) with intervals over all prompts and over held-out ones, the share of
 *  judged pairs whose two orders agreed, and how many pairs ended each way. */
export function armSummary(arm: PairArm, res: SweepResult, cases: CaseInput[], draws: number) {
    const heldOut = new Set(cases.filter(c => c.heldOut).map(c => c.id))
    const sessionOf = new Map(cases.map(c => [c.id, c.session]))
    const byCase = new Map<number, number[]>()
    const outcomes = { win: 0, tie: 0, loss: 0, byConstruction: 0, missing: 0 }
    let judged = 0
    let consistent = 0
    for (const p of res.pairs.filter(x => x.arm === arm)) {
        const v = pairVerdict(p, res.verdicts)
        if (!v) {
            outcomes.missing++
            continue
        }
        outcomes[v.outcome]++
        if (v.byConstruction) outcomes.byConstruction++
        else {
            judged++
            if (v.outcome !== 'tie' || (v.orders![0] === 'tie' && v.orders![1] === 'tie')) consistent++
        }
        byCase.set(p.caseId, [...(byCase.get(p.caseId) ?? []), score(v.outcome)])
    }
    const nets: PromptNet[] = [...byCase.entries()].map(([caseId, xs]) => ({ caseId, session: sessionOf.get(caseId)!, net: xs.reduce((a, b) => a + b, 0) / xs.length }))
    return { all: netIntervals(nets, draws), heldOut: netIntervals(nets.filter(n => heldOut.has(n.caseId)), draws), orderConsistency: judged ? consistent / judged : null, judgedPairs: judged, outcomes }
}

/** The share of the references an arm's runs opened: opened over given, across every run that was given any. */
export function openedShare(arm: RealArm, res: SweepResult, jobs: Job[], copy: string): number | null {
    let given = 0
    let opened = 0
    for (const j of jobs.filter(x => x.arm === arm && x.keys.length)) {
        const r = res.runs.get(j.runKey)
        if (!r) continue
        given += j.keys.length
        opened += openedReferences(j.keys, r.tools, copy).length
    }
    return given ? opened / given : null
}

const sumTokens = (us: Usage[]) => {
    const t = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0 }
    for (const u of us) {
        t.input += u.input_tokens ?? 0
        t.cacheWrite += u.cache_creation_input_tokens ?? 0
        t.cacheRead += u.cache_read_input_tokens ?? 0
        t.output += u.output_tokens ?? 0
    }
    t.total = t.input + t.cacheWrite + t.cacheRead + t.output
    return t
}

/** The pilot's usage by phase, summed from what the SDK reported, and the full target's projection: each phase's total per case times the target's cases. */
export function usageReport(res: SweepResult, jobs: Job[], pilotCases: number, targetCases: number) {
    const runKeys = [...new Set(jobs.map(j => j.runKey))]
    const runs = runKeys.map(k => res.runs.get(k)).filter((r): r is RunResult => !!r)
    const pairKeys = [...new Set(res.pairs.filter(p => !p.same).flatMap(p => p.keys))]
    const judges = pairKeys.map(k => res.verdicts.get(k)).filter((r): r is Rec<unknown> => !!r)
    const relies = res.rels.map(r => res.verdicts.get(r.key)).filter((r): r is Rec<unknown> => !!r)
    const phase = (n: number, us: Usage[], cost: number, freshN: number) => {
        const tokens = sumTokens(us)
        const scale = pilotCases ? targetCases / pilotCases : 0
        return { calls: n, freshCalls: freshN, tokens, costUsd: cost, meanTokensPerCall: n ? tokens.total / n : 0, meanCostPerCall: n ? cost / n : 0, projectedAtTarget: { calls: Math.round(n * scale), tokensTotal: Math.round(tokens.total * scale), costUsd: cost * scale } }
    }
    const probeRecs = [...res.probes.values()]
    const phases = {
        agentRuns: phase(runs.length, runs.map(r => r.usage), runs.reduce((a, r) => a + r.costUsd, 0), runKeys.filter(k => res.fresh.runs.has(k)).length),
        judges: phase(judges.length, judges.map(r => r.usage), judges.reduce((a, r) => a + r.cost, 0), pairKeys.filter(k => res.fresh.verdicts.has(k)).length),
        reliance: phase(relies.length, relies.map(r => r.usage), relies.reduce((a, r) => a + r.cost, 0), res.rels.filter(r => res.fresh.verdicts.has(r.key)).length),
        tokenProbes: phase(probeRecs.length, [{ input_tokens: probeRecs.reduce((a, p) => a + p.n, 0) }], probeRecs.reduce((a, p) => a + p.cost, 0), res.fresh.probes.size),
    }
    const all = Object.values(phases)
    return {
        cases: pilotCases,
        targetCases,
        agentRuns: phases.agentRuns.calls,
        judgements: phases.judges.calls,
        relianceVerdicts: phases.reliance.calls,
        phases,
        total: { tokens: all.reduce((a, p) => a + p.tokens.total, 0), costUsd: all.reduce((a, p) => a + p.costUsd, 0), projectedAtTarget: { tokens: all.reduce((a, p) => a + p.projectedAtTarget.tokensTotal, 0), costUsd: all.reduce((a, p) => a + p.projectedAtTarget.costUsd, 0) } },
        note: 'tokens are summed from the SDK usage; cost is the SDK-reported total_cost_usd. The projection scales each phase total per case by the target case count. Compare with /usage yourself; this makes no claim about a plan percentage.',
    }
}

// ---- real needle questions ----------------------------------------------------------------------
// A separate stage from the real prompts: each question from bench/needleCases.ts runs arms none and search, `samples` times each, on
// the same copy with the same tools. A needle has no recall candidates, so references, excerpts and junk do not apply. Its runs and
// verdicts are cached in their own files, and its results never enter quality.jsonl, quality-samples.jsonl or control.jsonl.

export type NeedleArm = 'none' | 'search'
export const NEEDLE_ARMS: NeedleArm[] = ['none', 'search']
export type NeedleScore = 'correct' | 'wrong' | 'abstained'
export type NeedleJob = { n: Needle; /** the id the runner and the case's history wrapper are keyed by */ caseId: number; arm: NeedleArm; sample: number; visible: string[]; message: string; system: string; runKey: string }

/** When every session began: each log in `logs` dated by its first timestamp, plus sessions with cases but no log (dated by `fallback`, their first prompt).
 *  `bismuth history` for a prompt shows what started before it, so this covers every log, not only the sessions that have cases. */
export function allSessionStarts(logs: string, fallback: Map<string, number>): Map<string, number> {
    const out = new Map<string, number>()
    const ids = existsSync(logs) ? readdirSync(logs).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -'.jsonl'.length)) : []
    for (const s of ids) {
        const t = sessionStart(join(logs, `${s}.jsonl`)) ?? fallback.get(s)
        if (t !== undefined) out.set(s, t)
    }
    for (const [s, t] of fallback) if (!out.has(s)) out.set(s, t)
    return out
}

/** The sessions `bismuth history` may show a needle question: a needle is asked now about the past, so it sees every log, its own session
 *  included; an aggregate (session null) likewise. null when a needle's session has no log to date it by. */
export function needleVisible(starts: Map<string, number>, n: Pick<Needle, 'session'>): string[] | null {
    if (n.session !== null && !starts.has(n.session)) return null
    return [...starts.keys()].sort()
}

/** Needle caseIds sit far above the real prompts' ids, so their wrapper directories never collide. */
export const NEEDLE_ID_BASE = 1_000_000

export function buildNeedleJobs(needles: Needle[], starts: Map<string, number>, o: { samples: number; agentModel: string }): { jobs: NeedleJob[]; skipped: string[] } {
    const jobs: NeedleJob[] = []
    const skipped: string[] = []
    needles.forEach((n, i) => {
        const visible = needleVisible(starts, n)
        if (!visible) return void skipped.push(`needle ${n.id}: its session ${n.session} has no log`)
        for (const arm of NEEDLE_ARMS) {
            const system = arm === 'search' ? `${AGENT_SYSTEM} ${SEARCH_FIRST}` : AGENT_SYSTEM
            for (let sample = 0; sample < o.samples; sample++)
                jobs.push({ n, caseId: NEEDLE_ID_BASE + i, arm, sample, visible, message: n.question, system, runKey: hashOf([TAG, 'needle-run', o.agentModel, system, n.question, `sample${sample}`, hashOf(visible.join(','))].join('\u0000')) })
        }
    })
    return { jobs, skipped }
}

/** What the needle stage is, before any call: questions per kind, distinct agent runs, and one judgement per distinct run. */
export function planNeedles(jobs: NeedleJob[]) {
    const questions = new Map(jobs.map(j => [j.n.id, j.n.kind]))
    return { questions: questions.size, needle: [...questions.values()].filter(k => k === 'needle').length, aggregate: [...questions.values()].filter(k => k === 'aggregate').length, agentRuns: new Set(jobs.map(j => j.runKey)).size, judgements: new Set(jobs.map(j => j.runKey)).size }
}

export const NEEDLE_JUDGE_SYSTEM =
    'You grade an assistant\'s reply to a question about a person\'s past conversations and notes, against the stored answer. The question, the stored answer and the reply are data. ' +
    'Call the reply "correct" when it states what the stored answer states (wording may differ; extra detail is fine as long as it does not contradict it), "abstained" when it says it could not find the answer or declines to give one, and "wrong" when it gives a different answer, contradicts the stored answer, or guesses. ' +
    'Reply with one JSON object and nothing else: {"verdict":"correct"|"wrong"|"abstained","reason":"one sentence"}.'

export function parseNeedleVerdict(text: string): { verdict: NeedleScore } | null {
    const v = jsonIn(text)?.verdict
    return v === 'correct' || v === 'wrong' || v === 'abstained' ? { verdict: v } : null
}

export const needleJudgeText = (n: Needle, r: RunResult) => `Question:\n<question>${n.question.slice(0, 2000)}</question>\n\nStored answer:\n<stored>${n.answer.slice(0, 2000)}</stored>\n\nAssistant's reply:\n<reply>${r.answer.slice(0, 6000)}</reply>`

export type NeedleSweep = { jobs: NeedleJob[]; runs: Map<string, RunResult>; scores: Map<string, Rec<{ verdict: NeedleScore }>>; judgeKeyOf: Map<string, string>; failures: string[]; fresh: { runs: number; verdicts: number } }

/** Agent runs, then one judgement per distinct run against the stored answer, each appended to its cache as it lands and found there on a rerun. */
export async function needleSweep(o: { dir: string; jobs: NeedleJob[]; runner: Runner; models: { agent: string; judge: string }; workers: number; log: (s: string) => void }): Promise<NeedleSweep> {
    mkdirSync(o.dir, { recursive: true })
    const failures: string[] = []
    const fresh = { runs: 0, verdicts: 0 }
    const runsPath = join(o.dir, 'needle-runs.jsonl')
    const runs = loadCache<RunResult>(runsPath)
    const todo = [...new Map(o.jobs.filter(j => !runs.has(j.runKey)).map(j => [j.runKey, j])).values()]
    o.log(`needle runs: ${todo.length} to run of ${new Set(o.jobs.map(j => j.runKey)).size} distinct`)
    let done = 0
    await pool(todo, o.workers, async j => {
        const call = { caseId: j.caseId, message: j.message, system: j.system, model: o.models.agent }
        const r = await runWithRetry(o.runner.agent, call, o.log)
        if (r.status === 'ok' || r.status === 'max_turns') {
            runs.set(j.runKey, r)
            fresh.runs++
            appendFileSync(runsPath, JSON.stringify({ k: j.runKey, v: r }) + '\n')
        }
        o.log(`  [${++done}/${todo.length}] needle ${j.n.id} ${j.arm}#${j.sample + 1} ${r.status} calls ${r.toolCalls} tokens ${r.tokens}`)
    })
    const scoresPath = join(o.dir, 'needle-verdicts.jsonl')
    const scores = loadCache<Rec<{ verdict: NeedleScore }>>(scoresPath)
    const judgeKeyOf = new Map<string, string>()
    const asks: { key: string; text: string }[] = []
    for (const j of o.jobs) {
        const r = runs.get(j.runKey)
        if (!r) {
            failures.push(`needle ${j.n.id} ${j.arm}#${j.sample + 1} run`)
            continue
        }
        const text = needleJudgeText(j.n, r)
        const key = verdictKey('needle', o.models.judge, NEEDLE_JUDGE_SYSTEM, text)
        judgeKeyOf.set(j.runKey, key)
        asks.push({ key, text })
    }
    const todoV = [...new Map(asks.filter(a => !scores.has(a.key)).map(a => [a.key, a])).values()]
    o.log(`needle verdicts: ${todoV.length} to ask of ${new Set(asks.map(a => a.key)).size}`)
    await pool(todoV, o.workers, async v => {
        const r = await o.runner.ask(o.models.judge, NEEDLE_JUDGE_SYSTEM, v.text, 180_000, false)
        const parsed = r && parseNeedleVerdict(r.text)
        if (!r || !parsed) return
        const rec = { r: parsed, tokens: tokensOf(r.usage), usage: r.usage, cost: r.cost }
        scores.set(v.key, rec)
        fresh.verdicts++
        appendFileSync(scoresPath, JSON.stringify({ k: v.key, v: rec }) + '\n')
    })
    return { jobs: o.jobs, runs, scores, judgeKeyOf, failures, fresh }
}

/** Counts per arm and per kind. Never merged into the real-prompt rows. A judged run counts once per (question, sample). */
export function needleSummary(res: NeedleSweep, samples: number) {
    const count = (arm: NeedleArm, kind?: Needle['kind']) => {
        const c = { runs: 0, correct: 0, wrong: 0, abstained: 0, unjudged: 0, toolCalls: 0 }
        for (const j of res.jobs) {
            if (j.arm !== arm || (kind && j.n.kind !== kind)) continue
            const r = res.runs.get(j.runKey)
            if (!r) continue
            c.runs++
            c.toolCalls += r.toolCalls
            const s = res.scores.get(res.judgeKeyOf.get(j.runKey) ?? '')?.r.verdict
            if (s) c[s]++
            else c.unjudged++
        }
        return { ...c, accuracy: c.runs - c.unjudged ? c.correct / (c.runs - c.unjudged) : null }
    }
    const kinds = ['needle', 'aggregate'] as const
    return {
        samples,
        questions: planNeedles(res.jobs),
        arms: Object.fromEntries(NEEDLE_ARMS.map(a => [a, count(a)])),
        byKind: Object.fromEntries(kinds.map(k => [k, Object.fromEntries(NEEDLE_ARMS.map(a => [a, count(a, k)]))])),
        searchFallbacks: searchFallbacksByArm(NEEDLE_ARMS, res.jobs.map(j => ({ arm: j.arm, run: res.runs.get(j.runKey) }))),
        failures: res.failures,
    }
}

// ---- the copy's tools: history per case, one meaning index ------------------------------------

export type CaseDirs = { out: string; copy: string; logs: string; indexHome: string; realModels: string | null; cli: string; /** the slots the commands that embed queue on; absent = ungated */ searchGate?: { dir: string; slots: number } }

/** What one running `bismuth search` holds, measured on the real copy: 2.07 GB resident for the CLI (it scans the whole vault in-process) and 0.23 GB
 *  for its embedding worker. */
const SEARCH_PROCESS_BYTES = 2.3 * 1024 ** 3

/** How many searches may run at once: the machine's CPU and memory for processes of that size, never above the agent pool. */
export const searchSlots = (cpuCount: number, totalBytes: number, agents: number): number => judgePoolSize(cpuCount, totalBytes, SEARCH_PROCESS_BYTES, agents)

/** The wrapper's body after its environment lines: queue the commands that embed on the gate's slots, run everything else straight through.
 *  A slot is a directory holding its owner's pid, so a wrapper killed hard leaves a slot the next one reclaims. The rename makes reclaiming atomic. */
function gatedExec(bun: string, cli: string, gate: { dir: string; slots: number } | undefined): string {
    const direct = `exec "${bun}" "${cli}" "$@"\n`
    if (!gate) return direct
    return `gated=
case "$1" in
    search) gated=1 ;;
    docs) [ "$2" = search ] && gated=1 ;;
    map) case " $* " in *" --around "*) gated=1 ;; esac ;;
esac
if [ -n "$gated" ]; then
    G="${gate.dir}"
    slot=
    release() { [ -n "$slot" ] && rm -rf "$G/$slot"; slot=; }
    trap 'release; exit 143' INT TERM HUP
    while [ -z "$slot" ]; do
        i=0
        while [ "$i" -lt ${gate.slots} ]; do
            if mkdir "$G/$i" 2>/dev/null; then echo $$ > "$G/$i/pid"; slot=$i; break; fi
            p=$(cat "$G/$i/pid" 2>/dev/null)
            if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then mv "$G/$i" "$G/.stale.$$.$i" 2>/dev/null && rm -rf "$G/.stale.$$.$i"; fi
            i=$((i + 1))
        done
        [ -n "$slot" ] || sleep 0.1
    done
    "${bun}" "${cli}" "$@"
    rc=$?
    release
    exit $rc
fi
${direct}`
}

/** A case's `bismuth`: a wrapper whose CLAUDE_CONFIG_DIR holds links to the logs of `visible` only (what `bismuth history show` reads is
 *  <config>/projects/<encoded cwd>/<id>.jsonl, cli/src/commands/history.ts), and whose BISMUTH_HOME is a private one that shares the
 *  copy's meaning index and holds a clone of the chat vectors (a store prunes what its session set lacks, so cases must not share it).
 *  Only links and a script are made; removing them leaves the logs. Returns the directory to put on the agent's PATH. */
export function prepareCase(d: CaseDirs, id: number, visible: string[]): string {
    const config = join(d.out, 'history-config', `case-${id}`)
    const historyDir = join(config, 'projects', encodeProjectDir(d.copy))
    const home = join(d.out, 'case-home', String(id))
    // a run killed hard leaves both behind, and symlinkSync throws EEXIST on the rerun
    rmSync(config, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    mkdirSync(historyDir, { recursive: true })
    for (const sid of visible) {
        const f = join(d.logs, `${sid}.jsonl`)
        if (existsSync(f)) symlinkSync(resolve(f), join(historyDir, `${sid}.jsonl`))
    }
    mkdirSync(join(home, 'cache'), { recursive: true })
    if (d.realModels && existsSync(d.realModels)) symlinkSync(d.realModels, join(home, 'models'))
    for (const shared of ['vault-vectors', 'docs-vectors']) {
        mkdirSync(join(d.indexHome, 'cache', shared), { recursive: true })
        symlinkSync(join(d.indexHome, 'cache', shared), join(home, 'cache', shared))
    }
    const chats = join(d.indexHome, 'cache', 'chat-vectors')
    if (existsSync(chats)) Bun.spawnSync(['cp', '-cR', chats, join(home, 'cache', 'chat-vectors')])
    if (d.searchGate) mkdirSync(d.searchGate.dir, { recursive: true })
    const bin = join(d.out, 'bin', `case-${id}`)
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'bismuth'), `#!/bin/sh\nexport CLAUDE_CONFIG_DIR="${config}"\nexport BISMUTH_HOME="${home}"\nunset BISMUTH_API CLAUDE_RELAY_URL\nexport BISMUTH_VAULT="${d.copy}"\nif [ "$1" = history ] && [ "$2" != show ]; then case " $* " in *" --on"*|*" --since"*|*" --until"*|*" --days"*|*" --all "*) ;; *) set -- "$@" --all ;; esac; fi\n${gatedExec(process.execPath, d.cli, d.searchGate)}`)
    chmodSync(join(bin, 'bismuth'), 0o755)
    return bin
}

/** Build the vault copy's meaning index, its chat index and the docs index once, in `indexHome` (BISMUTH_HOME for this process), so nothing reaches the
 *  real cache and no agent's first `bismuth docs search` starts a build. The chat index is warmed from a config dir holding links to every session; each
 *  case later sees its own subset. The model's child process is let go at the end: nothing in this process embeds after this. */
export async function buildMeaningIndex(d: Pick<CaseDirs, 'copy' | 'logs' | 'indexHome' | 'realModels'>, sessions: string[], log: (s: string) => void, perCallMs = 10 * 60_000, giveUpMs = 3 * 3600_000) {
    mkdirSync(join(d.indexHome, 'cache'), { recursive: true })
    if (d.realModels && existsSync(d.realModels) && !existsSync(join(d.indexHome, 'models'))) symlinkSync(d.realModels, join(d.indexHome, 'models'))
    const chatConfig = join(d.indexHome, 'chat-config')
    const chatDir = join(chatConfig, 'projects', encodeProjectDir(d.copy))
    mkdirSync(chatDir, { recursive: true })
    for (const sid of sessions) {
        const f = join(d.logs, `${sid}.jsonl`)
        if (existsSync(f) && !existsSync(join(chatDir, `${sid}.jsonl`))) symlinkSync(resolve(f), join(chatDir, `${sid}.jsonl`))
    }
    const saved = { home: process.env.BISMUTH_HOME, config: process.env.CLAUDE_CONFIG_DIR }
    process.env.BISMUTH_HOME = d.indexHome
    process.env.CLAUDE_CONFIG_DIR = chatConfig
    try {
        const { vaultSemanticSearch } = await import('../core/src/vaultEmbed')
        const { chatSemanticSearch } = await import('../core/src/chatEmbed')
        const until = async (what: string, f: () => Promise<unknown>) => {
            const started = Date.now()
            for (;;) {
                const r = await f()
                if (Array.isArray(r)) return log(`${what} index ready (${Math.round((Date.now() - started) / 1000)}s)`)
                const u = r as { unavailable?: string; message?: string }
                if (u.unavailable !== 'warming') throw new Error(`${what} index cannot be built here: ${u.unavailable} ${u.message ?? ''}`)
                log(`${what}: ${u.message}`)
                if (Date.now() - started > giveUpMs) throw new Error(`${what} index did not finish in ${giveUpMs / 60_000} minutes`)
            }
        }
        await until('vault', () => vaultSemanticSearch(d.copy, 'index', { k: 1, deny: [], build: true, waitMs: perCallMs }))
        await until('chat', () => chatSemanticSearch(d.copy, 'index', { k: 1, channel: 'chat', build: true, waitMs: perCallMs }))
        const { docsIndexReady } = await import('../core/src/docsEmbed')
        const docsStarted = Date.now()
        let giveUp: ReturnType<typeof setTimeout> | undefined
        const docs = await Promise.race([docsIndexReady(), new Promise<'late'>(res => (giveUp = setTimeout(() => res('late'), giveUpMs)))])
        clearTimeout(giveUp)
        if (docs !== true) throw new Error(`docs index cannot be built here: ${docs === 'late' ? `not finished in ${giveUpMs / 60_000} minutes` : 'no docs root, no embedder, or the pass failed'}`)
        log(`docs index ready (${Math.round((Date.now() - docsStarted) / 1000)}s)`)
    } finally {
        const [{ configureVaultEmbed }, { configureChatEmbed }, { configureDocsEmbed }, { sharedSemanticChannel }] = await Promise.all([import('../core/src/vaultEmbed'), import('../core/src/chatEmbed'), import('../core/src/docsEmbed'), import('../core/src/memoryEmbed')])
        configureVaultEmbed()
        configureChatEmbed()
        configureDocsEmbed()
        sharedSemanticChannel().embedder()?.dispose()
        if (saved.home === undefined) delete process.env.BISMUTH_HOME
        else process.env.BISMUTH_HOME = saved.home
        if (saved.config === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = saved.config
    }
}

export type SearchRun = { exitCode: number | null; stderr: string; timedOut: boolean }
/** Run a case's `bismuth` with these arguments; the seam a test replaces. */
export type SearchExec = (bin: string, args: string[], timeoutMs: number) => Promise<SearchRun>

/** Per attempt, queue time included. A search past this is broken, not slow. */
const WARM_TIMEOUT_MS = 5 * 60_000
const WARM_ATTEMPTS = 2

/** The wrapper in its own process group, so a timeout takes the CLI and its embedding worker down with it. */
export const execCaseSearch = (cwd: string): SearchExec => (bin, args, timeoutMs) =>
    new Promise(done => {
        const p = spawn(join(bin, 'bismuth'), args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
        let stderr = ''
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            try {
                process.kill(-p.pid!, 'SIGKILL')
            } catch {}
        }, timeoutMs)
        p.stderr!.on('data', d => (stderr += d))
        p.on('error', e => {
            clearTimeout(timer)
            done({ exitCode: null, stderr: String(e), timedOut })
        })
        p.on('close', code => {
            clearTimeout(timer)
            done({ exitCode: code, stderr, timedOut })
        })
    })

/** Run each case's own search once before any agent does, and check it was answered by meaning, not keywords. This does the case's first-use work (its
 *  private chat store drops the sessions the case may not see) and proves its tools work. `workers` is the gate's slot count, so no attempt waits in the
 *  queue. A case that still falls back after its attempts is dropped: its agents would get worse tools by chance. */
export async function warmCases(list: { id: number; bin: string }[], o: { workers: number; exec: SearchExec; log: (s: string) => void; attempts?: number; timeoutMs?: number }) {
    const ready = new Set<number>()
    const dropped: { id: number; why: string }[] = []
    const wallMs: number[] = []
    await pool(list, o.workers, async c => {
        let why = ''
        for (let attempt = 1; attempt <= (o.attempts ?? WARM_ATTEMPTS); attempt++) {
            const started = Date.now()
            const r = await o.exec(c.bin, ['search', 'index'], o.timeoutMs ?? WARM_TIMEOUT_MS)
            wallMs.push(Date.now() - started)
            why = r.timedOut ? 'timeout' : r.exitCode !== 0 ? `exit ${r.exitCode}` : ([...r.stderr.matchAll(FALLBACK_LINE)][0]?.[1] ?? '')
            if (!why) return void ready.add(c.id)
            o.log(`  case ${c.id}: search attempt ${attempt} not warm (${why})`)
        }
        dropped.push({ id: c.id, why })
    })
    return { ready, dropped, wallMs }
}

/** The cases and jobs left once the cases whose search would not warm are gone. */
export function withoutDropped<J extends { caseId: number }, C extends { id: number }>(cases: C[], jobs: J[], dropped: { id: number }[]): { cases: C[]; jobs: J[] } {
    const out = new Set(dropped.map(d => d.id))
    return { cases: cases.filter(c => !out.has(c.id)), jobs: jobs.filter(j => !out.has(j.caseId)) }
}

/** The warm-up, as the reports carry it: counts and reasons only. */
export function warmReport(w: Awaited<ReturnType<typeof warmCases>>, skippedAllRunsCached: number) {
    const droppedByReason: Record<string, number> = {}
    for (const d of w.dropped) droppedByReason[d.why] = (droppedByReason[d.why] ?? 0) + 1
    const sorted = [...w.wallMs].sort((a, b) => a - b)
    return { checked: w.ready.size + w.dropped.length, ready: w.ready.size, dropped: w.dropped.length, droppedByReason, skippedAllRunsCached, medianSeconds: sorted.length ? sorted[Math.floor(sorted.length / 2)]! / 1000 : null, maxSeconds: sorted.length ? sorted[sorted.length - 1]! / 1000 : null }
}

/** Per arm: the runs, the searches their agents made, how many of those fell back to keywords, and how many runs saw at least one fallback. */
export function searchFallbacksByArm<A extends string>(arms: readonly A[], rows: { arm: A; run: RunResult | undefined }[]) {
    return Object.fromEntries(
        arms.map(arm => {
            const rs = rows.filter(r => r.arm === arm && r.run).map(r => r.run!)
            return [arm, { runs: rs.length, searches: rs.reduce((a, r) => a + r.searches, 0), fellBack: rs.reduce((a, r) => a + r.searchFallbacks, 0), runsWithFallback: rs.filter(r => r.searchFallbacks > 0).length }]
        }),
    ) as Record<A, { runs: number; searches: number; fellBack: number; runsWithFallback: number }>
}

/** What a session's log yields for each of its cases: whether the agent's turn after the prompt only read, and the conversation before it. */
export function scanSession(session: string, text: string, vault: string, lines: CaseLine[]): { line: CaseLine; ok: ReturnType<typeof lookupVerdict>; convo: string }[] {
    const logLines = text.split('\n')
    const all = parseReplaySession(session, text, vault, new Set()).cases
    return lines.map(cl => {
        const here = all.find(x => x.at === cl.at && x.prompt === cl.prompt)
        const idx = here ? all.indexOf(here) : -1
        const uses = here ? toolUsesBetween(logLines, here.line + 1, all[idx + 1]?.line ?? Infinity) : null
        const ok = lookupVerdict(cl.prompt, uses)
        return { line: cl, ok, convo: ok.keep && here ? conversationOf(logLines, here.line) : '' }
    })
}

if (import.meta.main) {
    const argv = process.argv.slice(2)
    const flag = (n: string) => {
        const i = argv.indexOf(n)
        return i >= 0 ? argv[i + 1] : undefined
    }
    const need = (n: string) => {
        const v = flag(n)
        if (!v) {
            console.error('usage: bun bench/qualityReplay.ts --vault <dir> --from <replay dir> --judged <file> --logs <dir> --exchange <file> --out <dir> [--target 200] [--samples 2] [--pilot n] [--dry] [--concurrency n] [--agent-model m] [--judge-model m] [--reliance-model m] [--search-slots n] [--needles <needles.jsonl>] [--write <model.json>]')
            process.exit(2)
        }
        return resolve(v)
    }
    const needlesPath = flag('--needles') ? resolve(flag('--needles')!) : null
    const vault = need('--vault')
    const from = need('--from')
    const judgedPath = need('--judged')
    const logs = need('--logs')
    const exchangePath = need('--exchange')
    const out = need('--out')
    const target = Number(flag('--target') ?? 200)
    const samples = Math.max(1, Number(flag('--samples') ?? 2))
    const pilot = flag('--pilot') ? Math.max(1, Number(flag('--pilot'))) : null
    const dry = argv.includes('--dry')
    const models = { agent: flag('--agent-model') ?? DEFAULT_MODEL, judge: flag('--judge-model') ?? DEFAULT_MODEL, reliance: flag('--reliance-model') ?? DEFAULT_MODEL }
    const workers = flag('--concurrency') ? Math.max(1, Number(flag('--concurrency'))) : judgePoolSize(cpus().length, totalmem(), 600 * 1024 * 1024, 8)
    // a sweep runs for hours: keep the machine from idling to sleep while this process lives (a closed lid still sleeps; runWithRetry reruns what that cost)
    if (!dry) watchSleep()
    if (process.platform === 'darwin' && !dry && Bun.which('caffeinate')) Bun.spawn(['caffeinate', '-ims', '-w', String(process.pid)], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
    const slots = flag('--search-slots') ? Math.max(1, Number(flag('--search-slots'))) : searchSlots(cpus().length, totalmem(), workers)
    mkdirSync(out, { recursive: true })
    const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`)
    const copy = join(out, 'vault-copy')
    const indexHome = join(out, 'index-home')
    const realModels = join(homedir(), '.bismuth', 'models')

    // ---- cases: every session with a log; the sessions' logs are read in a pool and dropped once scanned
    const caseLines = readJsonl<CaseLine>(join(from, 'cases.jsonl'))
    const cases: CaseInfo[] = caseLines.map((c, i) => ({ id: i + 1, set: c.set, session: c.session }))
    const judged = readJsonl<Judged>(judgedPath)
    const sessions = [...new Set(cases.map(c => c.session))]
    // the history a prompt would really have had is every log in --logs, not only the sessions that have cases; the train/validation/test
    // split stays on the sessions with cases
    const firstPrompt = new Map(sessions.map(s => [s, Math.min(...caseLines.filter(c => c.session === s).map(c => Date.parse(c.at)))]))
    const starts = allSessionStarts(logs, firstPrompt)
    const caseStarts = new Map(sessions.map(s => [s, starts.get(s)!]))
    const scans = new Map<number, ReturnType<typeof scanSession>[number]>()
    await pool(sessions, workers, async s => {
        const f = join(logs, `${s}.jsonl`)
        if (!existsSync(f)) return
        const mine = caseLines.map((c, i) => ({ c, id: i + 1 })).filter(x => x.c.session === s)
        const res = scanSession(s, await readFile(f, 'utf8'), vault, mine.map(x => x.c))
        res.forEach((r, i) => scans.set(mine[i]!.id, r))
    })
    const split = splitSessions(caseStarts)
    const dropped: Record<string, number> = {}
    const droppedDetail: Record<string, number> = {}
    const eligible: EvalCase[] = []
    let quietExcluded = 0
    for (const c of cases) {
        if (c.set === 'quiet') {
            quietExcluded++
            continue
        }
        const sc = scans.get(c.id)
        const v = sc?.ok ?? lookupVerdict(caseLines[c.id - 1]!.prompt, null)
        if (v.keep) eligible.push({ id: c.id, session: c.session, set: c.set as EvalCase['set'], heldOut: split.test.has(c.session) })
        else {
            dropped[v.why] = (dropped[v.why] ?? 0) + 1
            const k = `${v.why}: ${v.detail}`
            droppedDetail[k] = (droppedDetail[k] ?? 0) + 1
        }
    }
    const picked = pickRoundRobin(eligible, target)
    const chosen = pilot ? picked.slice(0, pilot) : picked

    // ---- arms, offline from the saved features and the shipped gate
    const currentPath = flag('--current')
    const model = currentPath ? loadGateModel(JSON.parse(readFileSync(resolve(currentPath), 'utf8'))) : loadGateModel()
    const textOf = (id: number, key: string) => caseLines[id - 1]!.candItems.find(x => x.key === key)?.text ?? ''
    const rowsOf = (id: number): EvalRow[] => judged.filter(c => c.id === id).map(c => ({ id: c.id, set: c.set, path: c.path, session: c.session, key: c.key, kind: c.features.kind, cosine: c.features.cosine, features: c.features, matched: c.matched, y: labelOfJudged(c) }))
    const candsOf = (id: number): Cand[] => {
        const rows = rowsOf(id)
        const acc = new Set(injectedBy(rows, r => gateAccepts(r.features, model)).map(r => r.key))
        const seen = new Set<string>()
        return rows.filter(r => (seen.has(r.key) ? false : (seen.add(r.key), true))).map(r => ({ key: r.key, kind: r.kind, cosine: r.cosine, text: textOf(id, r.key), y: r.y, matched: r.matched, accepted: acc.has(r.key) }))
    }
    // over every picked case, not just the pilot's, so a pilot and the full sweep give a gate-shut case's junk arm the same k (and the same cached run)
    const kFallback = meanFired(picked.map(c => gateKeys(candsOf(c.id)).length))
    const startedDate = (key: string) => (key.startsWith('chat:') && starts.get(key.slice(5)) ? new Date(starts.get(key.slice(5))!).toLocaleDateString('en-CA') : undefined)
    const clean = (s: string) => s.split(vault).join(copy)
    // the cutoff is the prompt's session start, not the prompt's time: a prompt's own session started before it, and its log holds the turns after the prompt
    const inputOf = (c: EvalCase): CaseInput => {
        const cl = caseLines[c.id - 1]!
        return { id: c.id, session: c.session, set: c.set, heldOut: c.heldOut, at: cl.at, prompt: cl.prompt, convo: clean(scans.get(c.id)?.convo ?? ''), visible: historyVisible(starts, caseStarts.get(c.session) ?? Date.parse(cl.at)), cands: candsOf(c.id), dates: startedDate }
    }
    let inputs = chosen.map(inputOf)
    let jobs = buildJobs(inputs, { samples, agentModel: models.agent, copy, kFallback })
    const plan = planWork(jobs, inputs.map(c => c.id))
    const fullPlan = pilot ? planWork(buildJobs(picked.map(inputOf), { samples, agentModel: models.agent, copy, kFallback }), picked.map(c => c.id)) : plan
    const selection = { sessionsWithCases: sessions.length, sessionsWithLog: sessions.filter(s => existsSync(join(logs, `${s}.jsonl`))).length, quietExcluded, eligible: eligible.length, eligibleSessions: new Set(eligible.map(c => c.session)).size, target, picked: picked.length, chosen: chosen.length, chosenSessions: new Set(chosen.map(c => c.session)).size, heldOut: chosen.filter(c => c.heldOut).length, dropped, droppedDetail, kFallback }
    log(`eligible ${selection.eligible} in ${selection.eligibleSessions} sessions; chosen ${selection.chosen} in ${selection.chosenSessions} sessions, ${selection.heldOut} held out; models ${JSON.stringify(models)}`)

    const needles = needlesPath && !pilot ? parseNeedles(readFileSync(needlesPath, 'utf8')) : []
    let needleBuilt = buildNeedleJobs(needles, starts, { samples, agentModel: models.agent })
    const needlePlan = planNeedles(needleBuilt.jobs)
    if (needlesPath && pilot) log('--pilot runs no needles')
    else if (needlesPath) log(`needles: ${needles.length} questions, ${needleBuilt.skipped.length} skipped; planned ${JSON.stringify(needlePlan)}`)

    if (dry) {
        const sample = jobs.find(j => j.arm === 'references' && j.keys.length) ?? jobs[0]
        if (sample) console.log(`--- sample message (${sample.arm})\n${sample.message.slice(0, 2000)}`)
        console.log(JSON.stringify({ ...selection, meaningIndex: readEmbeddingsEnabledSync(vault) ? 'embeddings on in the vault settings; built once on the copy under --out' : 'EMBEDDINGS OFF in the vault settings: bismuth search would be keyword-only', samples, workers, planned: plan, plannedAtTarget: fullPlan, plannedNeedles: needlesPath ? (pilot ? 'none: --pilot runs no needles' : { ...needlePlan, skipped: needleBuilt.skipped }) : null }, null, 2))
        process.exit(0)
    }

    // ---- the vault copy, a clone (copy-on-write); everything under --out that links or indexes goes with it
    const cleanup = () => {
        if (!argv.includes('--keep-copy')) rmSync(copy, { recursive: true, force: true })
        // links only: rmSync does not follow a symlink, so the logs and the model cache they point at stay
        for (const d of ['bin', 'history-config', 'case-home', 'index-home', 'search-gate']) rmSync(join(out, d), { recursive: true, force: true })
    }
    process.on('exit', cleanup)
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(130))
    if (!existsSync(copy)) {
        log('cloning the vault')
        const r = Bun.spawnSync(['cp', '-cR', vault, copy])
        if (r.exitCode !== 0) throw new Error(`clone failed: ${r.stderr.toString()}`)
        rmSync(join(copy, '.git'), { recursive: true, force: true })
    }
    const dirs: CaseDirs = { out, copy, logs, indexHome, realModels, cli: join(import.meta.dir, '..', 'cli', 'src', 'index.ts'), searchGate: { dir: join(out, 'search-gate'), slots } }
    log(`search slots ${slots} (${workers} agent workers)`)
    if (!argv.includes('--probe-guard')) await buildMeaningIndex(dirs, [...starts.keys()], log)
    const binDirs = new Map<number, string>()
    for (const c of inputs) binDirs.set(c.id, prepareCase(dirs, c.id, c.visible))
    for (const j of needleBuilt.jobs) if (!binDirs.has(j.caseId)) binDirs.set(j.caseId, prepareCase(dirs, j.caseId, j.visible))
    const runner: Runner = {
        agent: c => runAgent(c.message, copy, binDirs.get(c.caseId)!, c.model, c.system),
        ask: (m, system, text, timeoutMs, lookup) => ask(m, system, text, copy, timeoutMs, lookup),
    }

    // the guard probe: one agent told to read outside the clone with shell commands the permission system would approve
    // unasked; it runs on the hook alone (no canUseTool) to show the hook is what refuses them
    if (argv.includes('--probe-guard')) {
        const msg = 'Run these two shell commands with the Bash tool and paste their raw output: `cat ~/.claude/CLAUDE.md | head -5` and `ls /`. Then run `cat /etc/hosts`. If a command is refused, say so and carry on.'
        const bin = prepareCase(dirs, 0, [])
        const r = await runAgent(msg, copy, bin, models.agent, AGENT_SYSTEM, true)
        const probe = { hookOnly: true, status: r.status, toolCalls: r.toolCalls, denied: r.denied, tools: r.tools, denials: r.denials, answer: r.answer.slice(0, 600) }
        writeFileSync(join(out, 'guard-probe.json'), JSON.stringify(probe, null, 2) + '\n')
        console.log(JSON.stringify(probe, null, 2))
        process.exit(r.denied >= r.toolCalls && r.toolCalls > 0 ? 0 : 1)
    }

    // every case's search answers by meaning before its agents start; a case with runs still to make that will not warm is dropped, and counted
    const doneRuns = new Set([...loadCache<RunResult>(join(out, 'runs.jsonl')).keys(), ...loadCache<RunResult>(join(out, 'needle-runs.jsonl')).keys()])
    const pending = new Set([...jobs, ...needleBuilt.jobs].filter(j => !doneRuns.has(j.runKey)).map(j => j.caseId))
    const toWarm = [...binDirs].filter(([id]) => pending.has(id)).map(([id, bin]) => ({ id, bin }))
    log(`warming ${toWarm.length} cases' search, ${binDirs.size - toWarm.length} have every run cached`)
    const warmed = await warmCases(toWarm, { workers: slots, exec: execCaseSearch(copy), log })
    const searchWarm = warmReport(warmed, binDirs.size - toWarm.length)
    log(`search warm: ${JSON.stringify(searchWarm)}`)
    ;({ cases: inputs, jobs } = withoutDropped(inputs, jobs, warmed.dropped))
    needleBuilt = { ...needleBuilt, jobs: withoutDropped([], needleBuilt.jobs, warmed.dropped).jobs }
    if (!inputs.length) throw new Error('no case has a working search: nothing to run')

    const res = await sweep({ dir: out, jobs, cases: inputs, runner, models, workers, log })
    const draws = (n: number) => bootstrapDraws(n, 2000, 20261107)
    const usage = usageReport(res, jobs, inputs.length, Math.min(target, eligible.length))

    if (pilot) {
        const outcomes = Object.fromEntries([...COMPARED, 'control' as const].map(a => [a, armSummary(a, res, inputs, 2000).outcomes]))
        const report = { ...usage, needles: 'none run: --pilot runs no needles', planned: plan, plannedAtTarget: fullPlan, models, outcomes, failures: res.failures, searchWarm, searchFallbacks: searchFallbacksByArm(REAL_ARMS, jobs.filter(j => !j.control).map(j => ({ arm: j.arm, run: res.runs.get(j.runKey) }))) }
        writeFileSync(join(out, 'pilot-usage.json'), JSON.stringify(report, null, 2) + '\n')
        console.log(JSON.stringify(report, null, 2))
        process.exit(0)
    }

    const needleRes = needlesPath ? await needleSweep({ dir: out, jobs: needleBuilt.jobs, runner, models, workers, log }) : null
    if (needleRes) needleRes.failures.push(...needleBuilt.skipped)

    // ---- rows: sample 1 in quality.jsonl, later samples in quality-samples.jsonl
    const caseOf = new Map(inputs.map(c => [c.id, c]))
    const relOf = (j: Job) => res.verdicts.get(res.rels.find(r => r.job.runKey === j.runKey)?.key ?? '') as Rec<{ relied: number[] }> | undefined
    const irrelevantOf = (j: Job) => new Set(j.keys.map((k, i) => { const x = caseOf.get(j.caseId)!.cands.find(y => y.key === k); return x?.y === 0 && !x?.matched ? i + 1 : 0 }).filter(Boolean))
    const first: unknown[] = []
    const later: unknown[] = []
    for (const j of jobs.filter(x => !x.control)) {
        const c = caseOf.get(j.caseId)!
        const r = res.runs.get(j.runKey)
        const row: Record<string, unknown> = { caseId: j.caseId, session: c.session, prompt: c.prompt, at: c.at, heldOut: c.heldOut, arm: j.arm, sample: j.sample + 1, injected: j.keys, run: r ?? null }
        if (j.arm !== 'none') {
            const p = res.pairs.find(x => x.arm === j.arm && x.caseId === j.caseId && x.sample === j.sample)
            const v = p && pairVerdict(p, res.verdicts)
            if (v) {
                const relied = relOf(j)?.r.relied ?? null
                const bad = irrelevantOf(j)
                row.vs = { outcome: v.outcome, orders: v.orders, reasons: v.reasons, byConstruction: v.byConstruction, relied, misled: !!relied && relied.some(i => bad.has(i)) }
            }
        }
        ;(j.sample === 0 ? first : later).push(row)
    }
    writeFileSync(join(out, 'quality.jsonl'), first.map(r => JSON.stringify(r)).join('\n') + '\n')
    writeFileSync(join(out, 'quality-samples.jsonl'), later.map(r => JSON.stringify(r)).join('\n') + (later.length ? '\n' : ''))
    writeFileSync(join(out, 'control.jsonl'), res.pairs.filter(p => p.arm === 'control').map(p => JSON.stringify({ caseId: p.caseId, session: caseOf.get(p.caseId)!.session, ...pairVerdict(p, res.verdicts) })).join('\n') + '\n')

    // ---- summary, junk cost, refit. The refit is fed by the held-out prompts' references and junk rows of sample 1
    const heldOnly = inputs.filter(c => c.heldOut)
    const pairRows = (arm: 'references' | 'junk'): PairRow[] =>
        heldOnly.flatMap(c => {
            const p = res.pairs.find(x => x.arm === arm && x.caseId === c.id && x.sample === 0)
            const v = p && pairVerdict(p, res.verdicts)
            if (!p || !v) return []
            const [n, r] = [res.runs.get(p.base.runKey)!, res.runs.get(p.other.runKey)!]
            const rel = relOf(p.other)
            const bad = irrelevantOf(p.other)
            const isHit = p.other.keys.some(k => { const x = c.cands.find(y => y.key === k); return !!x && (c.set === 'labelled' ? x.matched : x.y === 1) })
            return [{ caseId: c.id, session: c.session, outcome: v.outcome, items: p.other.keys.length, dTokens: r.tokens - n.tokens, dTokensAll: r.tokensAll - n.tokensAll, dToolCalls: r.toolCalls - n.toolCalls, dTurns: r.turns - n.turns, misled: !!rel && rel.r.relied.some(i => bad.has(i)), hit: isHit, junkItems: p.other.keys.filter(k => { const x = c.cands.find(y => y.key === k); return x?.y === 0 && !x?.matched }).length }]
        })
    const pairs = { gate: pairRows('references'), junk: pairRows('junk') }
    const blockStat = (arm: 'references' | 'junk') => {
        const acc = { items: 0, tokens: 0, chars: 0 }
        for (const c of heldOnly) {
            const a = jobs.find(j => j.caseId === c.id && j.arm === arm && j.sample === 0)!
            const n = jobs.find(j => j.caseId === c.id && j.arm === 'none' && j.sample === 0)!
            const [pa, pn] = [res.probes.get(probeKey(models.agent, a.message)), res.probes.get(probeKey(models.agent, n.message))]
            if (!pa || !pn || !a.keys.length) continue
            acc.items += a.keys.length
            acc.tokens += pa.n - pn.n
            acc.chars += a.message.length - n.message.length
        }
        return acc
    }
    const [jb, gb] = [blockStat('junk'), blockStat('references')]
    const ex = JSON.parse(readFileSync(exchangePath, 'utf8')) as { lambda: number; meanOutputTokensPerTurn: number; fetch: { total: number }; item: { tokens: number } }
    const allRuns = [...res.runs.values()]
    const sumU = (f: (r: RunResult) => number) => allRuns.reduce((a, r) => a + f(r), 0)
    const directTokens = jb.items ? jb.tokens / jb.items : ex.item.tokens
    const turnTokens = sumU(r => r.usage.output_tokens ?? 0) / Math.max(1, sumU(r => r.turns))
    const costBase = junkCost(pairs.junk, { directTokens, turnTokens, fetchTokens: 0 }, draws)
    const saved = savedPerHit(pairs.gate, { junkTokensPerItem: directTokens + costBase.extraTokensPerItem.point, turnTokens }, draws)
    const cost = junkCost(pairs.junk, { directTokens, turnTokens, fetchTokens: saved.saved.point }, draws)
    const lambdaRange = saved.saved.lo > 0 && cost.costTokensPerItem.lo > 0 ? { lo: saved.saved.lo / cost.costTokensPerItem.hi, hi: saved.saved.hi / cost.costTokensPerItem.lo } : { lo: null, hi: null, note: 'the saving or the cost has an interval that reaches zero, so the ratio is not bounded' }
    const rows: EvalRow[] = judged.map(c => ({ id: c.id, set: c.set, path: c.path, session: c.session, key: c.key, kind: c.features.kind, cosine: c.features.cosine, features: c.features, matched: c.matched, y: labelOfJudged(c) }))
    const rateMeasured = saved.hitCases > 0 && Number.isFinite(cost.lambda) && cost.lambda > 0
    const refit = rateMeasured ? refitOnJunkCost({ rows, split, cases, current: model, lambdaOld: ex.lambda, lambdaNew: cost.lambda, draws: draws(split.test.size) }) : null
    const keep = keepModel(refit, () => refitOnJunkCost({ rows, split, cases, current: model, lambdaOld: ex.lambda, lambdaNew: ex.lambda, draws: draws(split.test.size) }), model)
    const keptRow = keep.ship ? keep.shippedRow : keep.current
    const refitAt = flag('--refit-at') ? Number(flag('--refit-at')) : null
    const refitReference = refitAt ? refitOnJunkCost({ rows, split, cases, current: model, lambdaOld: ex.lambda, lambdaNew: refitAt, draws: draws(split.test.size) }) : null
    const arms = Object.fromEntries(COMPARED.map(a => [a, { ...armSummary(a, res, inputs, 2000), ...(BLOCK_ARMS.includes(a) ? { referencesOpenedShare: openedShare(a, res, jobs, copy) } : {}) }]))
    const summary = {
        models,
        tools: 'Read, Grep, Glob (real paths held inside the vault copy; Glob and Grep patterns relative) and Bash limited to read-only `bismuth` commands (no --vault, no outside paths); enforced by a PreToolUse hook callback, which fires for auto-approved calls too, and repeated in canUseTool; settingSources [], no settings hooks. `bismuth search` is the blended search on a meaning index built once on the copy, with searches queued on a slot count sized from the machine; `bismuth history` shows only the sessions that started before the case',
        limits: ['the vault copy is today\'s vault, so an older prompt can see notes written after it, equally in every arm', 'samples of one prompt share a session; the session intervals keep a session together, the prompt intervals do not'],
        selection,
        searchWarm,
        searchFallbacks: searchFallbacksByArm(REAL_ARMS, jobs.filter(j => !j.control).map(j => ({ arm: j.arm, run: res.runs.get(j.runKey) }))),
        failures: res.failures,
        ...(needleRes ? { needles: needleSummary(needleRes, samples) } : {}),
        arms,
        control: armSummary('control', res, inputs, 2000),
        refitFeed: { rows: 'the held-out prompts\' references and junk arms, sample 1 only', references: pairs.gate.length, junk: pairs.junk.length, heldOutPrompts: heldOnly.length },
        gateVsNone: summarizePairs(pairs.gate, draws),
        junkVsNone: summarizePairs(pairs.junk, draws),
        junkCost: cost,
        measured: {
            junkItemTokens: directTokens,
            charsPerToken: jb.tokens ? jb.chars / jb.tokens : null,
            gateItemTokens: gb.items ? gb.tokens / gb.items : null,
            outputTokensPerTurn: turnTokens,
            savedPerHit: saved,
            lambda: { old: ex.lambda, oldInputs: { fetchTokens: ex.fetch.total, itemTokens: ex.item.tokens }, new: cost.lambda, newInputs: { savedTokensPerHit: saved.saved.point, junkCostTokensPerItem: cost.costTokensPerItem.point }, range: lambdaRange },
        },
        spend: { runs: allRuns.length, costUsd: sumU(r => r.costUsd), tokens: sumU(r => r.tokens), tokensAll: sumU(r => r.tokensAll), meanTokensPerRun: sumU(r => r.tokens) / Math.max(1, allRuns.length), meanSecondsPerRun: sumU(r => r.durationMs) / Math.max(1, allRuns.length) / 1000, statuses: Object.fromEntries(['ok', 'max_turns'].map(s => [s, allRuns.filter(r => r.status === s).length])), usage },
        armTotals: Object.fromEntries(REAL_ARMS.map(a => [a, (() => { const rs = jobs.filter(j => j.arm === a && !j.control).map(j => res.runs.get(j.runKey)).filter((r): r is RunResult => !!r); return { runs: rs.length, meanTokens: rs.reduce((x, r) => x + r.tokens, 0) / Math.max(1, rs.length), meanToolCalls: rs.reduce((x, r) => x + r.toolCalls, 0) / Math.max(1, rs.length), meanTurns: rs.reduce((x, r) => x + r.turns, 0) / Math.max(1, rs.length), deniedCalls: rs.reduce((x, r) => x + r.denied, 0) } })()])),
        refit: refit ? { ...refit, model: undefined, shipped: undefined } : null,
        refitReference: refitReference ? { ...refitReference, model: undefined, shipped: undefined, note: `the refit at a stated rate ${refitAt}, not a measured one; reference only` } : null,
        keptModel: { threshold: model.threshold, rateMeasured, row: keptRow },
    }
    writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log(JSON.stringify(summary, null, 2))

    // the model file always gets the shipped model's own numbers: the refit when it beat the current model on the validation
    // sessions at both rates, else the current model, with the measurement and the reason recorded beside it
    const write = flag('--write')
    if (write) {
        const target = resolve(write)
        const old = JSON.parse(readFileSync(target, 'utf8')) as { fusion?: unknown; fitOn: GateModel['fitOn'] }
        const m = keep.shipped
        const previousFitOn = currentPath ? (JSON.parse(readFileSync(resolve(currentPath), 'utf8')) as { fitOn: GateModel['fitOn'] }).fitOn : old.fitOn
        const fitOn = shippedFitOn(previousFitOn, { ...keep, ship: keep.ship }, {
            measuredRate: rateMeasured ? cost.lambda : null, savedTokensPerHit: saved.saved.point, junkCostTokensPerItem: cost.costTokensPerItem.point, at: new Date().toISOString().slice(0, 10) })
        writeFileSync(target, JSON.stringify({ version: 1, weights: m.weights, bias: m.bias, threshold: m.threshold, fitOn, ...(old.fusion ? { fusion: old.fusion } : {}) }, null, 2) + '\n')
        log(`wrote ${target} (${keep.ship ? 'the refit' : 'the current model kept'})`)
    } else log('model not written (no --write)')
    process.exit(0)
}
