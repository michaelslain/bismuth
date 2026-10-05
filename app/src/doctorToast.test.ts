import { afterEach, describe, expect, test } from 'bun:test'
import { dismissToast, toasts } from './toastStore'
import { doctorToastMessage, showDoctorToast } from './doctorToast'
import type { DoctorReport, FindingReport } from '../../core/src/doctor/types'

const finding = (
    id: string,
    risk: 'safe' | 'destructive',
    status?: 'applied',
): FindingReport => ({
    id,
    section: id.split('.')[0]!,
    severity: 'warn',
    title: `title ${id}`,
    repair: { risk, description: 'd', ...(status ? { status } : {}) },
})

const report = (findings: FindingReport[], fixed = 0): DoctorReport => ({
    ok: true,
    vault: null,
    findings,
    fixed,
    failed: 0,
    pending: { safe: 0, destructive: 0 },
    unknownIds: [],
})

afterEach(() => {
    for (const t of toasts()) dismissToast(t.id)
})

describe('doctorToastMessage', () => {
    test('one, two and many titles', () => {
        expect(doctorToastMessage(['a'])).toBe(
            'doctor // 1 repair needs your ok: a',
        )
        expect(doctorToastMessage(['a', 'b'])).toBe(
            'doctor // 2 repairs need your ok: a, b',
        )
        expect(doctorToastMessage(['a', 'b', 'c', 'd'])).toBe(
            'doctor // 4 repairs need your ok: a, b +2 more',
        )
    })
})

describe('showDoctorToast', () => {
    test('no toast when only safe repairs or nothing is pending', async () => {
        await showDoctorToast({
            getDoctor: async () => report([finding('a.b', 'safe')]),
            fixDoctor: async () => report([]),
        })
        expect(toasts()).toHaveLength(0)
    })

    test('a rejecting getDoctor shows nothing and does not throw', async () => {
        await showDoctorToast({
            getDoctor: async () => {
                throw new Error('501')
            },
            fixDoctor: async () => report([]),
        })
        expect(toasts()).toHaveLength(0)
    })

    test('one pending destructive repair: a fix toast whose click fixes exactly those ids', async () => {
        const asked: string[][] = []
        await showDoctorToast({
            getDoctor: async () =>
                report([
                    finding('legacy.claude-bot-clone', 'destructive'),
                    finding('install.version-skew', 'safe'),
                ]),
            fixDoctor: async ids => {
                asked.push(ids)
                return report([], 1)
            },
        })
        expect(toasts()).toHaveLength(1)
        const t = toasts()[0]!
        expect(t.message).toBe(
            'doctor // 1 repair needs your ok: title legacy.claude-bot-clone',
        )
        expect(t.action?.label).toBe('fix')
        t.action!.onClick()
        await new Promise(r => setTimeout(r, 0))
        expect(asked).toEqual([['legacy.claude-bot-clone']])
        expect(toasts().map(x => x.message)).toEqual(['doctor // fixed 1 of 1'])
    })

    test('a failing fix reports it instead of throwing', async () => {
        await showDoctorToast({
            getDoctor: async () => report([finding('a.b', 'destructive')]),
            fixDoctor: async () => {
                throw new Error('nope')
            },
        })
        toasts()[0]!.action!.onClick()
        await new Promise(r => setTimeout(r, 0))
        expect(toasts().map(x => x.message)).toEqual(['doctor // fix failed'])
    })
})
