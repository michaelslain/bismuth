// Needle and aggregate questions from real sessions, written by Haiku, for the replay's `--needles` input.
//   bun bench/needleCases.ts --logs <claude project dir> --out <file> [--n 40] [--concurrency n]
// A needle question names one fact from one session; an aggregate question spans several sessions of the one project
// (the --logs dir). Each stores its answer and the quotes it rests on. A question that its own wording answers is
// dropped offline (`selfAnswering`). Haiku only, through the user's `claude` login; the logs are only read, and
// --out holds your prompts, so keep it out of the repo. Results are appended as they land and a rerun resumes.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { extractText, stripInjectedBlocks } from '../memory/src/transcript'
import { judgePoolSize } from './recallReplayCases'

export type Needle = { id: string; kind: 'needle' | 'aggregate'; session: string | null; question: string; answer: string; evidence: string[] }

export const NEEDLE_MODEL = 'claude-haiku-5-5'

/** Lower-case word tokens (letters and digits). */
export const wordsOf = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

// Function words carry no fact: an answer made only of them and of words the question already used tells nothing new.
const FUNCTION_WORDS = new Set(
    'a an and are as at be been but by for from had has have he her his i in is it its of on or she so that the their them then there they this to was we were what when where which who will with you your'.split(' '),
)

/** True when the answer adds nothing the question did not already say: every content word of the answer occurs in
 *  the question. An answer with no content words is dropped too. No cutoff: the rule is all-or-nothing. */
export function selfAnswering(question: string, answer: string): boolean {
    const asked = new Set(wordsOf(question))
    const content = wordsOf(answer).filter(w => !FUNCTION_WORDS.has(w))
    return content.every(w => asked.has(w))
}

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim()) ? (v as string[]) : null)

/** One needle per JSONL line; malformed lines and invalid records are dropped. Never throws. */
export function parseNeedles(text: string): Needle[] {
    const out: Needle[] = []
    for (const line of String(text ?? '').split('\n')) {
        if (!line.trim()) continue
        try {
            const r = JSON.parse(line)
            if (!r || typeof r !== 'object') continue
            const evidence = strings(r.evidence)
            const okKind = r.kind === 'needle' || r.kind === 'aggregate'
            const okSession = r.kind === 'needle' ? typeof r.session === 'string' && r.session !== '' : r.session === null
            if (typeof r.id !== 'string' || !r.id || !okKind || !okSession || !evidence) continue
            if (typeof r.question !== 'string' || !r.question.trim() || typeof r.answer !== 'string' || !r.answer.trim()) continue
            out.push({ id: r.id, kind: r.kind, session: r.session, question: r.question, answer: r.answer, evidence })
        } catch {
            // malformed line
        }
    }
    return out
}

// ---- session digests ---------------------------------------------------------------------------

type Entry = { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { role?: string; content?: string | { type?: string; text?: string }[] } }

/** What a person typed and what the assistant said, injected blocks stripped, each message head-truncated. */
export function sessionDigest(jsonl: string, perMessage = 600, budget = 9000): string {
    const lines: string[] = []
    for (const raw of jsonl.split('\n')) {
        if (!raw) continue
        let e: Entry
        try {
            e = JSON.parse(raw)
        } catch {
            continue
        }
        if (e.isSidechain || e.isMeta || (e.type !== 'user' && e.type !== 'assistant')) continue
        const text = stripInjectedBlocks(extractText(e.message)).trim()
        if (!text) continue
        lines.push(`${e.type === 'user' ? 'USER' : 'ASSISTANT'}: ${text.slice(0, perMessage)}`)
    }
    let out = lines.join('\n')
    if (out.length > budget) out = out.slice(0, budget / 2) + '\n...\n' + out.slice(out.length - budget / 2)
    return out
}

// ---- generation --------------------------------------------------------------------------------

/** One model reply for a system prompt and a text; null on failure. Injectable so tests need no model. */
export type AskFn = (system: string, text: string) => Promise<string | null>

const NEEDLE_SYSTEM =
    'You write test questions from a past work session between a person and an AI assistant. Reply with JSON only: {"questions":[{"question":"...","answer":"...","evidence":["exact quote from the session"]}]}. ' +
    'Each question asks for ONE specific fact that appears in the session (a name, number, decision, path or reason) and can be answered only by someone who has the session. ' +
    'Do not put the answer, or words that reveal it, in the question. The answer is short. Each evidence item is copied verbatim from the session. Write at most 2 questions; write none if the session holds no specific fact.'
const AGGREGATE_SYSTEM =
    'You write test questions that need several past work sessions on one project. Reply with JSON only: {"questions":[{"question":"...","answer":"...","evidence":["exact quote from a session"]}]}. ' +
    'Each question asks for something only the combination of the sessions answers (what was decided across them, how often something came up, how something changed). ' +
    'The answer is a summary of one or two sentences. Do not put the answer in the question. Each evidence item is copied verbatim from a session. Write at most 2 questions.'

type Raw = { question: string; answer: string; evidence: string[] }

/** The questions a model reply holds; anything malformed is ignored. */
export function parseQuestions(reply: string | null): Raw[] {
    if (!reply) return []
    const m = reply.match(/\{[\s\S]*\}/)
    if (!m) return []
    try {
        const qs = JSON.parse(m[0])?.questions
        if (!Array.isArray(qs)) return []
        const out: Raw[] = []
        for (const q of qs) {
            const evidence = strings(q?.evidence)
            if (typeof q?.question === 'string' && q.question.trim() && typeof q?.answer === 'string' && q.answer.trim() && evidence) out.push({ question: q.question.trim(), answer: q.answer.trim(), evidence })
        }
        return out
    } catch {
        return []
    }
}

export type Task = { key: string; kind: 'needle' | 'aggregate'; session: string | null; system: string; text: string }

/** FNV-1a: a stable order that does not follow file names or dates. */
export const hashOf = (s: string): number => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
    return h
}

/** Build the tasks for a log dir: a needle task per session, then aggregate tasks over groups of sessions. The
 *  directory is the project, so every aggregate group stays inside it. */
export function buildTasks(sessions: { id: string; digest: string }[], groupSize = 4): Task[] {
    const usable = sessions.filter(s => s.digest.length > 200).sort((a, b) => hashOf(a.id) - hashOf(b.id) || (a.id < b.id ? -1 : 1))
    const tasks: Task[] = usable.map(s => ({ key: `needle:${s.id}`, kind: 'needle', session: s.id, system: NEEDLE_SYSTEM, text: s.digest }))
    for (let i = 0; i + 2 <= usable.length; i += groupSize) {
        const g = usable.slice(i, i + groupSize)
        if (g.length < 2) break
        tasks.push({ key: `aggregate:${g.map(s => s.id.slice(0, 8)).join('+')}`, kind: 'aggregate', session: null, system: AGGREGATE_SYSTEM, text: g.map(s => `=== SESSION ${s.id} ===\n${s.digest.slice(0, 4000)}`).join('\n\n') })
    }
    return tasks
}

/** Interleave: needles and aggregates alternate so a small --n holds both kinds. */
function interleave(tasks: Task[]): Task[] {
    const a = tasks.filter(t => t.kind === 'needle')
    const b = tasks.filter(t => t.kind === 'aggregate')
    const out: Task[] = []
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i]) out.push(a[i]!)
        if (a[i + 1] && i % 2 === 0) out.push(a[i + 1]!)
        if (b[i]) out.push(b[i]!)
    }
    return [...new Set(out)]
}

/** Run one task: the questions that survive the offline checks, as needles. */
export async function runTask(t: Task, ask: AskFn, timeoutMs: number): Promise<Needle[] | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const reply = await Promise.race([ask(t.system, t.text).catch(() => null), new Promise<null>(r => (timer = setTimeout(() => r(null), timeoutMs)))])
    clearTimeout(timer)
    if (reply === null) return null
    const out: Needle[] = []
    for (const q of parseQuestions(reply)) {
        if (selfAnswering(q.question, q.answer)) continue
        out.push({ id: `${t.kind}-${hashOf(t.key + q.question).toString(16)}`, kind: t.kind, session: t.session, question: q.question, answer: q.answer, evidence: q.evidence })
    }
    return out
}

export type GenerateOptions = { out: string; n: number; concurrency: number; timeoutMs: number; ask: AskFn }

/** Sweep the tasks in a pool until `n` needles exist. Each task's needles are appended to `out` as they land and its
 *  key goes to `<out>.done`, so a rerun skips finished tasks and counts what is already there. */
export async function generate(tasks: Task[], o: GenerateOptions): Promise<Needle[]> {
    mkdirSync(dirname(o.out), { recursive: true })
    const doneFile = `${o.out}.done`
    const done = new Set(existsSync(doneFile) ? readFileSync(doneFile, 'utf8').split('\n').filter(Boolean) : [])
    const have = parseNeedles(existsSync(o.out) ? readFileSync(o.out, 'utf8') : '')
    const queue = interleave(tasks).filter(t => !done.has(t.key))
    let next = 0
    const worker = async () => {
        while (have.length < o.n && next < queue.length) {
            const t = queue[next++]!
            const found = await runTask(t, o.ask, o.timeoutMs)
            if (found === null) continue
            const room = o.n - have.length
            const keep = found.slice(0, Math.max(0, room))
            if (keep.length) appendFileSync(o.out, keep.map(x => JSON.stringify(x)).join('\n') + '\n')
            appendFileSync(doneFile, t.key + '\n')
            have.push(...keep)
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker))
    return have
}

// ---- Claude Agent SDK, Haiku, no tools ---------------------------------------------------------

type Msg = { type: string; subtype?: string; result?: string }
let sdk: Promise<{ query: (a: unknown) => AsyncIterable<Msg>; bin: string; env: () => Record<string, string | undefined> }> | null = null
const loadSdk = () =>
    (sdk ??= (async () => {
        const { whichClaude, claudeSpawnEnv } = await import('../core/src/claudeWhich')
        const bin = whichClaude()
        if (!bin) throw new Error('claude binary not found')
        const { query } = await import('../core/node_modules/@anthropic-ai/claude-agent-sdk')
        return { query: query as never, bin, env: () => claudeSpawnEnv() as never }
    })())

export const haikuAsk: AskFn = async (system, text) => {
    const { query, bin, env } = await loadSdk()
    try {
        let out = ''
        const stream = query({ prompt: text, options: { model: NEEDLE_MODEL, pathToClaudeCodeExecutable: bin, cwd: process.cwd(), env: env(), tools: [], maxTurns: 1, persistSession: false, settingSources: [], systemPrompt: system } })
        for await (const m of stream) if (m.type === 'result' && m.subtype === 'success') out = m.result ?? ''
        return out || null
    } catch {
        return null
    }
}

export function loadSessions(logs: string): { id: string; digest: string }[] {
    return readdirSync(logs)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ id: basename(f, '.jsonl'), digest: sessionDigest(readFileSync(join(logs, f), 'utf8')) }))
}

if (import.meta.main) {
    const args = process.argv.slice(2)
    const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
    const logs = flag('--logs')
    const out = flag('--out')
    if (!logs || !out) {
        console.error('usage: bun bench/needleCases.ts --logs <claude project dir> --out <file> [--n 40] [--concurrency n]')
        process.exit(2)
    }
    const n = Number(flag('--n') ?? 40)
    const concurrency = Number(flag('--concurrency') ?? judgePoolSize(cpus().length, totalmem()))
    await loadSdk() // a missing claude binary exits non-zero instead of silently failing every task
    const tasks = buildTasks(loadSessions(logs))
    const got = await generate(tasks, { out, n, concurrency, timeoutMs: 180_000, ask: haikuAsk })
    if (!existsSync(out)) writeFileSync(out, '')
    console.log(`${got.length} questions (${got.filter(x => x.kind === 'needle').length} needle, ${got.filter(x => x.kind === 'aggregate').length} aggregate) -> ${out}`)
}
