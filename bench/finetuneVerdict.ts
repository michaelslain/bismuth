// Verdict for a general fine-tune: which merge export to take, and whether it beats the shipped model.
//   bun bench/finetuneVerdict.ts pick --eval <train dir>/eval.json
//   bun bench/finetuneVerdict.ts ship --search-base <pools dir> --search-tuned <pools dir> --recall-base <recallReplay out> --recall-tuned <recallReplay out> [--draws 2000]
// `pick` takes the export with the highest held-out public MRR@10 among those whose mean nDCG@10 over the
// BEIR sets is at least the base's, ties to the lower alpha, and `base` when none qualifies. `ship` pairs the
// search pools by case id and the recall rows by prompt within session, and prints the three diffs of the
// ship rule, then SHIP or KEEP. Reads only what the replays wrote; nothing from the vault is printed.
import { join, resolve } from 'node:path'
import { withLogits, heldOut, pairedDiff, readJsonl, type SearchPool } from './searchReplay'
import type { RecallRow } from './finetuneEmbed'

const SETS = ['scifact', 'nfcorpus', 'fiqa', 'arguana'] as const

/** `eval.json` of a general run. A BEIR set that was skipped is absent from its row. */
export type EvalReport = {
    heldoutMrr10: Record<string, number>
    beir: Record<string, Partial<Record<(typeof SETS)[number], number>>>
}

export type Diff = { diff: number; lo: number; hi: number }

/** Share of the tuned weights: 1 for the bare name, N/100 for `-mN`, 0 for `base` and `<name>-base`. */
export function alphaOf(name: string): number {
    if (name === 'base' || name.endsWith('-base')) return 0
    const m = /-m(\d+)$/.exec(name)
    return m ? Number(m[1]) / 100 : 1
}

/** The merge rule: highest held-out MRR@10 among exports whose mean nDCG@10 (over the sets in the base
 *  row) is at least the base's; tie to the lower alpha; `base` when none qualifies. Pure. */
export function pickExport(e: EvalReport): { name: string; reason: string } {
    const baseRow = e.beir.base ?? {}
    const sets = SETS.filter(s => typeof baseRow[s] === 'number')
    const mean = (row: EvalReport['beir'][string] | undefined) => {
        if (!row || !sets.length) return null
        const xs = sets.map(s => row[s])
        return xs.every(x => typeof x === 'number') ? (xs as number[]).reduce((a, b) => a + b, 0) / xs.length : null
    }
    const floor = mean(baseRow)
    if (floor === null) return { name: 'base', reason: 'no base BEIR row to compare against' }
    const ok = Object.keys(e.heldoutMrr10)
        .filter(n => alphaOf(n) > 0 && typeof e.heldoutMrr10[n] === 'number')
        .filter(n => {
            const m = mean(e.beir[n])
            return m !== null && m >= floor
        })
    if (!ok.length) return { name: 'base', reason: `every export lost BEIR nDCG@10 (base ${floor.toFixed(4)}), so the shipped model stays` }
    ok.sort((a, b) => e.heldoutMrr10[b]! - e.heldoutMrr10[a]! || alphaOf(a) - alphaOf(b))
    const name = ok[0]!
    return {
        name,
        reason: `held-out MRR@10 ${e.heldoutMrr10[name]!.toFixed(4)} (base ${e.heldoutMrr10.base?.toFixed(4) ?? 'n/a'}), BEIR nDCG@10 ${mean(e.beir[name])!.toFixed(4)} >= base ${floor.toFixed(4)}, alpha ${alphaOf(name)}`,
    }
}

/** The ship rule: search MRR@10 lower bound above 0, search recall@10 and recall's raw top 10 each at least 0. */
export function shipVerdict(v: { searchMrr: Diff; searchRecall: Diff; recallTop10: Diff }): { ship: boolean; failed: string[] } {
    const failed: string[] = []
    if (!(v.searchMrr.lo > 0)) failed.push(`search mrr@10 lower bound ${v.searchMrr.lo.toFixed(4)} is not above 0`)
    if (!(v.searchRecall.diff >= 0)) failed.push(`search recall@10 diff ${v.searchRecall.diff.toFixed(4)} is below 0`)
    if (!(v.recallTop10.diff >= 0)) failed.push(`recall label in raw top 10 diff ${v.recallTop10.diff.toFixed(4)} is below 0`)
    return { ship: !failed.length, failed }
}

/** Keep only the cases both pool sets hold, in the base's order. */
export function pairSearch<T extends { id: number }>(base: T[], tuned: T[]) {
    const t = new Map(tuned.map(x => [x.id, x]))
    const b = base.filter(x => t.has(x.id))
    return { base: b, tuned: b.map(x => t.get(x.id)!), dropped: base.length - b.length + (tuned.length - b.length) }
}

/** Recall rows with a file label, paired by prompt within session (the nth repeat of a prompt pairs with
 *  the nth repeat). `hit` is whether recall injected a label, `rr` whether one was in the raw top 10. */
export function pairByPrompt(base: RecallRow[], tuned: RecallRow[]) {
    const key = (xs: RecallRow[]) => {
        const seen = new Map<string, number>()
        return xs.map(r => {
            const k = `${r.session}\0${r.prompt}`
            const n = seen.get(k) ?? 0
            seen.set(k, n + 1)
            return `${k}\0${n}`
        })
    }
    const hasFile = (r: RecallRow) => r.labels.some(l => !l.startsWith('docs:'))
    const row = (r: RecallRow) => ({ session: r.session, hit: r.hit ? 1 : 0, rr: r.labelRetrieved ? 1 : 0 })
    const tk = key(tuned)
    const tuning = new Map(tuned.map((r, i) => [tk[i]!, r]))
    const out = { base: [] as ReturnType<typeof row>[], tuned: [] as ReturnType<typeof row>[], dropped: 0 }
    const bk = key(base)
    for (const [i, r] of base.entries()) {
        if (!hasFile(r)) continue
        const t = tuning.get(bk[i]!)
        if (!t) {
            out.dropped++
            continue
        }
        out.base.push(row(r))
        out.tuned.push(row(t))
    }
    return out
}

// ---- the command line -----------------------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
}
const need = (name: string) => {
    const v = flag(name)
    if (!v) {
        console.error(`missing ${name}`)
        process.exit(2)
    }
    return v
}
const f = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

async function pick() {
    const e = JSON.parse(await Bun.file(resolve(need('--eval'))).text()) as EvalReport
    const p = pickExport(e)
    for (const n of Object.keys(e.heldoutMrr10)) console.log(`${n}: held-out mrr@10 ${e.heldoutMrr10[n]!.toFixed(4)}  beir ${JSON.stringify(e.beir[n] ?? {})}`)
    console.log(`${p.name === 'base' ? 'KEEP base' : `PICK ${p.name}`}: ${p.reason}`)
}

function ship() {
    const draws = Number(flag('--draws') ?? 2000)
    const pools = (d: string) => readJsonl<SearchPool>(join(resolve(d), 'pools.jsonl'))
    const sp = pairSearch(pools(need('--search-base')), pools(need('--search-tuned')))
    const sb = heldOut(withLogits(sp.base, null), 5)
    const st = heldOut(withLogits(sp.tuned, null), 5)
    const sd = pairedDiff(sb, st, draws)
    const rows = (d: string) => readJsonl<RecallRow>(join(resolve(d), 'cases.jsonl'))
    const rp = pairByPrompt(rows(need('--recall-base')), rows(need('--recall-tuned')))
    const rd = pairedDiff(rp.base, rp.tuned, draws)
    const line = (name: string, b: number[], t: number[], x: { diff: number; lo: number; hi: number }) =>
        console.log(`${name} ${mean(b).toFixed(3)} → ${mean(t).toFixed(3)} (${f(x.diff)}, ${f(x.lo)} to ${f(x.hi)})`)
    line('search mrr@10   ', sb.map(x => x.rr), st.map(x => x.rr), sd.mrr)
    line('search recall@10', sb.map(x => x.hit), st.map(x => x.hit), sd.recall)
    line('recall label in raw top 10', rp.base.map(x => x.rr), rp.tuned.map(x => x.rr), rd.mrr)
    console.log(`search ${sd.cases} cases / ${sd.sessions} sessions (${sp.dropped} dropped, not in both)`)
    console.log(`recall ${rd.cases} cases / ${rd.sessions} sessions (${rp.dropped} dropped, not in both)`)
    const v = shipVerdict({ searchMrr: sd.mrr, searchRecall: sd.recall, recallTop10: rd.mrr })
    console.log(v.ship ? 'SHIP' : `KEEP: ${v.failed.join('; ')}`)
}

if (import.meta.main) {
    const mode = argv[0]
    if (mode === 'pick') await pick()
    else if (mode === 'ship') ship()
    else {
        console.error('usage: bun bench/finetuneVerdict.ts pick|ship …')
        process.exit(2)
    }
    process.exit(0)
}
