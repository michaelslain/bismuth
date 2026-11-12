// A made-up vault, and a known-answer test of how models use it.
//   bun bench/syntheticEval.ts --generate --out <dir> [--notes 120] [--questions 60] [--concurrency n]
//   bun bench/syntheticEval.ts --run --out <dir> [--models a,b,c] [--arms none,references,junk,search] [--limit n] [--concurrency n]
// --generate has Haiku invent one vault (people, projects, dated logs), questions with a known answer (needle,
// aggregate, unanswerable) and for each question related-but-wrong distractor notes. The prompts name nothing of the
// user's: no vault text, no logs, no ~/.claude. Questions that fail `validateSynth` are regenerated. Work is split into
// small batches in a pool; each lands in <out>/batches.jsonl, so a rerun resumes.
// --run asks each model every question under four arms and has Haiku grade the reply against the known answer:
//   none        the question alone
//   references  the question's evidence notes as a references block (the shipped `packSources` rendering)
//   junk        its distractor notes as the same kind of block
//   search      no block; SEARCH_FIRST is appended to the system prompt
// The arms are built on purpose, no real gate is involved. Every arm has the same tools: `bismuth search` (keyword
// search, the meaning index is off in this vault), `bismuth read` and the file readers. Zen models (the two free
// ones only) go through `runOpencode` under an OS read-deny of the real vault and ~/.claude; Claude is Haiku only.
// The summary has one row per model and arm and no pass line.
// Results (runs.jsonl, summary.json) live in --out; the agents' files sit in /private/tmp/bismuth-synth-<hash> when --out is
// under the home folder, since opencode's server answers 500 from there (`underHome` in opencodeAgent.ts).
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, homedir, tmpdir, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runOpencode, underHome } from './opencodeAgent'
import { SEARCH_FIRST, openedReferences, policyHook, toolPolicy } from './qualityReplayCases'
import { judgePoolSize } from './recallReplayCases'
import {
    GRADER_SYSTEM,
    SYNTH_ARMS,
    graderText,
    givenPaths,
    messageFor,
    parseBible,
    parseGrade,
    parseNotes,
    parseQuestions,
    referencesBlock,
    rejectedIds,
    scoreRow,
    slugOf,
    summarize,
    validateSynth,
    type Bible,
    type SynthArm,
    type SynthQuestion,
    type SynthRow,
    type SynthVault,
} from './syntheticVault'

export const HAIKU = 'claude-haiku-5-5'
export const ZEN_MODELS = ['opencode/glm-5.3-flash-free', 'opencode/deepseek-v4.1-flash-free']
export const REAL_VAULT = '/Users/m/Documents/library of alexandria'
const DEFAULT_MODELS = [HAIKU, ...ZEN_MODELS]
const KINDS = ['needle', 'aggregate', 'unanswerable'] as const

export type AskFn = (system: string, text: string) => Promise<string | null>

const hash = (s: string): string => new Bun.CryptoHasher('sha1').update(s).digest('hex').slice(0, 10)
const hashNum = (s: string): number => parseInt(hash(s), 16)

// ---- the sdk -------------------------------------------------------------------------------------

type Msg = { type: string; subtype?: string; result?: string; message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] } }
let sdk: Promise<{ query: (a: unknown) => AsyncIterable<Msg>; bin: string; env: () => Record<string, string | undefined> }> | null = null
const loadSdk = () =>
    (sdk ??= (async () => {
        const { whichClaude, claudeSpawnEnv } = await import('../core/src/claudeWhich')
        const bin = whichClaude()
        if (!bin) throw new Error('claude binary not found')
        const { query } = await import('../core/node_modules/@anthropic-ai/claude-agent-sdk')
        return { query: query as never, bin, env: () => claudeSpawnEnv() as never }
    })())

/** One Haiku reply, no tools; null on failure or timeout. */
export const haikuAsk = (timeoutMs = 180_000): AskFn => async (system, text) => {
    const { query, bin, env } = await loadSdk()
    for (let attempt = 1; attempt <= 2; attempt++) {
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), timeoutMs)
        try {
            let out = ''
            const stream = query({ prompt: text, options: { model: HAIKU, pathToClaudeCodeExecutable: bin, cwd: process.cwd(), env: env(), tools: [], maxTurns: 1, persistSession: false, settingSources: [], systemPrompt: system, abortController: abort } })
            for await (const m of stream) if (m.type === 'result' && m.subtype === 'success') out = m.result ?? ''
            if (out) return out
        } catch {
            // retry once
        } finally {
            clearTimeout(timer)
        }
    }
    return null
}

const argOf = (i: Record<string, unknown> | undefined): string => String(i?.command ?? i?.file_path ?? i?.pattern ?? i?.path ?? '').slice(0, 200)

type AgentRun = { status: 'ok' | 'failed'; answer: string; tools: { name: string; arg: string }[]; durationMs: number }

/** One Haiku agent turn on the vault with the replay's read-only guard rooted at the made-up vault. */
async function runClaudeAgent(system: string, message: string, vaultDir: string, binDir: string, timeoutMs: number): Promise<AgentRun> {
    const { query, bin, env } = await loadSdk()
    const started = Date.now()
    const tools: AgentRun['tools'] = []
    let answer = ''
    let ok = false
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    const guard = async (name: string, input: Record<string, unknown>) => {
        const v = toolPolicy(vaultDir, name, input)
        return v.ok ? { behavior: 'allow' as const, updatedInput: input } : { behavior: 'deny' as const, message: v.why }
    }
    async function* input() {
        yield { type: 'user', message: { role: 'user', content: message }, parent_tool_use_id: null, session_id: '' }
    }
    try {
        const e = env()
        const stream = query({
            prompt: input(),
            options: {
                model: HAIKU,
                pathToClaudeCodeExecutable: bin,
                cwd: vaultDir,
                env: { ...e, PATH: `${binDir}:${e.PATH ?? ''}` },
                tools: ['Read', 'Grep', 'Glob', 'Bash'],
                hooks: { PreToolUse: [{ hooks: [policyHook(vaultDir, () => {})] }] },
                canUseTool: guard,
                permissionMode: 'default',
                maxTurns: 14,
                persistSession: false,
                settingSources: [],
                systemPrompt: system,
                abortController: abort,
            },
        })
        for await (const m of stream) {
            if (m.type === 'assistant') {
                for (const b of m.message?.content ?? []) if (b.type === 'tool_use') tools.push({ name: b.name ?? '?', arg: argOf(b.input) })
            } else if (m.type === 'result') {
                ok = m.subtype === 'success'
                answer = m.result ?? ''
            }
        }
    } catch {
        ok = false
    } finally {
        clearTimeout(timer)
    }
    return { status: ok && answer.trim() ? 'ok' : 'failed', answer, tools, durationMs: Date.now() - started }
}

// ---- pools and the batch store ---------------------------------------------------------------------

async function pool<T>(items: T[], workers: number, f: (x: T, i: number) => Promise<void>) {
    let next = 0
    await Promise.all(
        Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, async () => {
            for (;;) {
                const i = next++
                if (i >= items.length) return
                await f(items[i]!, i)
            }
        }),
    )
}

/** An append-only keyed store: `get` returns what an earlier run saved, `put` appends at once. */
export function openStore<T>(path: string) {
    const m = new Map<string, T>()
    if (existsSync(path))
        for (const l of readFileSync(path, 'utf8').split('\n'))
            try {
                const j = JSON.parse(l)
                m.set(j.k, j.v)
            } catch {}
    mkdirSync(dirname(path), { recursive: true })
    return {
        get: (k: string) => m.get(k),
        has: (k: string) => m.has(k),
        all: () => [...m.values()],
        put(k: string, v: T) {
            m.set(k, v)
            appendFileSync(path, JSON.stringify({ k, v }) + '\n')
        },
    }
}

const withTimeout = async <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const r = await Promise.race([p.catch(() => fallback), new Promise<T>(res => (timer = setTimeout(() => res(fallback), ms)))])
    clearTimeout(timer)
    return r
}

// ---- generation prompts (invented content only) --------------------------------------------------------

export const BIBLE_SYSTEM =
    'You invent the cast for a fictional small organisation, for a test. Everything is made up: use invented first and last names that belong to no one real, and invented project names (one or two words, not real products or companies). ' +
    'Reply with JSON only: {"projects":[{"name":"...","summary":"one sentence"}],"people":[{"name":"First Last","role":"...","project":"exact name of one listed project"}]}. Names must be unique. Write exactly the counts asked for.'

export const NOTES_SYSTEM =
    'You write notes for a fictional personal work vault, for a test. Everything is invented; use only the names in the cast you are given. Each note is markdown of 80 to 200 words that starts with a "# " title line and states several specific facts plainly: numbers, dates, room or floor numbers, amounts, decisions and who made them, names. ' +
    'Give every note its own distinct facts; do not repeat one fact across notes. Write one note per item asked for. Reply with JSON only: {"notes":[{"for":"<the item key>","text":"<the markdown>"}]}.'

const QUESTION_RULES: Record<(typeof KINDS)[number], string> = {
    needle:
        'Write needle questions. Each asks for ONE specific fact written in ONE of the given notes. The answer is a short phrase copied exactly, character for character, from that note. The question must not contain the answer. "evidence" lists that note\'s path.',
    aggregate:
        'Write aggregate questions. Each can only be answered by combining facts from at least two of the given notes (a total, a change over time, who did what across dates). The answer is one or two sentences. "evidence" lists the paths of every note needed (at least two).',
    unanswerable:
        'Write unanswerable questions. Each is plausible for these notes, on the same people, projects and dates, but NONE of the given notes states the answer, and it cannot be worked out from them. "answer" is omitted and "evidence" is [].',
}

export const questionSystem = (kind: (typeof KINDS)[number], n: number): string =>
    `You write test questions about a fictional notes vault, for a test. You are given some notes, each with its path. ${QUESTION_RULES[kind]} ` +
    `For every question also write 2 "distractors": short notes (40 to 100 words, markdown, "# " title line) on the same topic as the question that a keyword search for it would find, but that give a different, outdated or unrelated value, and that never state the right answer or any part of it. ` +
    `Write exactly ${n} questions. Reply with JSON only: {"questions":[{"question":"...","answer":"...","evidence":["path"],"distractors":["note text","note text"]}]}.`

// ---- generation ---------------------------------------------------------------------------------------

export type GenerateOptions = { out: string; notes: number; questions: number; concurrency: number; timeoutMs: number; ask: AskFn }
type NoteJob = { keys: string[]; items: { key: string; what: string }[]; project?: string }
type QBatch = { questions: SynthQuestion[]; notes: { path: string; text: string }[]; distractors: Record<string, string[]> }

const addDays = (start: string, d: number): string => new Date(Date.parse(start) + d * 86_400_000).toISOString().slice(0, 10)
const cast = (b: Bible): string => `PROJECTS:\n${b.projects.map(p => `- ${p.name}: ${p.summary}`).join('\n')}\nPEOPLE:\n${b.people.map(p => `- ${p.name}, ${p.role}, on ${p.project}`).join('\n')}`

/** The note jobs for a cast: people and project notes in chunks of 6, one dated-log job per project. */
export function noteJobs(b: Bible, total: number): NoteJob[] {
    const jobs: NoteJob[] = []
    const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
    for (const g of chunk(b.people, 6)) jobs.push({ keys: g.map(p => `people/${slugOf(p.name)}.md`), items: g.map(p => ({ key: `people/${slugOf(p.name)}.md`, what: `a profile of the person ${p.name}, ${p.role}, on ${p.project}` })) })
    for (const g of chunk(b.projects, 6)) jobs.push({ keys: g.map(p => `projects/${slugOf(p.name)}.md`), items: g.map(p => ({ key: `projects/${slugOf(p.name)}.md`, what: `the project page for ${p.name} (${p.summary}): goals, budget, owner, milestones` })) })
    const logs = Math.max(b.projects.length, total - b.people.length - b.projects.length)
    b.projects.forEach((p, j) => {
        const n = Math.floor(logs / b.projects.length) + (j < logs % b.projects.length ? 1 : 0)
        const items = Array.from({ length: n }, (_, k) => {
            const date = addDays('2026-01-05', j * 3 + k * 7)
            const key = `logs/${slugOf(p.name)}-${date}.md`
            return { key, what: `a work log for ${p.name} dated ${date}: what was done, decided and spent that day` }
        })
        jobs.push({ keys: items.map(i => i.key), items, project: p.name })
    })
    return jobs
}

const noteText = (j: NoteJob, b: Bible): string => `${cast(b)}\n\nWRITE THESE NOTES:\n${j.items.map(i => `- ${i.key}: ${i.what}`).join('\n')}`

const sampleNotes = (pool: { path: string; text: string }[], seed: string, n: number) => [...pool].sort((a, b) => hashNum(seed + a.path) - hashNum(seed + b.path)).slice(0, n)

/** Generate (or resume) the vault. Returns the validated vault with exactly the asked-for question counts when they could be met. */
export async function generateVault(o: GenerateOptions): Promise<{ vault: SynthVault; problems: string[]; short: Record<string, number> }> {
    const store = openStore<unknown>(join(o.out, 'batches.jsonl'))
    const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`)
    const ask = (system: string, text: string) => withTimeout(o.ask(system, text), o.timeoutMs, null)

    // 1. the cast
    const people = Math.max(3, Math.round(o.notes * 0.25))
    const projects = Math.max(2, Math.round(o.notes * 0.1))
    const bibleAsk = `Invent ${projects} projects and ${people} people (each on one of the projects).`
    let bible = store.get(`bible:${hash(bibleAsk)}`) as Bible | undefined
    for (let attempt = 0; !bible && attempt < 3; attempt++) {
        bible = parseBible(await ask(BIBLE_SYSTEM, bibleAsk)) ?? undefined
        if (bible) store.put(`bible:${hash(bibleAsk)}`, bible)
    }
    if (!bible) throw new Error('could not get a cast from the model')
    log(`cast: ${bible.projects.length} projects, ${bible.people.length} people`)

    // 2. notes, in small batches
    const noteMap = new Map<string, string>()
    const jobs = noteJobs(bible, o.notes)
    await pool(jobs, o.concurrency, async j => {
        const key = `notes:${hash(NOTES_SYSTEM + noteText(j, bible!))}`
        let got = store.get(key) as [string, string][] | undefined
        if (!got) {
            // a reply that cannot be read loses only the notes it held: ask again for the ones still missing, up to 3 times
            const have = new Map<string, string>()
            for (let attempt = 0; attempt < 3 && have.size < j.keys.length; attempt++) {
                const rest: NoteJob = { ...j, keys: j.keys.filter(k => !have.has(k)), items: j.items.filter(i => !have.has(i.key)) }
                const reply = await ask(NOTES_SYSTEM, noteText(rest, bible!))
                const m = parseNotes(reply, rest.keys)
                if (!m.size) appendFileSync(join(o.out, 'unreadable-replies.log'), `${new Date().toISOString()} ${rest.keys.join(',')}\n${reply ?? '(no reply)'}\n\n`)
                for (const [k, t] of m) have.set(k, t)
            }
            got = [...have.entries()]
            if (got.length) store.put(key, got)
        }
        for (const [k, t] of got) noteMap.set(k, t)
        log(`notes ${got.length}/${j.keys.length}`)
    })
    const baseNotes = [...noteMap.entries()].map(([path, text]) => ({ path, text }))
    log(`${baseNotes.length} notes`)

    // 3. questions, in small batches, with regeneration of what validateSynth rejects
    const target = { needle: Math.round(o.questions / 3), aggregate: Math.round(o.questions / 3), unanswerable: 0 }
    target.unanswerable = o.questions - target.needle - target.aggregate
    const all: QBatch = { questions: [], notes: [], distractors: {} }
    const kept = (kind: SynthQuestion['kind']) => all.questions.filter(q => q.kind === kind).length
    const vaultOf = (): SynthVault => ({ notes: [...baseNotes, ...all.notes], questions: all.questions, distractors: all.distractors })
    for (let round = 0; round < 4; round++) {
        const todo: { kind: (typeof KINDS)[number]; index: number; n: number }[] = []
        for (const kind of KINDS) {
            const need = target[kind] - kept(kind)
            for (let i = 0; i * 3 < need; i++) todo.push({ kind, index: i, n: Math.min(3, need - i * 3) })
        }
        if (!todo.length) break
        await pool(todo, o.concurrency, async t => {
            const seed = `${t.kind}:${round}:${t.index}`
            let src = sampleNotes(baseNotes, seed, 5)
            if (t.kind === 'aggregate' && bible!.projects.length) {
                const p = bible!.projects[hashNum(seed) % bible!.projects.length]!
                const slug = slugOf(p.name)
                src = baseNotes.filter(n => n.path === `projects/${slug}.md` || n.path.startsWith(`logs/${slug}-`)).slice(0, 6)
            }
            if (src.length < 2) return
            const system = questionSystem(t.kind, t.n)
            const text = src.map(n => `PATH: ${n.path}\n${n.text}`).join('\n\n---\n\n')
            // the seed is part of the key: two todos of one round (or of two rounds) can sample the same notes under the same system prompt,
            // and one key would then hand back one batch, its question ids and its distractor notes, twice
            const key = `q:${hash(system + text + seed)}`
            let batch = store.get(key) as QBatch | undefined
            if (!batch) {
                const raw = parseQuestions(await ask(system, text), t.kind)
                batch = { questions: [], notes: [], distractors: {} }
                raw.slice(0, t.n).forEach((r, j) => {
                    const id = `${t.kind}-${hash(key)}-${j}`
                    const paths = r.distractors.map((d, k) => {
                        const path = `archive/${hash(`${id}:${k}`)}.md`
                        batch!.notes.push({ path, text: d })
                        return path
                    })
                    batch!.questions.push({ id, kind: t.kind, question: r.question, answer: r.answer, evidence: r.evidence })
                    batch!.distractors[id] = paths
                })
                if (batch.questions.length) store.put(key, batch)
            }
            const have = new Set(all.questions.map(q => q.id))
            const fresh = batch.questions.filter(q => !have.has(q.id))
            const wanted = new Set(fresh.flatMap(q => batch!.distractors[q.id] ?? []))
            const paths = new Set(all.notes.map(n => n.path))
            all.questions.push(...fresh)
            all.notes.push(...batch.notes.filter(n => wanted.has(n.path) && !paths.has(n.path)))
            for (const q of fresh) all.distractors[q.id] = batch.distractors[q.id] ?? []
            log(`${t.kind} batch: ${batch.questions.length}/${t.n}`)
        })
        // drop the rejected, with their distractor notes, so the next round regenerates them
        const bad = new Set(rejectedIds(vaultOf()))
        if (bad.size) log(`rejected ${bad.size}: ${[...bad].join(' ')}`)
        const drop = new Set(all.questions.filter(q => bad.has(q.id)).flatMap(q => all.distractors[q.id] ?? []))
        all.questions = all.questions.filter(q => !bad.has(q.id))
        all.notes = all.notes.filter(n => !drop.has(n.path))
        for (const id of bad) delete all.distractors[id]
    }

    // trim to the asked-for counts and keep only the distractor notes still wanted
    const questions = KINDS.flatMap(k => all.questions.filter(q => q.kind === k).slice(0, target[k]))
    const keep = new Set(questions.flatMap(q => all.distractors[q.id] ?? []))
    const vault: SynthVault = {
        notes: [...baseNotes, ...all.notes.filter(n => keep.has(n.path))],
        questions,
        distractors: Object.fromEntries(questions.map(q => [q.id, all.distractors[q.id] ?? []])),
    }
    const short = Object.fromEntries(KINDS.map(k => [k, target[k] - questions.filter(q => q.kind === k).length]).filter(([, n]) => (n as number) > 0))
    return { vault, problems: validateSynth(vault), short }
}

/** Write the vault's notes as files under `<out>/vault` with the marker that makes it a vault. */
export function writeVaultFiles(out: string, v: SynthVault): string {
    const dir = join(out, 'vault')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.settings'), '')
    for (const n of v.notes) {
        mkdirSync(dirname(join(dir, n.path)), { recursive: true })
        writeFileSync(join(dir, n.path), n.text.endsWith('\n') ? n.text : n.text + '\n')
    }
    return dir
}

// ---- the run -------------------------------------------------------------------------------------------

const AGENT_SYSTEM = [
    'You answer questions about a small personal-notes vault: markdown notes in your working directory, with a read-only `bismuth` command line',
    '(`bismuth search <words>` finds notes by keyword, `bismuth read <note>` prints one). You cannot edit. Look things up instead of guessing.',
    'If the notes do not say, answer plainly that you cannot find it; do not make an answer up. Finish with one direct reply.',
].join(' ')

export const systemFor = (arm: SynthArm): string => (arm === 'search' ? `${AGENT_SYSTEM} ${SEARCH_FIRST}` : AGENT_SYSTEM)

export type RunRecord = SynthRow & { answer: string; verdict: string; opened: string[]; relied: string[]; toolCalls: number; durationMs: number }

export type RunOptions = { out: string; models: string[]; arms: SynthArm[]; limit: number | null; concurrency: number; timeoutMs: number; grade: AskFn }

/** The questions in the order a --limit takes them: the kinds interleaved, so a small limit holds each. */
export function limitedQuestions(qs: SynthQuestion[], limit: number | null): SynthQuestion[] {
    const by = KINDS.map(k => qs.filter(q => q.kind === k))
    const out: SynthQuestion[] = []
    for (let i = 0; by.some(b => i < b.length); i++) for (const b of by) if (b[i]) out.push(b[i]!)
    return limit === null ? out : out.slice(0, limit)
}

export async function runEval(o: RunOptions) {
    const vault = JSON.parse(readFileSync(join(o.out, 'vault.json'), 'utf8')) as SynthVault
    const problems = validateSynth(vault)
    if (problems.length) throw new Error(`vault.json is not valid:\n${problems.join('\n')}`)
    // what the agents touch (the made-up vault, their `bismuth`, opencode's homes) sits outside the real home; results stay in --out
    const work = agentWorkDir(o.out, realpathSync(homedir()))
    mkdirSync(work, { recursive: true })
    const vaultDir = writeVaultFilesOnce(work, vault)
    const byPath = new Map(vault.notes.map(n => [n.path, n.text] as const))
    const binDir = join(work, 'bin')
    const emptyConfig = join(work, 'empty-claude-config')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(emptyConfig, { recursive: true })
    // the `bismuth` the agents call: this checkout's CLI on the made-up vault, with no chat history to read
    writeFileSync(join(binDir, 'bismuth'), `#!/bin/sh\nunset BISMUTH_API CLAUDE_RELAY_URL\nexport BISMUTH_VAULT="${vaultDir}"\nexport CLAUDE_CONFIG_DIR="${emptyConfig}"\nexec "${process.execPath}" "${join(import.meta.dir, '..', 'cli', 'src', 'index.ts')}" "$@"\n`)
    chmodSync(join(binDir, 'bismuth'), 0o755)

    const store = openStore<RunRecord>(join(o.out, 'runs.jsonl'))
    const qs = limitedQuestions(vault.questions, o.limit)
    const jobs = qs.flatMap(q => o.arms.flatMap(arm => o.models.map(model => ({ q, arm, model, k: `${model}|${arm}|${q.id}` }))))
    const todo = jobs.filter(j => store.get(j.k)?.status !== 'ok')
    console.log(`${jobs.length} runs, ${jobs.length - todo.length} cached, pool ${o.concurrency}`)
    const homes = join(work, 'homes')
    mkdirSync(homes, { recursive: true })

    await pool(todo, o.concurrency, async ({ q, arm, model, k }) => {
        const block = arm === 'references' || arm === 'junk' ? referencesBlock(givenPaths(q, vault.distractors, arm), byPath, vaultDir) : { text: null, given: [] as string[] }
        const message = messageFor(q.question, block.text)
        const system = systemFor(arm)
        let run: AgentRun
        if (model.startsWith('opencode/')) {
            const home = mkdtempSync(join(homes, 'h-'))
            try {
                const r = await runOpencode({ model, message, system, cwd: vaultDir, home, denyPaths: [REAL_VAULT, join(homedir(), '.claude')], binDir, timeoutMs: o.timeoutMs })
                run = { status: r.status === 'ok' && r.answer.trim() ? 'ok' : 'failed', answer: r.answer, tools: r.tools, durationMs: r.durationMs }
            } finally {
                rmSync(home, { recursive: true, force: true })
            }
        } else run = await runClaudeAgent(system, message, vaultDir, binDir, o.timeoutMs)
        const opened = openedReferences(block.given.map(p => `note:${p}`), run.tools, vaultDir).map(x => x.slice(5))
        let verdict = 'none'
        let relied: string[] = []
        let status: 'ok' | 'failed' = run.status
        if (run.status === 'ok') {
            const items = block.given.map(p => ({ path: p, text: byPath.get(p) ?? '' }))
            const g = parseGrade(await withTimeout(o.grade(GRADER_SYSTEM, graderText(q, run.answer, items)), 120_000, null), block.given) ?? parseGrade(await withTimeout(o.grade(GRADER_SYSTEM, graderText(q, run.answer, items)), 120_000, null), block.given)
            if (g) (verdict = g.verdict), (relied = g.relied)
            else status = 'failed'
        }
        const s = status === 'ok' ? scoreRow({ q, verdict: verdict as 'correct', given: block.given, opened, relied }) : { correct: false, abstainedRight: false, openedShare: null, misled: false }
        const rec: RunRecord = { model, arm, qid: q.id, kind: q.kind, status, ...s, given: block.given.length, answer: run.answer.slice(0, 1500), verdict, opened, relied, toolCalls: run.tools.length, durationMs: run.durationMs }
        if (status === 'ok') store.put(k, rec)
        console.log(`${model} ${arm} ${q.id}: ${status === 'ok' ? verdict : 'failed'}${run.status === 'failed' ? ` (${run.answer.slice(0, 80).replace(/\s+/g, ' ')})` : ''}`)
        if (status !== 'ok') appendFileSync(join(o.out, 'failed.jsonl'), JSON.stringify(rec) + '\n')
    })

    const ids = new Set(qs.map(q => q.id))
    const rows: SynthRow[] = []
    for (const j of jobs) {
        const r = store.get(j.k)
        rows.push(r && ids.has(r.qid) ? r : { model: j.model, arm: j.arm, qid: j.q.id, kind: j.q.kind, status: 'failed', correct: false, abstainedRight: false, openedShare: null, misled: false, given: 0 })
    }
    const summary = summarize(rows)
    writeFileSync(join(o.out, 'summary.json'), JSON.stringify({ questions: qs.length, rows: summary }, null, 2))
    return summary
}

/** PURE. Where the agents' files go: `out` itself, unless it lies under the real home, where opencode's server answers 500
 *  (`underHome` in opencodeAgent.ts); then a folder in /private/tmp named by a hash of `out`, so a rerun on the same
 *  `--out` finds the same one, and a session's scratchpad vanishing takes nothing with it. */
export function agentWorkDir(out: string, home: string, tmp = existsSync('/private/tmp') ? '/private/tmp' : tmpdir()): string {
    return underHome(out, home) ? join(tmp, `bismuth-synth-${new Bun.CryptoHasher('sha1').update(out).digest('hex').slice(0, 12)}`) : out
}

function writeVaultFilesOnce(out: string, v: SynthVault): string {
    const dir = join(out, 'vault')
    return existsSync(join(dir, '.settings')) ? dir : writeVaultFiles(out, v)
}

const pct = (x: number | null): string => (x === null ? '-' : `${Math.round(x * 100)}%`)
export function formatSummary(rows: ReturnType<typeof summarize>): string {
    const head = ['model', 'arm', 'accuracy', 'abstention', 'opened', 'misled', 'failed']
    const lines = rows.map(r => [r.model, r.arm, `${pct(r.accuracy)} (n=${r.answerable})`, `${pct(r.abstention)} (n=${r.unanswerable})`, `${pct(r.openedShare)} (n=${r.withReferences})`, `${pct(r.misledShare)} (n=${r.withReferences})`, String(r.failed)])
    return [head, ...lines].map(l => l.join(' | ')).join('\n')
}

if (import.meta.main) {
    const argv = process.argv.slice(2)
    const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined)
    const outFlag = flag('--out')
    if (!outFlag || (!argv.includes('--generate') && !argv.includes('--run'))) {
        console.error('usage: bun bench/syntheticEval.ts --generate --out <dir> [--notes 120] [--questions 60] [--concurrency n]\n       bun bench/syntheticEval.ts --run --out <dir> [--models a,b] [--arms none,references,junk,search] [--limit n] [--concurrency n]')
        process.exit(2)
    }
    const out = resolve(outFlag)
    mkdirSync(out, { recursive: true })
    const concurrency = flag('--concurrency') ? Math.max(1, Number(flag('--concurrency'))) : judgePoolSize(cpus().length, totalmem())
    if (argv.includes('--generate')) {
        const { vault, problems, short } = await generateVault({ out, notes: Number(flag('--notes') ?? 120), questions: Number(flag('--questions') ?? 60), concurrency, timeoutMs: 180_000, ask: haikuAsk() })
        writeFileSync(join(out, 'vault.json'), JSON.stringify(vault, null, 2))
        writeVaultFiles(out, vault)
        console.log(`${vault.notes.length} notes, ${vault.questions.length} questions -> ${out}/vault.json`)
        if (Object.keys(short).length) console.log(`short of target: ${JSON.stringify(short)}`)
        if (problems.length) console.log(`problems:\n${problems.join('\n')}`)
    }
    if (argv.includes('--run')) {
        const models = (flag('--models') ?? DEFAULT_MODELS.join(',')).split(',').filter(Boolean)
        const bad = models.filter(m => m !== HAIKU && !ZEN_MODELS.includes(m))
        if (bad.length) {
            console.error(`unsupported model(s): ${bad.join(', ')}. Only ${[HAIKU, ...ZEN_MODELS].join(', ')}.`)
            process.exit(2)
        }
        const arms = (flag('--arms') ?? SYNTH_ARMS.join(',')).split(',') as SynthArm[]
        const summary = await runEval({ out, models, arms, limit: flag('--limit') ? Number(flag('--limit')) : null, concurrency, timeoutMs: 300_000, grade: haikuAsk() })
        console.log(formatSummary(summary))
    }
}
