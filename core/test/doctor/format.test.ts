import { describe, test, expect } from 'bun:test'
import { formatDoctorReport } from '../../src/doctor/format'
import type { DoctorReport } from '../../src/doctor/types'

const base = (over: Partial<DoctorReport>): DoctorReport => ({
    ok: true,
    vault: null,
    findings: [],
    fixed: 0,
    failed: 0,
    pending: { safe: 0, destructive: 0 },
    unknownIds: [],
    ...over,
})

describe('formatDoctorReport', () => {
    test('all clear without a vault prints the pair', () => {
        expect(formatDoctorReport(base({}))).toBe(
            'bismuth doctor // all clear\nvault checks skipped // pass --vault <path>',
        )
    })
    test('all clear with a vault is one line', () => {
        expect(formatDoctorReport(base({ vault: '/v' }))).toBe(
            'bismuth doctor // all clear',
        )
    })
    test('header, line shape, padding, footer', () => {
        const out = formatDoctorReport(
            base({
                ok: false,
                findings: [
                    {
                        id: 'legacy.claude-bot-service',
                        section: 'legacy',
                        severity: 'warn',
                        title: 'claude-bot service installed',
                        repair: {
                            risk: 'destructive',
                            description: 'remove the service',
                        },
                    },
                    {
                        id: 'a.b',
                        section: 'a',
                        severity: 'error',
                        title: 'broken',
                    },
                    { id: 'a.c', section: 'a', severity: 'info', title: 'fyi' },
                    { id: 'a.d', section: 'a', severity: 'ok', title: 'fine' },
                ],
                pending: { safe: 0, destructive: 1 },
            }),
        ).split('\n')
        expect(out).toEqual([
            'bismuth doctor // 4 findings // 1 need consent',
            '! legacy.claude-bot-service  claude-bot service installed  -> remove the service [destructive]',
            '✗ a.b                        broken',
            '· a.c                        fyi',
            '✓ a.d                        fine',
            'run bismuth doctor --fix to apply 1 repairs',
        ])
    })
    test('fixed and failed suffixes, no footer when nothing pending', () => {
        const out = formatDoctorReport(
            base({
                findings: [
                    {
                        id: 'x.a',
                        section: 'x',
                        severity: 'warn',
                        title: 'a',
                        repair: {
                            risk: 'safe',
                            description: 'd',
                            status: 'applied',
                        },
                    },
                    {
                        id: 'x.b',
                        section: 'x',
                        severity: 'warn',
                        title: 'b',
                        repair: {
                            risk: 'safe',
                            description: 'd',
                            status: 'failed',
                            warnings: ['nope', 'later'],
                        },
                    },
                ],
                fixed: 1,
                failed: 1,
            }),
        ).split('\n')
        expect(out).toEqual([
            'bismuth doctor // 2 findings // 0 need consent',
            '! x.a  a  -> d [safe] // fixed',
            '! x.b  b  -> d [safe] // failed: nope',
        ])
    })
    test('the id column is capped at 32 characters; a longer id does not widen other rows', () => {
        const long = 'runtime.' + 'x'.repeat(40)
        const out = formatDoctorReport(
            base({
                findings: [
                    { id: long, section: 'r', severity: 'info', title: 'long' },
                    { id: 'a.b', section: 'a', severity: 'info', title: 'short' },
                ],
            }),
        ).split('\n')
        expect(out[1]).toBe(`· ${long}  long`)
        expect(out[2]).toBe(`· ${'a.b'.padEnd(32)}  short`)
    })
    test('one unknown id line per entry', () => {
        const out = formatDoctorReport(base({ unknownIds: ['q.1', 'q.2'] }))
        expect(out.split('\n').slice(-2)).toEqual([
            'unknown id: q.1',
            'unknown id: q.2',
        ])
    })
})
