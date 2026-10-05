import { describe, test, expect } from 'bun:test'
import { runDoctor } from '../../src/doctor/run'
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
})
