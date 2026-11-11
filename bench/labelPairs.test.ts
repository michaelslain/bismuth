import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agreement, armSide, judgeVerdicts, labelSession, loadPairs, pickPairs, readLabels, reportText, type HandLabel, type Io } from './labelPairs'
import type { Verdict } from './qualityReplayCases'

const tmp = () => mkdtempSync(join(tmpdir(), 'labelpairs-'))
const row = (caseId: number, arm: string, extra: Record<string, unknown> = {}) => ({ caseId, session: `s${caseId}`, prompt: `p${caseId}`, arm, run: { answer: `${arm}-${caseId}` }, ...extra })
const write = (dir: string, rows: unknown[]) => writeFileSync(join(dir, 'quality.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')

describe('agreement', () => {
    const l = (pairKey: string, better: HandLabel['better']): HandLabel => ({ pairKey, better })
    test('non-tie ignores ties, overall counts them as a class', () => {
        const v = new Map<string, Verdict>([['1', 'A'], ['2', 'B'], ['3', 'tie'], ['4', 'tie']])
        const r = agreement([l('1', 'A'), l('2', 'A'), l('3', 'tie'), l('4', 'A')], v)
        expect(r.n).toBe(4)
        expect(r.nonTieAgreement).toBe(0.5) // pairs 1, 2
        expect(r.overallAgreement).toBe(0.5) // 1 and 3 match
        expect(r.orderConsistency).toBeNull()
    })
    test('all null with nothing to compute from', () => {
        expect(agreement([], new Map())).toEqual({ n: 0, nonTieAgreement: null, overallAgreement: null, orderConsistency: null })
        const r = agreement([l('1', 'tie')], new Map([['1', 'A' as Verdict]]))
        expect(r.nonTieAgreement).toBeNull()
        expect(r.overallAgreement).toBe(0)
    })
    test('order consistency counts only pairs with both orders', () => {
        const v = new Map<string, Verdict>([['1|first', 'A'], ['1|second', 'B'], ['2|first', 'A'], ['2|second', 'A'], ['3|first', 'tie'], ['3|second', 'tie'], ['4|first', 'A']])
        expect(agreement([], v).orderConsistency).toBeCloseTo(2 / 3)
    })
})

describe('loadPairs', () => {
    test('pairs each arm with its none run and skips pairs without one', () => {
        const d = tmp()
        write(d, [row(1, 'none'), row(1, 'gate', { vs: { outcome: 'win', orders: ['A', 'B'] } }), row(2, 'gate'), row(3, 'none', { run: null }), row(3, 'junk')])
        const p = loadPairs(d)
        expect(p.map(x => x.pairKey)).toEqual(['1|gate'])
        expect(p[0]).toMatchObject({ noneAnswer: 'none-1', armAnswer: 'gate-1', outcome: 'win', orders: ['A', 'B'] })
        rmSync(d, { recursive: true })
    })
    test('skips arms identical to none by construction', () => {
        const d = tmp()
        write(d, [row(1, 'none'), row(1, 'gate', { vs: { outcome: 'tie', byConstruction: true } }), row(1, 'rag', { vs: { outcome: 'win', orders: ['A', 'B'] } })])
        expect(loadPairs(d).map(x => x.pairKey)).toEqual(['1|rag'])
        rmSync(d, { recursive: true })
    })
    test('a missing field fails naming the field', () => {
        const d = tmp()
        const { prompt: _p, ...noPrompt } = row(1, 'gate')
        write(d, [noPrompt])
        expect(() => loadPairs(d)).toThrow('missing field "prompt"')
        write(d, [row(1, 'gate', { run: {} })])
        expect(() => loadPairs(d)).toThrow('"run.answer"')
        expect(() => loadPairs(join(d, 'nope'))).toThrow('no quality.jsonl')
        rmSync(d, { recursive: true })
    })
})

describe('sides and picking', () => {
    test('side is stable and both sides occur', () => {
        const sides = Array.from({ length: 40 }, (_, i) => armSide(`${i}|gate`))
        expect(sides).toEqual(Array.from({ length: 40 }, (_, i) => armSide(`${i}|gate`)))
        expect(new Set(sides)).toEqual(new Set(['A', 'B']))
    })
    test('pickPairs is order independent and mixes arms', () => {
        const pairs = Array.from({ length: 30 }, (_, i) => ({ pairKey: `${i}|${i % 2 ? 'gate' : 'junk'}` }) as any)
        const a = pickPairs(pairs, 10).map(p => p.pairKey)
        expect(pickPairs([...pairs].reverse(), 10).map(p => p.pairKey)).toEqual(a)
        expect(new Set(a.map(k => k.split('|')[1])).size).toBe(2)
    })
    test('judge verdict lands on the side the arm is shown', () => {
        const mk = (pairKey: string, outcome: any) => ({ pairKey, outcome, orders: null }) as any
        const k = '1|gate'
        const arm = armSide(k)
        const other = arm === 'A' ? 'B' : 'A'
        expect(judgeVerdicts([mk(k, 'win')]).get(k)).toBe(arm)
        expect(judgeVerdicts([mk(k, 'loss')]).get(k)).toBe(other)
        expect(judgeVerdicts([mk(k, 'tie')]).get(k)).toBe('tie')
        expect(judgeVerdicts([mk(k, null)]).has(k)).toBe(false)
    })
})

describe('labelSession', () => {
    const pairs = [1, 2, 3].map(i => ({ pairKey: `${i}|gate`, caseId: i, session: 's', prompt: `prompt ${i}`, arm: 'gate', noneAnswer: `NONE${i}`, armAnswer: `ARM${i}`, orders: null, outcome: null }))
    const script = (inputs: (string | null)[]) => {
        const out: string[] = []
        const q = [...inputs]
        const io: Io = { write: s => out.push(s), ask: async () => (q.length ? q.shift()! : null) }
        return { io, out }
    }
    test('appends as given, hides the arm, resumes where it stopped', async () => {
        const d = tmp()
        const f = join(d, 'labels.jsonl')
        const s1 = script(['x', 'a', 'T', 'q'])
        expect(await labelSession(pairs, f, s1.io)).toBe(2)
        const shown = s1.out.join('')
        expect(shown).not.toContain('gate')
        expect(shown).toContain('type a, b, t or q')
        expect(readLabels(f).map(l => l.better)).toEqual(['A', 'tie'])
        const s2 = script(['b'])
        expect(await labelSession(pairs, f, s2.io)).toBe(1)
        expect(s2.out.join('')).toContain('prompt 3')
        expect(s2.out.join('')).not.toContain('prompt 1')
        expect(readLabels(f).map(l => l.pairKey)).toEqual(['1|gate', '2|gate', '3|gate'])
        expect(readFileSync(f, 'utf8')).not.toContain('prompt')
        rmSync(d, { recursive: true })
    })
    test('end of input stops without labelling', async () => {
        const d = tmp()
        expect(await labelSession(pairs, join(d, 'l.jsonl'), script([]).io)).toBe(0)
        rmSync(d, { recursive: true })
    })
})

test('report prints agreement rows', () => {
    const k = '1|gate'
    const p = [{ pairKey: k, outcome: 'win', orders: ['A', 'B'] }] as any
    const text = reportText([{ pairKey: k, better: armSide(k) }], p)
    expect(text).toContain('non-tie agreement:  100.0%')
    expect(text).toContain('order consistency:  100.0%')
})

test('non-TTY stdin exits with a message', async () => {
    const d = tmp()
    write(d, [row(1, 'none'), row(1, 'gate')])
    const proc = Bun.spawn(['bun', join(import.meta.dir, 'labelPairs.ts'), '--from', d, '--labels', join(d, 'l.jsonl')], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const err = await new Response(proc.stderr).text()
    expect(await proc.exited).toBe(1)
    expect(err).toContain('needs a terminal')
    rmSync(d, { recursive: true })
}, 20000)
