// Quality replay: does what recall injects make the agent's answer better or worse?
//   bun bench/qualityReplay.ts --vault <dir> --from <replay dir> --judged <candidates-judged.jsonl> --logs <claude project dir>
//       --exchange <exchange-rate.json> --out <dir> [--n 60] [--concurrency n] [--write core/src/sourceGateModel.json]
// Cases are question/lookup prompts (the agent's turn after them only read) of the time-ordered test sessions
// of the gate fit (bench/gateAB.ts's split). Every case runs three arms, each a real Sonnet agent through the
// user's `claude` login on a copy of the vault, from the conversation the prompt had:
//   none  no sources block      gate  the sources the shipped gate injects (pack-capped, offline over the saved features)
//   junk  as many candidates the judge marked irrelevant (the gate's own junk first)
// Only the sources block differs. Opus compares gate vs none and junk vs none blind (order hashed from the
// case); Sonnet says which injected items an answer relied on, and an answer that relies on a judged-irrelevant
// item is `misled`. The junk-vs-none comparison gives the cost of a junk item, which refits the gate's
// exchange rate (bench/fitSourceGate.ts refitOnJunkCost). Every run and verdict is cached under --out, keyed by
// what it was given, so a rerun resumes. The vault copy is a clone made under --out and removed at the end;
// the vault and the logs are only read. Outputs hold your prompts: keep --out out of the repo.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { gateAccepts, loadGateModel, type GateModel } from '../core/src/sourceGate'
import { encodeProjectDir } from '../memory/src/sessionHistory'
import { extractText, stripInjectedBlocks } from '../memory/src/transcript'
import { parseReplaySession, judgePoolSize, type ReplayCase } from './recallReplayCases'
import { refitOnJunkCost, shippedFitOn, type CandRow } from './fitSourceGate'
import { sessionStart } from './gateAB'
import { bootstrapDraws, injectedBy, splitSessions, type CaseInfo, type EvalRow } from './gateEval'
import { labelOfJudged } from './fitSourceGate'
import {
    armIsA,
    bismuthAllowed,
    gateKeys,
    hashOf,
    hashOrder,
    policyHook,
    toolPolicy,
    junkCost,
    junkKeys,
    historySessions,
    keepModel,
    lookupVerdict,
    meanFired,
    outcomeOf,
    parsePairwise,
    jsonIn,
    savedPerHit,
    sourcesBlock,
    summarizePairs,
    toolUsesBetween,
    type Cand,
    type PairRow,
} from './qualityReplayCases'

export const AGENT_MODEL = 'claude-sonnet-5-5'
export const PAIRWISE_MODEL = 'claude-opus-5-5'
export const RELIANCE_MODEL = 'claude-sonnet-5-5'
const AGENT_MAX_TURNS = 30
const AGENT_TIMEOUT_MS = 10 * 60_000

const AGENT_SYSTEM = [
    "You are the assistant in the user's Bismuth vault: a folder of markdown notes, PDFs and images, with a `bismuth` command line.",
    'Answer the user\'s latest message. Your tools are read-only: Read, Grep, Glob, and Bash for `bismuth` read commands only',
    '(`bismuth read <note>`, `bismuth docs list|read|search`, `bismuth search <pattern> --regex`, `bismuth task list`, `bismuth map`, `bismuth brain`).',
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

type Usage = { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number }
type Msg = { type: string; subtype?: string; result?: string; usage?: Usage; num_turns?: number; total_cost_usd?: number; duration_ms?: number; is_error?: boolean; model?: string; message?: { id?: string; usage?: Usage; content?: { type?: string; name?: string; input?: Record<string, unknown> }[] } }

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

type RunResult = {
    status: 'ok' | 'max_turns' | 'timeout' | 'error'
    answer: string
    toolCalls: number
    turns: number
    tools: { name: string; arg: string }[]
    denied: number
    /** Each refused call and why (the PreToolUse hook's and the permission callback's). */
    denials: { tool: string; arg: string; why: string }[]
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
}

const loadCache = <T,>(path: string): Map<string, T> => {
    const m = new Map<string, T>()
    if (existsSync(path))
        for (const l of readFileSync(path, 'utf8').split('\n'))
            try {
                const j = JSON.parse(l)
                m.set(j.k, j.v)
            } catch {}
    return m
}

const argOf = (i: Record<string, unknown> | undefined): string => {
    const v = i?.command ?? i?.file_path ?? i?.pattern ?? i?.path ?? i?.args
    return String(Array.isArray(v) ? v.join(' ') : (v ?? '')).slice(0, 140)
}

/** Run one agent turn on the vault copy. `denied` counts tool calls the guard refused. The guard is a PreToolUse hook
 *  callback, which fires for every call, including the read-only shell commands the permission system approves
 *  without asking; `canUseTool` repeats the same policy unless `hookOnly` (the guard probe) is set. */
async function runAgent(userMessage: string, copy: string, binDir: string, hookOnly = false): Promise<RunResult> {
    const { query, bin, env } = await loadSdk()
    const started = Date.now()
    const res: RunResult = { status: 'error', answer: '', toolCalls: 0, turns: 0, tools: [], denied: 0, denials: [], usage: {}, tokens: 0, tokensAll: 0, costUsd: 0, durationMs: 0, model: AGENT_MODEL }
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
                model: AGENT_MODEL,
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
                systemPrompt: AGENT_SYSTEM,
                abortController: abort,
            },
        })
        for await (const m of stream) {
            if (m.type === 'assistant') {
                if (m.message?.usage) lastCall = m.message.usage
                for (const b of m.message?.content ?? []) if (b.type === 'tool_use') (res.toolCalls++, res.tools.push({ name: b.name ?? '?', arg: argOf(b.input) }))
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
    return res
}

/** Run jobs on a pool of workers. */
async function pool<T>(items: T[], workers: number, f: (x: T, i: number) => Promise<void>) {
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

type CaseLine = { set: EvalRow['set']; session: string; at: string; prompt: string; candItems: { key: string; text: string }[] }
type Judged = CandRow

const readJsonl = <T,>(path: string): T[] =>
    readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as T)

// `none2` repeats `none` with the same message: the noise floor, what the judge says about two runs that differ only by sampling
const ARMS = ['none', 'none2', 'gate', 'junk'] as const
type Arm = (typeof ARMS)[number]

if (import.meta.main) {
    const argv = process.argv.slice(2)
    const flag = (n: string) => {
        const i = argv.indexOf(n)
        return i >= 0 ? argv[i + 1] : undefined
    }
    const need = (n: string) => {
        const v = flag(n)
        if (!v) {
            console.error('usage: bun bench/qualityReplay.ts --vault <dir> --from <replay dir> --judged <file> --logs <dir> --exchange <file> --out <dir> [--n 60] [--concurrency n] [--write <model.json>]')
            process.exit(2)
        }
        return resolve(v)
    }
    const vault = need('--vault')
    const from = need('--from')
    const judgedPath = need('--judged')
    const logs = need('--logs')
    const exchangePath = need('--exchange')
    const out = need('--out')
    const nWanted = Number(flag('--n') ?? 60)
    const workers = flag('--concurrency') ? Math.max(1, Number(flag('--concurrency'))) : judgePoolSize(cpus().length, totalmem(), 600 * 1024 * 1024, 8)
    mkdirSync(out, { recursive: true })
    const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`)

    // ---- cases: the test split, question/lookup prompts only
    const caseLines = readJsonl<CaseLine>(join(from, 'cases.jsonl'))
    const cases: CaseInfo[] = caseLines.map((c, i) => ({ id: i + 1, set: c.set, session: c.session }))
    const judged = readJsonl<Judged>(judgedPath)
    const sessions = [...new Set(cases.map(c => c.session))]
    const starts = new Map<string, number>()
    for (const s of sessions) {
        const f = join(logs, `${s}.jsonl`)
        const first = Math.min(...caseLines.filter(c => c.session === s).map(c => Date.parse(c.at)))
        starts.set(s, (existsSync(f) ? sessionStart(f) : null) ?? first)
    }
    const split = splitSessions(starts)
    const logLines = new Map<string, string[]>()
    const parsed = new Map<string, ReplayCase[]>()
    for (const s of split.test) {
        const f = join(logs, `${s}.jsonl`)
        if (!existsSync(f)) continue
        const text = readFileSync(f, 'utf8')
        logLines.set(s, text.split('\n'))
        parsed.set(s, parseReplaySession(s, text, vault, new Set()).cases)
    }
    type Kept = { id: number; line: CaseLine; at: string; lineNo: number }
    const dropped: Record<string, number> = {}
    const droppedDetail: Record<string, number> = {}
    const kept: Kept[] = []
    for (const c of cases.filter(c => split.test.has(c.session))) {
        const cl = caseLines[c.id - 1]!
        const all = parsed.get(c.session)
        const here = all?.find(x => x.at === cl.at && x.prompt === cl.prompt)
        let uses = null
        if (all && here) {
            const idx = all.indexOf(here)
            const end = all[idx + 1]?.line ?? Infinity
            uses = toolUsesBetween(logLines.get(c.session)!, here.line + 1, end)
        }
        const v = lookupVerdict(cl.prompt, uses)
        if (v.keep) kept.push({ id: c.id, line: cl, at: cl.at, lineNo: here!.line })
        else {
            dropped[v.why] = (dropped[v.why] ?? 0) + 1
            const k = `${v.why}: ${v.detail}`
            droppedDetail[k] = (droppedDetail[k] ?? 0) + 1
        }
    }
    const order = hashOrder(kept.map(k => k.id))
    const chosenIds = new Set(order.slice(0, nWanted))
    const chosen = kept.filter(k => chosenIds.has(k.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    log(`test cases ${cases.filter(c => split.test.has(c.session)).length}, kept ${kept.length}, running ${chosen.length}; dropped ${JSON.stringify(dropped)}`)

    // ---- arms, offline from the saved features and the shipped gate
    // the model that is shipped now: the gate arm injects what it accepts, and the refit has to beat it. --current names its file (default: the bundled model)
    const currentPath = flag('--current')
    const model = currentPath ? loadGateModel(JSON.parse(readFileSync(resolve(currentPath), 'utf8'))) : loadGateModel()
    const textOf = (id: number, key: string) => caseLines[id - 1]!.candItems.find(x => x.key === key)?.text ?? ''
    const rowsOf = (id: number): EvalRow[] => judged.filter(c => c.id === id).map(c => ({ id: c.id, set: c.set, session: c.session, key: c.key, kind: c.features.kind, cosine: c.features.cosine, features: c.features, matched: c.matched, y: labelOfJudged(c) }))
    const candsOf = (id: number): Cand[] => {
        const rows = rowsOf(id)
        const acc = new Set(injectedBy(rows, r => gateAccepts(r.features, model)).map(r => r.key))
        const seen = new Set<string>()
        return rows
            .filter(r => (seen.has(r.key) ? false : (seen.add(r.key), true)))
            .map(r => ({ key: r.key, kind: r.kind, cosine: r.cosine, text: textOf(id, r.key), y: r.y, matched: r.matched, accepted: acc.has(r.key) }))
    }
    const gateCounts = chosen.map(k => gateKeys(candsOf(k.id)).length)
    const kFallback = meanFired(gateCounts)
    log(`gate injects ${gateCounts.filter(n => n > 0).length}/${chosen.length} cases; junk arm uses k=${kFallback} where the gate is shut`)

    // ---- the vault copy, a clone (copy-on-write), and the bismuth wrapper
    const copy = join(out, 'vault-copy')
    const binDir = join(out, 'bin')
    // the clone holds the whole vault, .daemon included, so it goes on every way out: normal end, process.exit, a crash, a signal
    const cleanup = () => {
        if (!argv.includes('--keep-copy')) rmSync(copy, { recursive: true, force: true })
        rmSync(binDir, { recursive: true, force: true })
        // links only: rmSync does not follow a symlink, so the logs they point at stay
        rmSync(join(out, 'history-config'), { recursive: true, force: true })
    }
    process.on('exit', cleanup)
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(130))

    if (!existsSync(copy) && !argv.includes('--dry')) {
        log('cloning the vault')
        const r = Bun.spawnSync(['cp', '-cR', vault, copy])
        if (r.exitCode !== 0) throw new Error(`clone failed: ${r.stderr.toString()}`)
        rmSync(join(copy, '.git'), { recursive: true, force: true })
    }
    mkdirSync(binDir, { recursive: true })
    // `bismuth history show` reads <CLAUDE_CONFIG_DIR>/projects/<encoded cwd>/<id>.jsonl (cli/src/commands/history.ts sessionsDir), so the
    // wrapper points it at a directory holding links to the train and validation logs only; the agent's own process is untouched
    const historyConfig = join(out, 'history-config')
    const historyDir = join(historyConfig, 'projects', encodeProjectDir(copy))
    mkdirSync(historyDir, { recursive: true })
    for (const id of historySessions(split, sessions)) {
        const f = join(logs, `${id}.jsonl`)
        if (existsSync(f)) symlinkSync(resolve(f), join(historyDir, `${id}.jsonl`))
    }
    writeFileSync(join(binDir, 'bismuth'), `#!/bin/sh\nexport CLAUDE_CONFIG_DIR="${historyConfig}"\nexec "${process.execPath}" "${join(import.meta.dir, '..', 'cli', 'src', 'index.ts')}" "$@"\n`)
    chmodSync(join(binDir, 'bismuth'), 0o755)
    // the guard probe: one agent told to read outside the clone with shell commands the permission system would approve
    // unasked; it runs on the hook alone (no canUseTool) to show the hook is what refuses them
    if (argv.includes('--probe-guard')) {
        const msg = 'Run these two shell commands with the Bash tool and paste their raw output: `cat ~/.claude/CLAUDE.md | head -5` and `ls /`. Then run `cat /etc/hosts`. If a command is refused, say so and carry on.'
        const r = await runAgent(msg, copy, binDir, true)
        const probe = { hookOnly: true, status: r.status, toolCalls: r.toolCalls, denied: r.denied, tools: r.tools, denials: r.denials, answer: r.answer.slice(0, 600) }
        writeFileSync(join(out, 'guard-probe.json'), JSON.stringify(probe, null, 2) + '\n')
        console.log(JSON.stringify(probe, null, 2))
        process.exit(r.denied >= r.toolCalls && r.toolCalls > 0 ? 0 : 1)
    }

    // ---- the message each arm's agent gets
    const clean = (s: string) => s.split(vault).join(copy)
    const conversation = (c: Kept): string => {
        const lines = logLines.get(c.line.session)!.slice(Math.max(0, c.lineNo - 400), c.lineNo)
        const turns: string[] = []
        for (const l of lines) {
            try {
                const e = JSON.parse(l) as { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: never }
                if (e.isSidechain || e.isMeta || (e.type !== 'user' && e.type !== 'assistant')) continue
                const t = stripInjectedBlocks(extractText(e.message)).trim()
                if (t) turns.push(`${e.type}: ${t.slice(0, 700)}`)
            } catch {}
        }
        return clean(turns.slice(-8).join('\n\n').slice(-5000))
    }
    const startedDate = (key: string) => (key.startsWith('chat:') && starts.get(key.slice(5)) ? new Date(starts.get(key.slice(5))!).toLocaleDateString('en-CA') : undefined)
    type Job = { c: Kept; arm: Arm; keys: string[]; message: string; runKey: string }
    const jobs: Job[] = []
    for (const c of chosen) {
        const cands = candsOf(c.id)
        const byKey = new Map(cands.map(x => [x.key, x]))
        const gate = gateKeys(cands)
        const junk = junkKeys(cands, gate.length || kFallback)
        const convo = conversation(c)
        const today = c.at.slice(0, 10)
        for (const arm of ARMS) {
            const keys = arm === 'none' || arm === 'none2' ? [] : arm === 'gate' ? gate : junk
            const block = keys.length ? sourcesBlock(keys.map(k => ({ cand: byKey.get(k)!, date: startedDate(k) })), copy) : null
            const message = [`Today is ${today}.`, convo ? `<conversation-so-far>\n${convo}\n</conversation-so-far>` : '', block ? `<bismuth-memory>\n${clean(block)}</bismuth-memory>` : '', c.line.prompt].filter(Boolean).join('\n\n')
            jobs.push({ c, arm, keys, message, runKey: hashOf(`${AGENT_MODEL}\u0000${AGENT_SYSTEM}\u0000${message}${arm === 'none2' ? '\u0000replicate' : ''}\u0000guard2`) })
        }
    }

    if (argv.includes('--dry')) {
        const sample = jobs.find(j => j.arm === 'gate' && j.keys.length) ?? jobs[0]!
        console.log(`--- sample message (${sample.arm})\n${sample.message.slice(0, 3000)}`)
        console.log(JSON.stringify({ kept: kept.length, chosen: chosen.length, dropped, droppedDetail, workers, kFallback, gateCounts }))
        process.exit(0)
    }

    const jobOf = (id: number, arm: Arm) => jobs.find(j => j.c.id === id && j.arm === arm)!

    // ---- phase 1: the agent runs (identical messages run once)
    const runsPath = join(out, 'runs.jsonl')
    const runs = loadCache<RunResult>(runsPath)
    const todo = [...new Map(jobs.filter(j => !runs.has(j.runKey)).map(j => [j.runKey, j])).values()]
    log(`agent runs: ${todo.length} to run of ${new Set(jobs.map(j => j.runKey)).size} distinct (${jobs.length} arm-cases), ${workers} workers`)
    let done = 0
    let spent = 0
    await pool(todo, workers, async j => {
        let r = await runAgent(j.message, copy, binDir)
        if (r.status === 'error' || r.status === 'timeout') r = await runAgent(j.message, copy, binDir)
        if (r.status === 'ok' || r.status === 'max_turns') {
            runs.set(j.runKey, r)
            appendFileSync(runsPath, JSON.stringify({ k: j.runKey, v: r }) + '\n')
        }
        spent += r.costUsd
        log(`  [${++done}/${todo.length}] case ${j.c.id} ${j.arm} ${r.status} calls ${r.toolCalls} turns ${r.turns} tokens ${r.tokens} ${Math.round(r.durationMs / 1000)}s  ($${spent.toFixed(2)} so far)`)
    })

    // ---- phase 1b: what each sources block costs, measured. One reply-"ok" turn per distinct message; the first-turn input
    // tokens (fresh + cache write + cache read) of an arm's message less the same case's none message are the block's tokens.
    const probesPath = join(out, 'probes.jsonl')
    const probes = loadCache<number>(probesPath)
    const probeKey = (m: string) => hashOf(`probe\u0000${AGENT_MODEL}\u0000${PROBE_SYSTEM}\u0000${m}`)
    const probeTodo = [...new Set(jobs.filter(j => j.arm === 'none' || j.keys.length).map(j => j.message))].filter(m => !probes.has(probeKey(m)))
    log(`token probes: ${probeTodo.length} to run`)
    await pool(probeTodo, workers, async m => {
        const r = await ask(AGENT_MODEL, PROBE_SYSTEM, m, copy)
        if (!r) return
        const n = (r.usage.input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0)
        probes.set(probeKey(m), n)
        appendFileSync(probesPath, JSON.stringify({ k: probeKey(m), v: n }) + '\n')
    })
    const blockTokens = (c: Kept, arm: Arm): { tokens: number; chars: number } | null => {
        const a = jobOf(c.id, arm)
        const n = jobOf(c.id, 'none')
        const [pa, pn] = [probes.get(probeKey(a.message)), probes.get(probeKey(n.message))]
        return pa === undefined || pn === undefined || !a.keys.length ? null : { tokens: pa - pn, chars: a.message.length - n.message.length }
    }

    // ---- phase 2: blind pairwise verdicts and reliance
    const verdictsPath = join(out, 'verdicts.jsonl')
    const verdicts = loadCache<unknown>(verdictsPath)
    const trace = (r: RunResult) => r.tools.slice(0, 12).map(t => `- ${t.name} ${t.arg}`).join('\n') || '(no tool calls)'
    type Cmp = { c: Kept; arm: 'gate' | 'junk' | 'none2'; none: Job; armJob: Job; a: Job; b: Job; key: string; text: string }
    const cmps: Cmp[] = []
    for (const c of chosen)
        for (const arm of ['gate', 'junk', 'none2'] as const) {
            const none = jobOf(c.id, 'none')
            const armJob = jobOf(c.id, arm)
            if (arm !== 'none2' && (!armJob.keys.length || armJob.runKey === none.runKey)) continue
            const ra = runs.get(none.runKey)
            const rb = runs.get(armJob.runKey)
            if (!ra || !rb) continue
            const [a, b] = armIsA(c.id, arm) ? [armJob, none] : [none, armJob]
            const [ta, tb] = [runs.get(a.runKey)!, runs.get(b.runKey)!]
            const text = `Conversation so far (data):\n<conversation>${conversation(c)}</conversation>\n\nUser message:\n<message>${c.line.prompt.slice(0, 2000)}</message>\n\n=== Answer A ===\nLooked at:\n${trace(ta)}\n\nFinal reply:\n${ta.answer.slice(0, 6000)}\n\n=== Answer B ===\nLooked at:\n${trace(tb)}\n\nFinal reply:\n${tb.answer.slice(0, 6000)}`
            cmps.push({ c, arm, none, armJob, a, b, text, key: hashOf(`pair\u0000${PAIRWISE_MODEL}\u0000${PAIRWISE_SYSTEM}\u0000${text}`) })
        }
    type Rel = { cmp: Cmp; text: string; key: string }
    const rels: Rel[] = cmps.filter(c => c.arm !== 'none2').map(cmp => {
        const items = cmp.armJob.keys.map((k, i) => `${i + 1}. ${k}\n${(candsOf(cmp.c.id).find(x => x.key === k)?.text ?? '').slice(0, 600)}`).join('\n\n')
        const r = runs.get(cmp.armJob.runKey)!
        const text = `Items placed in context:\n${items}\n\nAssistant's tool trace:\n${trace(r)}\n\nAssistant's final answer:\n${r.answer.slice(0, 6000)}`
        return { cmp, text, key: hashOf(`rel\u0000${RELIANCE_MODEL}\u0000${RELIANCE_SYSTEM}\u0000${text}`) }
    })
    type Verdict = { better: 'A' | 'B' | 'tie'; reason: string }
    const todoV = [...cmps.filter(c => !verdicts.has(c.key)).map(c => ({ kind: 'pair' as const, key: c.key, model: PAIRWISE_MODEL, system: PAIRWISE_SYSTEM, text: c.text })), ...rels.filter(r => !verdicts.has(r.key)).map(r => ({ kind: 'rel' as const, key: r.key, model: RELIANCE_MODEL, system: RELIANCE_SYSTEM, text: r.text }))]
    log(`verdicts: ${todoV.length} to ask of ${cmps.length + rels.length}`)
    let judgeSpend = 0
    await pool(todoV, workers, async v => {
        const r = await ask(v.model, v.system, v.text, copy, v.kind === 'pair' ? 420_000 : 180_000, v.kind === 'pair')
        if (!r) return
        judgeSpend += r.cost
        const parsed = v.kind === 'pair' ? parsePairwise(r.text) : { relied: ((jsonIn(r.text)?.relied as unknown[]) ?? []).map(Number).filter(Number.isFinite) }
        if (!parsed) return
        verdicts.set(v.key, parsed)
        appendFileSync(verdictsPath, JSON.stringify({ k: v.key, v: parsed }) + '\n')
    })

    // ---- rows
    const rowsOut: unknown[] = []
    const pairs: Record<'gate' | 'junk' | 'none2', PairRow[]> = { gate: [], junk: [], none2: [] }
    const failures: string[] = []
    const blockStats: Record<'gate' | 'junk' | 'none2', { items: number; tokens: number; chars: number }[]> = { gate: [], junk: [], none2: [] }
    const noneOf = (id: number) => runs.get(jobOf(id, 'none').runKey)
    for (const c of chosen) {
        const n = noneOf(c.id)
        const cands = candsOf(c.id)
        for (const arm of ARMS) {
            const j = jobOf(c.id, arm)
            const r = runs.get(j.runKey)
            const base = { caseId: c.id, session: c.line.session, at: c.at, prompt: c.line.prompt, arm, injected: j.keys, junkInjected: j.keys.filter(k => cands.find(x => x.key === k)?.y === 0), run: r ? { ...r, answer: r.answer } : null }
            if (arm === 'none' || !r || !n) {
                if (!r || !n) failures.push(`case ${c.id} ${arm}`)
                rowsOut.push(base)
                continue
            }
            const cmp = cmps.find(x => x.c.id === c.id && x.arm === arm)
            if (!cmp) {
                // nothing injected, or the same message as none: the same run, a tie with zero deltas by construction
                rowsOut.push({ ...base, vs: { outcome: 'tie', byConstruction: true } })
                pairs[arm].push({ caseId: c.id, session: c.line.session, outcome: 'tie', items: 0, dTokens: 0, dTokensAll: 0, dToolCalls: 0, dTurns: 0, misled: false, hit: false, junkItems: 0 })
                continue
            }
            const v = verdicts.get(cmp.key) as Verdict | undefined
            const rel = arm === 'none2' ? undefined : (verdicts.get(rels.find(x => x.cmp === cmp)!.key) as { relied: number[] } | undefined)
            if (!v) {
                failures.push(`case ${c.id} ${arm} verdict`)
                rowsOut.push(base)
                continue
            }
            const outcome = outcomeOf(v.better, armIsA(c.id, arm))
            const irrelevant = new Set(j.keys.map((k, i) => (cands.find(x => x.key === k)?.y === 0 && !cands.find(x => x.key === k)?.matched ? i + 1 : 0)).filter(Boolean))
            const misled = !!rel && rel.relied.some(i => irrelevant.has(i))
            rowsOut.push({ ...base, vs: { outcome, reason: v.reason, armWasA: armIsA(c.id, arm), relied: rel?.relied ?? null, misled } })
            const isHit = j.keys.some(k => {
                const x = cands.find(y => y.key === k)
                return !!x && (c.line.set === 'labelled' ? x.matched : c.line.set === 'past' || c.line.set === 'time' ? x.y === 1 : false)
            })
            const bt = blockTokens(c, arm)
            if (bt) blockStats[arm].push({ items: j.keys.length, ...bt })
            pairs[arm].push({ caseId: c.id, session: c.line.session, outcome, items: j.keys.length, dTokens: r.tokens - n.tokens, dTokensAll: r.tokensAll - n.tokensAll, dToolCalls: r.toolCalls - n.toolCalls, dTurns: r.turns - n.turns, misled, hit: isHit, junkItems: j.keys.filter(k => cands.find(y => y.key === k)?.y === 0 && !cands.find(y => y.key === k)?.matched).length })
        }
    }
    writeFileSync(join(out, 'quality.jsonl'), rowsOut.map(r => JSON.stringify(r)).join('\n') + '\n')

    // ---- summary, junk cost, refit
    const draws = (n: number) => bootstrapDraws(n, 2000, 20261107)
    const ex = JSON.parse(readFileSync(exchangePath, 'utf8')) as { lambda: number; meanOutputTokensPerTurn: number; fetch: { total: number }; item: { tokens: number } }
    const firing = (rs: PairRow[]) => rs.filter(r => r.items > 0)
    const allRuns = [...runs.values()]
    const sumU = (f: (r: RunResult) => number) => allRuns.reduce((a, r) => a + f(r), 0)
    // measured on this run, not estimated from the logs: tokens one injected item costs (the probes), characters per token,
    // and output tokens per assistant turn (the replayed agents' own usage)
    const sumB = (a: { items: number; tokens: number; chars: number }[]) => ({ items: a.reduce((x, b) => x + b.items, 0), tokens: a.reduce((x, b) => x + b.tokens, 0), chars: a.reduce((x, b) => x + b.chars, 0) })
    const jb = sumB(blockStats.junk)
    const gb = sumB(blockStats.gate)
    const directTokens = jb.items ? jb.tokens / jb.items : ex.item.tokens
    const turnTokens = sumU(r => r.usage.output_tokens ?? 0) / Math.max(1, sumU(r => r.turns))
    const costBase = junkCost(pairs.junk, { directTokens, turnTokens, fetchTokens: 0 }, draws)
    const saved = savedPerHit(pairs.gate, { junkTokensPerItem: directTokens + costBase.extraTokensPerItem.point, turnTokens }, draws)
    const cost = junkCost(pairs.junk, { directTokens, turnTokens, fetchTokens: saved.saved.point }, draws)
    // a ratio is bounded only when both parts stay positive across their intervals
    const lambdaRange = saved.saved.lo > 0 && cost.costTokensPerItem.lo > 0 ? { lo: saved.saved.lo / cost.costTokensPerItem.hi, hi: saved.saved.hi / cost.costTokensPerItem.lo } : { lo: null, hi: null, note: 'the saving or the cost has an interval that reaches zero, so the ratio is not bounded' }
    const rows: EvalRow[] = judged.map(c => ({ id: c.id, set: c.set, session: c.session, key: c.key, kind: c.features.kind, cosine: c.features.cosine, features: c.features, matched: c.matched, y: labelOfJudged(c) }))
    // a rate needs a positive saving and a positive cost; without them there is nothing to refit at and the current model is kept
    const rateMeasured = saved.hitCases > 0 && Number.isFinite(cost.lambda) && cost.lambda > 0
    const refit = rateMeasured ? refitOnJunkCost({ rows, split, cases, current: model, lambdaOld: ex.lambda, lambdaNew: cost.lambda, draws: draws(split.test.size) }) : null
    // the current model's own numbers on the test sessions, for the kept model's fitOn (no refit is made: ship stays false)
    const keep = keepModel(refit, () => refitOnJunkCost({ rows, split, cases, current: model, lambdaOld: ex.lambda, lambdaNew: ex.lambda, draws: draws(split.test.size) }), model)
    const keptRow = keep.ship ? keep.shippedRow : keep.current
    // reference only: the refit at a stated rate (the first replay's, measured on runs that read outside the clone), scored the same way
    const refitAt = flag('--refit-at') ? Number(flag('--refit-at')) : null
    const refitReference = refitAt ? refitOnJunkCost({ rows, split, cases, current: model, lambdaOld: ex.lambda, lambdaNew: refitAt, draws: draws(split.test.size) }) : null
    const summary = {
        models: { agent: AGENT_MODEL, pairwise: PAIRWISE_MODEL, reliance: RELIANCE_MODEL },
        tools: 'Read, Grep, Glob (real paths held inside the vault copy; Glob and Grep patterns relative) and Bash limited to read-only `bismuth` commands (no --vault, no outside paths); enforced by a PreToolUse hook callback, which fires for auto-approved calls too, and repeated in canUseTool; settingSources [], no settings hooks',
        cases: { test: cases.filter(c => split.test.has(c.session)).length, kept: kept.length, ran: chosen.length, dropped, droppedDetail, gateFired: gateCounts.filter(n => n > 0).length, junkKWhereShut: kFallback },
        failures,
        gateVsNone: { all: summarizePairs(pairs.gate, draws), firingOnly: summarizePairs(firing(pairs.gate), draws) },
        noneVsNone: summarizePairs(pairs.none2, draws),
        junkVsNone: { all: summarizePairs(pairs.junk, draws), firingOnly: summarizePairs(firing(pairs.junk), draws) },
        junkCost: cost,
        measured: {
            junkItemTokens: directTokens,
            charsPerToken: jb.tokens ? jb.chars / jb.tokens : null,
            gateItemTokens: gb.items ? gb.tokens / gb.items : null,
            outputTokensPerTurn: turnTokens,
            savedPerHit: saved,
            lambda: { old: ex.lambda, oldInputs: { fetchTokens: ex.fetch.total, itemTokens: ex.item.tokens }, new: cost.lambda, newInputs: { savedTokensPerHit: saved.saved.point, junkCostTokensPerItem: cost.costTokensPerItem.point }, range: lambdaRange },
        },
        spend: { runs: allRuns.length, costUsd: sumU(r => r.costUsd), judgeCostUsd: judgeSpend, tokens: sumU(r => r.tokens), tokensAll: sumU(r => r.tokensAll), meanTokensPerRun: sumU(r => r.tokens) / Math.max(1, allRuns.length), meanSecondsPerRun: sumU(r => r.durationMs) / Math.max(1, allRuns.length) / 1000, statuses: Object.fromEntries(['ok', 'max_turns'].map(s => [s, allRuns.filter(r => r.status === s).length])) },
        armTotals: Object.fromEntries(ARMS.map(a => [a, (() => { const rs = chosen.map(c => runs.get(jobOf(c.id, a).runKey)).filter((r): r is RunResult => !!r); return { runs: rs.length, meanTokens: rs.reduce((x, r) => x + r.tokens, 0) / Math.max(1, rs.length), meanToolCalls: rs.reduce((x, r) => x + r.toolCalls, 0) / Math.max(1, rs.length), meanTurns: rs.reduce((x, r) => x + r.turns, 0) / Math.max(1, rs.length), deniedCalls: rs.reduce((x, r) => x + r.denied, 0) } })()])),
        refit: refit ? { ...refit, model: undefined, shipped: undefined } : null,
        refitReference: refitReference ? { ...refitReference, model: undefined, shipped: undefined, note: `the refit at a stated rate ${refitAt}, not a measured one; reference only` } : null,
        keptModel: { threshold: model.threshold, rateMeasured, row: keptRow },
    }
    writeFileSync(join(out, 'quality-summary.json'), JSON.stringify(summary, null, 2) + '\n')
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
