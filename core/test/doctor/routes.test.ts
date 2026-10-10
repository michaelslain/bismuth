import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
    bootDoctor,
    bootDoctorOptions,
    doctorApply,
    doctorDryRun,
    doctorFixOptions,
    type DoctorRouteDeps,
} from '../../src/doctor/routes'
import { DEFAULT_SECTIONS } from '../../src/doctor/sections'
import { createServer } from '../../src/server'
import { makeVault, tempDir } from '../helpers'
import { createLocalBackend } from '../../src/localBackend'
import type {
    DoctorContext,
    DoctorOptions,
    DoctorReport,
} from '../../src/doctor/types'
import { useSpawnBudget } from '../spawnBudget'

useSpawnBudget()

const REPORT: DoctorReport = {
    ok: true,
    vault: '/v',
    findings: [],
    fixed: 0,
    failed: 0,
    pending: { safe: 0, destructive: 0 },
    unknownIds: [],
}

function fakeDeps(report: Partial<DoctorReport> = {}) {
    const calls: { vault?: string; opts: DoctorOptions }[] = []
    const deps: DoctorRouteDeps = {
        context: ({ vault }) => ({ vault }) as DoctorContext,
        run: async (ctx, opts = {}) => {
            calls.push({ vault: ctx.vault, opts })
            return { ...REPORT, ...report }
        },
    }
    return { deps, calls }
}

describe('doctorFixOptions', () => {
    test('absent body or absent only means fix everything', () => {
        expect(doctorFixOptions(undefined)).toEqual({ fix: true })
        expect(doctorFixOptions({})).toEqual({ fix: true })
    })
    test('only passes through when it is a string array', () => {
        expect(doctorFixOptions({ only: ['a', 'b'] })).toEqual({
            fix: true,
            only: ['a', 'b'],
        })
        expect(doctorFixOptions({ only: [] })).toEqual({ fix: true, only: [] })
    })
    test('a malformed only is rejected, never widened to fix-everything', () => {
        expect(doctorFixOptions({ only: 'a' })).toBeUndefined()
        expect(doctorFixOptions({ only: [1] })).toBeUndefined()
        expect(doctorFixOptions({ only: null })).toBeUndefined()
        expect(doctorFixOptions([])).toBeUndefined()
        expect(doctorFixOptions('x')).toBeUndefined()
    })
})

describe('doctor routes', () => {
    test('GET /doctor is a dry run over the server vault', async () => {
        const { deps, calls } = fakeDeps()
        expect(await doctorDryRun('/v', deps)).toEqual(REPORT)
        expect(calls).toEqual([{ vault: '/v', opts: {} }])
    })
    test('POST /doctor/fix passes only through, both risks', async () => {
        const { deps, calls } = fakeDeps()
        await doctorApply('/v', doctorFixOptions({ only: ['x.y'] })!, deps)
        expect(calls).toEqual([
            { vault: '/v', opts: { fix: true, only: ['x.y'] } },
        ])
        expect(calls[0]!.opts.risks).toBeUndefined()
    })
})

describe('bootDoctor', () => {
    test('applies safe repairs only and logs the counts', async () => {
        const { deps, calls } = fakeDeps({
            fixed: 2,
            pending: { safe: 0, destructive: 1 },
        })
        expect(await bootDoctor('/v', deps)).toEqual([
            'bismuth doctor: fixed 2, 1 waiting for consent',
        ])
        expect(calls[0]!.opts).toEqual(bootDoctorOptions())
    })
    test('options: safe repairs, every section but vault', () => {
        const o = bootDoctorOptions()
        expect(o.fix).toBe(true)
        expect(o.risks).toEqual(['safe'])
        expect(o.sections).toEqual(
            DEFAULT_SECTIONS.map(s => s.id).filter(id => id !== 'vault'),
        )
        expect(o.sections).not.toContain('vault')
        expect(o.sections!.length).toBe(DEFAULT_SECTIONS.length - 1)
    })
    test("logs each failed repair's first warning", async () => {
        const { deps } = fakeDeps({
            failed: 1,
            findings: [
                {
                    id: 'daemon.unit-old-home',
                    section: 'daemon',
                    severity: 'warn',
                    title: 't',
                    repair: {
                        risk: 'safe',
                        description: 'd',
                        status: 'failed',
                        warnings: ['launchctl said no', 'second'],
                    },
                },
            ],
        })
        const lines = await bootDoctor('/v', deps)
        expect(lines[1]).toBe(
            'bismuth doctor: daemon.unit-old-home failed: launchctl said no',
        )
    })
    test('never throws', async () => {
        const deps: DoctorRouteDeps = {
            context: () => ({}) as DoctorContext,
            run: async () => {
                throw new Error('boom')
            },
        }
        expect(await bootDoctor('/v', deps)).toEqual([
            'bismuth doctor failed: boom',
        ])
    })
})

describe('in-process backend', () => {
    test('both routes answer 501', async () => {
        const b = createLocalBackend({ vault: '/v' })
        for (const [m, p] of [
            ['GET', '/doctor'],
            ['POST', '/doctor/fix'],
        ] as const) {
            const err = await b.dispatch(m, p, {}).then(
                () => null,
                e => e as { statusCode?: number },
            )
            expect(err?.statusCode).toBe(501)
        }
    })
})

const TOKEN = 'owner-token-for-doctor-routes-test'

describe('owner gate', () => {
    const KEYS = [
        'BISMUTH_RUN_DIR',
        'BISMUTH_DAEMON_DIR',
        'BISMUTH_INSTALL_SRC',
        'BISMUTH_NO_BOOT_DOCTOR',
        'BISMUTH_OWNER_TOKEN',
        'HOME',
    ] as const
    const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}
    beforeEach(() => {
        for (const k of KEYS) saved[k] = process.env[k]
        process.env.BISMUTH_RUN_DIR = tempDir('doctor-routes-run-')
        process.env.BISMUTH_DAEMON_DIR = tempDir('doctor-routes-machine-')
        delete process.env.BISMUTH_INSTALL_SRC
        process.env.BISMUTH_NO_BOOT_DOCTOR = '1'
        process.env.BISMUTH_OWNER_TOKEN = TOKEN
        // the owner's dry run reads the home it is given: point it at an empty temp one
        process.env.HOME = tempDir('doctor-routes-home-')
    })
    afterEach(() => {
        for (const k of KEYS)
            if (saved[k] === undefined) delete process.env[k]
            else process.env[k] = saved[k]
    })

    test('only the owner token reaches the doctor routes', async () => {
        const token = TOKEN
        const server = createServer({
            vault: makeVault({ 'a.md': '# a\n' }),
            port: 0,
        })
        const base = `http://localhost:${server.port}`
        const post = (headers: Record<string, string>) =>
            fetch(`${base}/doctor/fix`, {
                method: 'POST',
                body: JSON.stringify({ only: [] }),
                headers,
            })
        try {
            // tokenless, wrong token and agent-channel requests are all refused
            expect((await fetch(`${base}/doctor`)).status).toBe(403)
            expect((await post({})).status).toBe(403)
            const wrong = { 'X-Bismuth-Token': 'nope' }
            expect(
                (await fetch(`${base}/doctor`, { headers: wrong })).status,
            ).toBe(403)
            expect((await post(wrong)).status).toBe(403)
            const chat = { 'X-Bismuth-Channel': 'chat' }
            expect(
                (await fetch(`${base}/doctor`, { headers: chat })).status,
            ).toBe(403)
            expect((await post(chat)).status).toBe(403)
            // the owner is let through (200 with a doctor report)
            const owner = { 'X-Bismuth-Token': token }
            const res = await fetch(`${base}/doctor`, { headers: owner })
            expect(res.status).toBe(200)
            expect(await res.json()).toHaveProperty('findings')
        } finally {
            server.stop(true)
        }
    })
})
