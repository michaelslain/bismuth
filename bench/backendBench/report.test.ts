import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderMatrix, score, writeReport } from './report'
import type { BenchReport, BenchTarget, Cell, Verdict } from './types'

const cell = (
    target: string,
    scenario: string,
    verdict: Verdict,
    detail = '',
): Cell => ({
    target,
    scenario,
    suite: 'parity',
    verdict,
    detail,
    metrics: {},
    wallMs: 1,
    log: [],
})

const REF = 'claude@mock'

describe('score', () => {
    const cells = [
        cell(REF, 'a', 'pass'),
        cell(REF, 'b', 'pass'),
        cell(REF, 'c', 'pass'),
        cell('o@mock', 'a', 'pass'),
        cell('o@mock', 'b', 'fail'),
        cell('o@mock', 'c', 'gap'),
        cell('o@mock', 'd', 'skip'),
        cell('o@mock', 'e', 'timeout'),
    ]
    const s = (t: string) => score(cells, REF).find(x => x.target === t)!

    test('pass fail timeout gap are scored, skip is not', () => {
        expect(s('o@mock').pass).toBe(1)
        expect(s('o@mock').scored).toBe(4)
    })
    test('parity is the share of reference passes this target also passes', () => {
        expect(s('o@mock').parity).toBeCloseTo(1 / 3)
    })
    test('parity is null for the reference', () => {
        expect(s(REF).parity).toBeNull()
    })
    test('parity is null when the reference was not run', () => {
        const only = score([cell('o@mock', 'a', 'pass')], REF)
        expect(only[0]!.parity).toBeNull()
    })
})

describe('renderMatrix', () => {
    const target = (label: string) => ({ label }) as BenchTarget
    const cells = [
        cell(REF, 'reply', 'pass'),
        cell('o@mock', 'reply', 'fail', 'no text frame arrived'),
        cell('g@mock', 'reply', 'gap', 'g has no agents'),
    ]
    const report: BenchReport = {
        startedAt: '2026-11-14T00:00:00.000Z',
        finishedAt: '2026-11-14T00:01:00.000Z',
        reference: REF,
        targets: [REF, 'o@mock', 'g@mock'].map(target),
        cells,
        scores: score(cells, REF),
    }
    const md = renderMatrix(report)
    test('every target is a column', () => {
        const header = md.split('\n').find(l => l.startsWith('| scenario'))!
        for (const t of [REF, 'o@mock', 'g@mock']) expect(header).toContain(t)
        expect(md).toContain('| parity/reply | pass | FAIL | gap |')
    })
    test('each non-pass cell lists its detail, a pass does not', () => {
        expect(md).toContain('no text frame arrived')
        expect(md).toContain('g has no agents')
        expect(md).not.toContain(`### ${REF}`)
    })
    test('writeReport writes json and md', () => {
        const out = writeReport(report, mkdtempSync(join(tmpdir(), 'bb-rep-')))
        expect(existsSync(out.json)).toBe(true)
        expect(existsSync(out.md)).toBe(true)
    })
})
