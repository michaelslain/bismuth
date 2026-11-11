// Hand-label sweep pairs blind, then compare the labels with the judge's verdicts.
//   bun bench/labelPairs.ts --from <sweep out dir> --n 40 --labels <file>
//   bun bench/labelPairs.ts --from <sweep out dir> --labels <file> --report
// Labels hold only a pair key and a side, never a prompt. Keep the labels file outside the repo.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { hashOf, type Verdict } from './qualityReplayCases'

export type HandLabel = { pairKey: string; better: 'A' | 'B' | 'tie' }

/**
 * Judge verdicts live in the map under three kinds of key:
 *   `<pairKey>`         the merged verdict in the hand-labelling frame (what the human saw as A and B)
 *   `<pairKey>|first`   the raw verdict with the arm shown as A
 *   `<pairKey>|second`  the raw verdict with the arm shown as B
 * Order consistency is read from the last two; the first kind carries the agreement.
 */
export function agreement(labels: HandLabel[], verdicts: Map<string, Verdict>): { n: number; nonTieAgreement: number | null; overallAgreement: number | null; orderConsistency: number | null } {
    const ratio = (hit: number, of: number) => (of ? hit / of : null)
    let n = 0
    let same = 0
    let nonTie = 0
    let nonTieSame = 0
    for (const l of labels) {
        const j = verdicts.get(l.pairKey)
        if (!j) continue
        n++
        if (j === l.better) same++
        if (j !== 'tie' && l.better !== 'tie') {
            nonTie++
            if (j === l.better) nonTieSame++
        }
    }
    let both = 0
    let consistent = 0
    const seen = new Set<string>()
    for (const k of verdicts.keys()) {
        if (!k.endsWith('|first')) continue
        const base = k.slice(0, -'|first'.length)
        const f = verdicts.get(k)
        const s = verdicts.get(`${base}|second`)
        if (!f || !s || seen.has(base)) continue
        seen.add(base)
        both++
        if ((f === 'tie' && s === 'tie') || (f === 'A' && s === 'B') || (f === 'B' && s === 'A')) consistent++
    }
    return { n, nonTieAgreement: ratio(nonTieSame, nonTie), overallAgreement: ratio(same, n), orderConsistency: ratio(consistent, both) }
}

export type Pair = {
    pairKey: string
    caseId: number
    session: string
    prompt: string
    arm: string
    /** answer of the run with nothing injected, and of the arm's run */
    noneAnswer: string
    armAnswer: string
    /** the judge's two orders when the sweep kept them: verdicts with the arm shown as A, then as B */
    orders: [Verdict, Verdict] | null
    /** the judge's merged outcome for the arm against none, when the sweep reached a verdict */
    outcome: 'win' | 'tie' | 'loss' | null
}

const isVerdict = (v: unknown): v is Verdict => v === 'A' || v === 'B' || v === 'tie'

/** Reads `<fromDir>/quality.jsonl` into pairs (each non-none arm against its case's none run). */
export function loadPairs(fromDir: string): Pair[] {
    const file = join(fromDir, 'quality.jsonl')
    if (!existsSync(file)) throw new Error(`no quality.jsonl in ${fromDir}: pass --from a sweep output directory`)
    const rows: Record<string, any>[] = []
    readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
            if (!line.trim()) return
            let row: unknown
            try {
                row = JSON.parse(line)
            } catch {
                throw new Error(`${file} line ${i + 1} is not JSON`)
            }
            const need = (field: string, ok: boolean) => {
                if (!ok) throw new Error(`${file} line ${i + 1} is missing field "${field}"`)
            }
            const r = row as Record<string, any>
            need('caseId', typeof r?.caseId === 'number')
            need('session', typeof r.session === 'string')
            need('prompt', typeof r.prompt === 'string')
            need('arm', typeof r.arm === 'string')
            need('run', r.run === null || typeof r.run === 'object')
            if (r.run) need('run.answer', typeof r.run.answer === 'string')
            rows.push(r)
        })
    const none = new Map<number, string>()
    for (const r of rows) if (r.arm === 'none' && r.run) none.set(r.caseId, r.run.answer)
    const pairs: Pair[] = []
    for (const r of rows) {
        if (r.arm === 'none' || !r.run || !none.has(r.caseId)) continue
        const vs = r.vs
        const orders = Array.isArray(vs?.orders) && vs.orders.length === 2 && vs.orders.every(isVerdict) ? ([vs.orders[0], vs.orders[1]] as [Verdict, Verdict]) : null
        const outcome = vs?.outcome === 'win' || vs?.outcome === 'tie' || vs?.outcome === 'loss' ? vs.outcome : null
        const same = vs?.byConstruction === true
        if (same) continue
        pairs.push({ pairKey: `${r.caseId}|${r.arm}`, caseId: r.caseId, session: r.session, prompt: r.prompt, arm: r.arm, noneAnswer: none.get(r.caseId)!, armAnswer: r.run.answer, orders, outcome })
    }
    return pairs
}

/** Which side the arm's answer is shown on; stable per pair key, so a resume shows the same sides. */
export const armSide = (pairKey: string): 'A' | 'B' => (parseInt(hashOf(`side|${pairKey}`).slice(0, 2), 16) % 2 === 0 ? 'A' : 'B')

/** Pairs in a stable order spread across arms by hash, first `n`. */
export function pickPairs(pairs: Pair[], n: number): Pair[] {
    return [...pairs].sort((a, b) => hashOf(`pick|${a.pairKey}`).localeCompare(hashOf(`pick|${b.pairKey}`))).slice(0, n)
}

/** The judge's verdicts in the labelling frame (see `agreement`). Pairs without a judge outcome are left out. */
export function judgeVerdicts(pairs: Pair[]): Map<string, Verdict> {
    const m = new Map<string, Verdict>()
    for (const p of pairs) {
        const arm = armSide(p.pairKey)
        const other = arm === 'A' ? 'B' : 'A'
        if (p.outcome) m.set(p.pairKey, p.outcome === 'tie' ? 'tie' : p.outcome === 'win' ? arm : other)
        if (p.orders) {
            m.set(`${p.pairKey}|first`, p.orders[0])
            m.set(`${p.pairKey}|second`, p.orders[1])
        }
    }
    return m
}

export function readLabels(file: string): HandLabel[] {
    if (!existsSync(file)) return []
    const out: HandLabel[] = []
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
            const l = JSON.parse(line)
            if (typeof l.pairKey === 'string' && isVerdict(l.better)) out.push({ pairKey: l.pairKey, better: l.better })
        } catch {}
    }
    return out
}

const KEYS: Record<string, HandLabel['better']> = { a: 'A', b: 'B', t: 'tie' }

export type Io = { write: (s: string) => void; ask: (prompt: string) => Promise<string | null> }

/** Shows each unlabelled pair, appends each label as it is given; returns how many were added. */
export async function labelSession(pairs: Pair[], labelsFile: string, io: Io): Promise<number> {
    const done = new Set(readLabels(labelsFile).map(l => l.pairKey))
    const todo = pairs.filter(p => !done.has(p.pairKey))
    let added = 0
    for (const [i, p] of todo.entries()) {
        const arm = armSide(p.pairKey)
        const [a, b] = arm === 'A' ? [p.armAnswer, p.noneAnswer] : [p.noneAnswer, p.armAnswer]
        io.write(`\n=== pair ${done.size + added + 1} of ${pairs.length} (${todo.length - i} left) ===\nPrompt:\n${p.prompt}\n\n--- Answer A ---\n${a}\n\n--- Answer B ---\n${b}\n`)
        for (;;) {
            const line = await io.ask('better? [a] A  [b] B  [t] tie  [q] quit > ')
            if (line === null) return added
            const k = line.trim().toLowerCase()
            if (k === 'q') return added
            const better = KEYS[k]
            if (!better) {
                io.write('type a, b, t or q\n')
                continue
            }
            appendFileSync(labelsFile, JSON.stringify({ pairKey: p.pairKey, better } satisfies HandLabel) + '\n')
            added++
            break
        }
    }
    io.write(todo.length ? '\nall pairs labelled\n' : 'nothing left to label\n')
    return added
}

export function reportText(labels: HandLabel[], pairs: Pair[]): string {
    const a = agreement(labels, judgeVerdicts(pairs))
    const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`)
    return [`labels matched to judge verdicts: ${a.n} of ${labels.length}`, `non-tie agreement:  ${pct(a.nonTieAgreement)}`, `overall agreement:  ${pct(a.overallAgreement)}`, `order consistency:  ${pct(a.orderConsistency)}`].join('\n') + '\n'
}

function flag(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
}

async function main(argv: string[]) {
    const from = flag(argv, '--from')
    const labelsFile = flag(argv, '--labels')
    if (!from || !labelsFile) {
        console.error('usage: bun bench/labelPairs.ts --from <sweep out dir> --labels <file> [--n 40] [--report]')
        process.exit(2)
    }
    const n = Number(flag(argv, '--n') ?? 40)
    if (!Number.isInteger(n) || n < 1) {
        console.error(`--n must be a positive whole number, got "${flag(argv, '--n')}"`)
        process.exit(2)
    }
    let pairs: Pair[]
    try {
        pairs = loadPairs(from)
    } catch (e) {
        console.error((e as Error).message)
        process.exit(1)
    }
    if (argv.includes('--report')) {
        process.stdout.write(reportText(readLabels(labelsFile), pairs))
        return
    }
    if (!process.stdin.isTTY) {
        console.error('labelling needs a terminal: run this in a real terminal (stdin is not a TTY). Use --report to print agreement without one.')
        process.exit(1)
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const lines = rl[Symbol.asyncIterator]()
    const io: Io = {
        write: s => process.stdout.write(s),
        ask: async q => {
            process.stdout.write(q)
            const r = await lines.next()
            return r.done ? null : r.value
        },
    }
    const added = await labelSession(pickPairs(pairs, n), labelsFile, io)
    rl.close()
    console.log(`${added} labels added to ${labelsFile}`)
}

if (import.meta.main) await main(process.argv.slice(2))
