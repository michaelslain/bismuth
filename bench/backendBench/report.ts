// bench/backendBench/report.ts
// Scores and renders a finished run: per-target per-suite parity against the reference target, the
// markdown matrix (one row per scenario, one column per target) and the json + md files.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BenchReport, Cell, Score, Verdict } from './types'

/** pass + fail + timeout + gap count toward `scored`; skip does not. */
export function score(cells: Cell[], reference: string): Score[] {
    const out: Score[] = []
    const keys = [...new Set(cells.map(c => `${c.target}\n${c.suite}`))]
    for (const key of keys) {
        const [target, suite] = key.split('\n') as [string, string]
        const mine = cells.filter(c => c.target === target && c.suite === suite)
        const pass = mine.filter(c => c.verdict === 'pass').length
        const scored = mine.filter(c => c.verdict !== 'skip').length
        let parity: number | null = null
        if (target !== reference) {
            const refPassed = cells
                .filter(
                    c =>
                        c.target === reference &&
                        c.suite === suite &&
                        c.verdict === 'pass',
                )
                .map(c => c.scenario)
            if (refPassed.length) {
                const also = refPassed.filter(id =>
                    mine.some(c => c.scenario === id && c.verdict === 'pass'),
                )
                parity = also.length / refPassed.length
            }
        }
        out.push({ target, suite, pass, scored, parity })
    }
    return out
}

const LABEL: Record<Verdict, string> = {
    pass: 'pass',
    fail: 'FAIL',
    gap: 'gap',
    skip: 'skip',
    timeout: 'TIMEOUT',
}

const pct = (n: number | null) => (n === null ? '-' : `${Math.round(n * 100)}%`)

export function renderMatrix(report: BenchReport): string {
    const targets = report.targets.map(t => t.label)
    const cells = report.cells
    const scenarios = [
        ...new Map(cells.map(c => [c.scenario, c.suite] as const)).entries(),
    ]
    const find = (target: string, scenario: string) =>
        cells.find(c => c.target === target && c.scenario === scenario)
    const lines: string[] = []
    lines.push('# backend benchmark')
    lines.push('')
    lines.push(
        `reference \`${report.reference}\` // ${report.startedAt} to ${report.finishedAt}`,
    )
    lines.push('')
    lines.push(`| scenario | ${targets.join(' | ')} |`)
    lines.push(`|---|${targets.map(() => '---').join('|')}|`)
    for (const [id, suite] of scenarios) {
        const row = targets.map(t => {
            const c = find(t, id)
            return c ? LABEL[c.verdict] : '-'
        })
        lines.push(`| ${suite}/${id} | ${row.join(' | ')} |`)
    }
    lines.push('')
    lines.push('## scores')
    lines.push('')
    lines.push('| target | suite | pass | scored | parity |')
    lines.push('|---|---|---|---|---|')
    for (const s of report.scores) {
        lines.push(
            `| ${s.target} | ${s.suite} | ${s.pass} | ${s.scored} | ${pct(s.parity)} |`,
        )
    }
    const bad = cells.filter(c => c.verdict !== 'pass')
    if (bad.length) {
        lines.push('')
        lines.push('## not passing')
        for (const c of bad) {
            lines.push('')
            lines.push(`### ${c.target} // ${c.suite}/${c.scenario}: ${LABEL[c.verdict]}`)
            lines.push('')
            lines.push(c.detail || '(no detail)')
        }
    }
    lines.push('')
    return lines.join('\n')
}

/** Writes `<stamp>.json` and `<stamp>.md` into `dir` (created), returning both paths. */
export function writeReport(
    report: BenchReport,
    dir: string,
): { json: string; md: string } {
    mkdirSync(dir, { recursive: true })
    const stamp = report.startedAt.replace(/[:.]/g, '-')
    const json = join(dir, `${stamp}.json`)
    const md = join(dir, `${stamp}.md`)
    writeFileSync(json, JSON.stringify(report, null, 2) + '\n')
    writeFileSync(md, renderMatrix(report))
    return { json, md }
}
