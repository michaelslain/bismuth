import { describe, test, expect } from 'bun:test'
import { runDoctor } from '../../src/doctor/run'
import type { ActivityEvent } from '../../src/daemonActivity'
import type { DoctorSection, Finding } from '../../src/doctor/types'
import { fakeCtx } from './fakeCtx'

const sec = (
    id: string,
    findings: () => Finding[],
    needsVault = false,
): DoctorSection => ({
    id,
    title: id,
    needsVault,
    check: async () => findings(),
})

describe('runDoctor', () => {
    test('a throwing section becomes <id>.check-failed and others still run', async () => {
        const r = await runDoctor(fakeCtx(), {}, [
            {
                id: 'a',
                title: 'a',
                check: async () => {
                    throw new Error('EACCES')
                },
            },
            sec('b', () => [{ id: 'b.x', severity: 'warn', title: 'x' }]),
        ])
        expect(r.findings.map(f => f.id)).toEqual(['a.check-failed', 'b.x'])
        expect(r.findings[0].severity).toBe('error')
        expect(r.findings[0].detail).toContain('EACCES')
    })
    test('needsVault sections are skipped without a vault', async () => {
        const r = await runDoctor(fakeCtx(), {}, [
            sec('v', () => [{ id: 'v.x', severity: 'warn', title: 'x' }], true),
        ])
        expect(r.findings).toEqual([])
        expect(r.vault).toBe(null)
    })
    test('dry run sorts destructive first, then severity, and counts pending', async () => {
        const noop = async () => []
        const r = await runDoctor(fakeCtx(), {}, [
            sec('s', () => [
                { id: 's.info', severity: 'info', title: 'i' },
                {
                    id: 's.warn',
                    severity: 'warn',
                    title: 'w',
                    repair: { risk: 'safe', description: 'd', apply: noop },
                },
                {
                    id: 's.destr',
                    severity: 'info',
                    title: 'd',
                    repair: {
                        risk: 'destructive',
                        description: 'd',
                        touches: [],
                        apply: noop,
                    },
                },
            ]),
        ])
        expect(r.findings.map(f => f.id)).toEqual([
            's.destr',
            's.warn',
            's.info',
        ])
        expect(r.pending).toEqual({ safe: 1, destructive: 1 })
        expect(r.ok).toBe(false)
    })
    test('--fix applies, --safe-only skips destructive, --only narrows, unknown ids reported', async () => {
        const applied: string[] = []
        const mk = (id: string, risk: 'safe' | 'destructive'): Finding => ({
            id,
            severity: 'warn',
            title: id,
            repair: {
                risk,
                description: id,
                touches: [],
                apply: async () => {
                    applied.push(id)
                    return []
                },
            },
        })
        const sections = [
            sec('s', () => [mk('s.a', 'safe'), mk('s.b', 'destructive')]),
        ]
        const safe = await runDoctor(
            fakeCtx(),
            { fix: true, risks: ['safe'] },
            sections,
        )
        expect(applied).toEqual(['s.a'])
        expect(safe.findings.find(f => f.id === 's.b')!.repair!.status).toBe(
            'skipped',
        )
        applied.length = 0
        const only = await runDoctor(
            fakeCtx(),
            { fix: true, only: ['s.b', 's.nope'] },
            sections,
        )
        expect(applied).toEqual(['s.b'])
        expect(only.unknownIds).toEqual(['s.nope'])
    })
    test('a repair that returns warnings is failed; one that throws is failed, never propagates', async () => {
        const r = await runDoctor(fakeCtx(), { fix: true }, [
            sec('s', () => [
                {
                    id: 's.w',
                    severity: 'warn',
                    title: 'w',
                    repair: {
                        risk: 'safe',
                        description: 'd',
                        apply: async () => ['nope'],
                    },
                },
                {
                    id: 's.t',
                    severity: 'warn',
                    title: 't',
                    repair: {
                        risk: 'safe',
                        description: 'd',
                        apply: async () => {
                            throw new Error('x')
                        },
                    },
                },
            ]),
        ])
        expect(r.failed).toBe(2)
        expect(r.findings.every(f => f.repair!.status === 'failed')).toBe(true)
    })
    test('ok when every warn/error finding was repaired', async () => {
        const r = await runDoctor(fakeCtx(), { fix: true }, [
            sec('s', () => [
                {
                    id: 's.a',
                    severity: 'warn',
                    title: 'a',
                    repair: {
                        risk: 'safe',
                        description: 'd',
                        apply: async () => [],
                    },
                },
                { id: 's.i', severity: 'info', title: 'i' },
            ]),
        ])
        expect(r.ok).toBe(true)
        expect(r.fixed).toBe(1)
    })
    test('sections option filters by id', async () => {
        const r = await runDoctor(fakeCtx(), { sections: ['b'] }, [
            sec('a', () => [{ id: 'a.x', severity: 'warn', title: 'x' }]),
            sec('b', () => [{ id: 'b.x', severity: 'warn', title: 'x' }]),
        ])
        expect(r.findings.map(f => f.id)).toEqual(['b.x'])
    })
    test('a destructive repair is backed up first and the report carries the backup', async () => {
        const order: string[] = []
        const r = await runDoctor(
            fakeCtx({
                backup: async (id, _d, paths) => {
                    order.push(`backup ${id} ${paths.join(',')}`)
                    return { repo: '/r', commit: 'abc1234def', file: 'f.tar.gz' }
                },
            }),
            { fix: true },
            [
                sec('s', () => [
                    {
                        id: 's.d',
                        severity: 'warn',
                        title: 'd',
                        repair: {
                            risk: 'destructive',
                            description: 'delete /x',
                            touches: ['/x'],
                            apply: async () => {
                                order.push('apply')
                                return []
                            },
                        },
                    },
                ]),
            ],
        )
        expect(order).toEqual(['backup s.d /x', 'apply'])
        expect(r.findings[0].repair!.backup).toEqual({
            repo: '/r',
            commit: 'abc1234def',
            file: 'f.tar.gz',
        })
    })
    test('a failed backup leaves the repair unapplied and failed', async () => {
        let applied = false
        const r = await runDoctor(
            fakeCtx({
                backup: async () => {
                    throw new Error('disk full')
                },
            }),
            { fix: true },
            [
                sec('s', () => [
                    {
                        id: 's.d',
                        severity: 'warn',
                        title: 'd',
                        repair: {
                            risk: 'destructive',
                            description: 'delete /x',
                            touches: ['/x'],
                            apply: async () => {
                                applied = true
                                return []
                            },
                        },
                    },
                ]),
            ],
        )
        expect(applied).toBe(false)
        expect(r.failed).toBe(1)
        expect(r.findings[0].repair!.warnings![0]).toBe(
            'backup failed, nothing changed: disk full',
        )
    })
    test('every attempted repair becomes one doctor event; skipped and dry-run ones log nothing', async () => {
        const events: ActivityEvent[] = []
        const ctx = fakeCtx({
            backup: async () => ({ repo: '/r', commit: 'abc1234def', file: 'f' }),
            logActivity: e => events.push(e),
        })
        const sections = [
            sec('s', () => [
                {
                    id: 's.ok',
                    severity: 'warn',
                    title: 'ok title',
                    repair: { risk: 'safe', description: 'do ok', apply: async () => [] },
                },
                {
                    id: 's.bad',
                    severity: 'warn',
                    title: 'bad title',
                    repair: { risk: 'safe', description: 'do bad', apply: async () => ['boom'] },
                },
                {
                    id: 's.del',
                    severity: 'info',
                    title: 'del title',
                    repair: {
                        risk: 'destructive',
                        description: 'delete /x',
                        touches: ['/x'],
                        apply: async () => [],
                    },
                },
            ]),
        ]
        await runDoctor(ctx, {}, sections)
        await runDoctor(ctx, { fix: true, only: ['nothing'] }, sections)
        expect(events).toEqual([])
        await runDoctor(ctx, { fix: true }, sections)
        expect(events.map(e => [e.kind, e.name, e.event, e.outcome, e.detail])).toEqual([
            ['doctor', 'doctor', 'repair', 'success', 's.del // delete /x // backup abc1234 in /r'],
            ['doctor', 'doctor', 'repair', 'failed', 's.bad // do bad // boom'],
            ['doctor', 'doctor', 'repair', 'success', 's.ok // do ok'],
        ])
        expect(Number.isNaN(Date.parse(events[0].ts))).toBe(false)
    })
})
