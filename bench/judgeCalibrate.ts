// Calibrate the relevance judge against what the agent really fetched, then re-judge every candidate.
//   bun bench/judgeCalibrate.ts --from <replay dir> --out <dir> [--prompts v1,v2] [--sample 200] [--concurrency n]
// Reads `cases.jsonl` + `candidates.jsonl` of a replay run. For each judge prompt it measures
//   recall      share of the FETCHED candidates (a fetched label matched them) it marks relevant
//   specificity 1 - share of a fixed pseudo-random sample of UNFETCHED candidates it marks relevant
// and picks the prompt with the higher balanced accuracy (their mean). The winner then judges every
// candidate, quiet cases included; `candidates-judged.jsonl` is `candidates.jsonl` with those verdicts.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { JUDGE_PROMPTS, balancedAccuracy, judgeJobs, type JudgeJob } from './recallJudge'
import { judgePoolSize } from './recallReplayCases'

type CaseRow = { prompt: string; context: string; candItems: { key: string; text: string }[] }
type Cand = { id: number; key: string; matched: boolean; verdict?: string; [k: string]: unknown }

const readJsonl = <T,>(path: string): T[] =>
    readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as T)

/** `n` of `items`, ordered by a hash of their ids: reproducible, and independent of the order they were collected in. */
export function sampleBy<T>(items: T[], idOf: (t: T) => string, n: number): T[] {
    const h = (t: T) => new Bun.CryptoHasher('sha1').update(`judge-sample|${idOf(t)}`).digest('hex')
    return items
        .map(t => ({ t, h: h(t) }))
        .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
        .slice(0, n)
        .map(x => x.t)
}

if (import.meta.main) {
    const argv = process.argv.slice(2)
    const flag = (n: string) => {
        const i = argv.indexOf(n)
        return i >= 0 ? argv[i + 1] : undefined
    }
    const from = flag('--from')
    const outArg = flag('--out')
    if (!from || !outArg) {
        console.error('usage: bun bench/judgeCalibrate.ts --from <replay dir> --out <dir> [--prompts v1,v2] [--sample 200] [--concurrency n]')
        process.exit(2)
    }
    const out = resolve(outArg)
    mkdirSync(out, { recursive: true })
    const prompts = (flag('--prompts') ?? Object.keys(JUDGE_PROMPTS).join(',')).split(',')
    const sampleN = Number(flag('--sample') ?? 200)
    const workers = flag('--concurrency') ? Math.max(1, Number(flag('--concurrency'))) : judgePoolSize(cpus().length, totalmem())
    const cases = readJsonl<CaseRow>(join(resolve(from), 'cases.jsonl'))
    const cands = readJsonl<Cand>(join(resolve(from), 'candidates.jsonl'))
    const cachePath = join(out, 'judge-cache.jsonl')
    if (!existsSync(cachePath) && existsSync(join(resolve(from), 'judge-cache.jsonl'))) copyFileSync(join(resolve(from), 'judge-cache.jsonl'), cachePath)

    const textOf = (c: Cand) => cases[c.id - 1]!.candItems.find(x => x.key === c.key)?.text ?? ''
    const jobOf = (promptId: string, c: Cand): JudgeJob => ({ promptId, ctx: cases[c.id - 1]!.context, prompt: cases[c.id - 1]!.prompt, key: c.key, text: textOf(c) })
    const uniq = (cs: Cand[]) => [...new Map(cs.map(c => [`${c.id}|${c.key}`, c])).values()]
    const fetched = uniq(cands.filter(c => c.matched))
    const sample = sampleBy(uniq(cands.filter(c => !c.matched)), c => `${c.id}|${c.key}`, sampleN)
    console.log(`fetched ${fetched.length}  unfetched sample ${sample.length}`)

    const rate = (vs: string[]) => vs.filter(v => v === 'relevant').length
    const calibration: Record<string, ReturnType<typeof balancedAccuracy> & { fetched: number; sample: number; errors: number }> = {}
    for (const id of prompts) {
        const vs = await judgeJobs([...fetched, ...sample].map(c => jobOf(id, c)), cachePath, out, workers, s => console.log(`[${id}] ${s}`))
        const f = vs.slice(0, fetched.length)
        const s = vs.slice(fetched.length)
        const ok = (x: string) => x !== 'error'
        calibration[id] = {
            ...balancedAccuracy(rate(f), f.filter(ok).length, rate(s), s.filter(ok).length),
            fetched: f.filter(ok).length,
            sample: s.filter(ok).length,
            errors: vs.filter(v => v === 'error').length,
        }
        console.log(id, JSON.stringify(calibration[id]))
    }
    const chosen = prompts.reduce((a, b) => (calibration[b]!.balanced > calibration[a]!.balanced ? b : a))
    console.log(`chosen judge prompt: ${chosen}`)

    const all = uniq(cands)
    const verdicts = await judgeJobs(all.map(c => jobOf(chosen, c)), cachePath, out, workers, s => console.log(`[all ${chosen}] ${s}`))
    const verdictOf = new Map(all.map((c, i) => [`${c.id}|${c.key}`, verdicts[i]!]))
    writeFileSync(
        join(out, 'candidates-judged.jsonl'),
        cands.map(c => JSON.stringify({ ...c, verdict: verdictOf.get(`${c.id}|${c.key}`), judgePrompt: chosen })).join('\n') + '\n',
    )
    writeFileSync(join(out, 'calibration.json'), JSON.stringify({ chosen, calibration, fetched: fetched.length, sample: sample.length }, null, 2))
    const stats = (set: string) => {
        const vs = cands.filter(c => (c as { set?: string }).set === set).map(c => verdictOf.get(`${c.id}|${c.key}`))
        return `${set}: ${vs.filter(v => v === 'relevant').length}/${vs.length} relevant`
    }
    console.log(['labelled', 'past', 'time', 'quiet'].map(stats).join('  '), ' errors', verdicts.filter(v => v === 'error').length)
    process.exit(0)
}
