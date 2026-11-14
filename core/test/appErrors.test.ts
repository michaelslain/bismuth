import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    KEEP_ENTRIES,
    MAX_BYTES,
    clearAppErrors,
    parseAppErrorReport,
    readAppErrors,
    recordAppError,
} from '../src/appErrors'
import { createServer } from '../src/server'
import { makeVault, tempDir } from './helpers'

describe('parseAppErrorReport', () => {
    test('keeps a valid report and drops unknown fields', () => {
        expect(
            parseAppErrorReport({
                kind: 'rejection',
                message: 'TypeError: x is undefined',
                stack: 'at f (a.js:1:2)',
                source: 'a.js:1:2',
                extra: 1,
            }),
        ).toEqual({
            kind: 'rejection',
            message: 'TypeError: x is undefined',
            stack: 'at f (a.js:1:2)',
            source: 'a.js:1:2',
        })
    })
    test('refuses anything that is not a report', () => {
        for (const bad of [
            null,
            'x',
            {},
            { kind: 'warn', message: 'x' },
            { kind: 'error', message: '   ' },
            { kind: 'error', message: 3 },
        ])
            expect(parseAppErrorReport(bad)).toBeNull()
    })
    test('clips an oversized message', () => {
        const r = parseAppErrorReport({ kind: 'error', message: 'x'.repeat(5000) })
        expect(r!.message.length).toBeLessThan(2100)
        expect(r!.message.endsWith('…')).toBe(true)
    })
})

describe('the log', () => {
    test('records, filters by time, vault and limit, and clears', () => {
        const file = join(tempDir('app-errors-'), 'logs', 'app-errors.jsonl')
        recordAppError(
            { kind: 'error', message: 'one', vault: '/a' },
            new Date('2026-11-01T00:00:00Z'),
            file,
        )
        recordAppError(
            { kind: 'rejection', message: 'two', vault: '/b' },
            new Date('2026-11-02T00:00:00Z'),
            file,
        )
        recordAppError(
            { kind: 'error', message: 'three', vault: '/a' },
            new Date('2026-11-03T00:00:00Z'),
            file,
        )
        expect(readAppErrors({}, file).map(e => e.message)).toEqual([
            'one',
            'two',
            'three',
        ])
        expect(
            readAppErrors({ since: '2026-11-01T12:00:00Z' }, file).map(e => e.message),
        ).toEqual(['two', 'three'])
        expect(readAppErrors({ vault: '/a' }, file).map(e => e.message)).toEqual([
            'one',
            'three',
        ])
        expect(readAppErrors({ limit: 1 }, file).map(e => e.message)).toEqual([
            'three',
        ])
        expect(clearAppErrors(file)).toBe(3)
        expect(readAppErrors({}, file)).toEqual([])
    })

    test('a missing file and malformed lines read as fewer entries', () => {
        const dir = tempDir('app-errors-bad-')
        expect(readAppErrors({}, join(dir, 'none.jsonl'))).toEqual([])
        const file = join(dir, 'x.jsonl')
        writeFileSync(
            file,
            'not json\n{"ts":"2026-11-01T00:00:00.000Z","kind":"error","message":"ok"}\n{"ts":1}\n',
        )
        expect(readAppErrors({}, file).map(e => e.message)).toEqual(['ok'])
    })

    test('the size cap docs/overview/storage.md states', () => {
        expect(MAX_BYTES).toBe(512 * 1024)
        expect(KEEP_ENTRIES).toBe(500)
    })

    test('trims to the newest entries once the file passes its size cap', () => {
        const file = join(tempDir('app-errors-cap-'), 'app-errors.jsonl')
        const big = 'y'.repeat(1900)
        const n = Math.ceil(MAX_BYTES / 2000) + 5
        for (let i = 0; i < n; i++)
            recordAppError({ kind: 'error', message: `${i} ${big}` }, new Date(), file)
        const lines = readFileSync(file, 'utf8').trim().split('\n')
        expect(lines.length).toBeLessThanOrEqual(KEEP_ENTRIES)
        expect(readFileSync(file).length).toBeLessThanOrEqual(MAX_BYTES + 4000)
        const last = readAppErrors({}, file).at(-1)!
        expect(last.message.startsWith(`${n - 1} `)).toBe(true)
    })
})

const TOKEN = 'owner-token-for-app-errors-test'

describe('POST /app-errors', () => {
    const KEYS = [
        'BISMUTH_RUN_DIR',
        'BISMUTH_NO_BOOT_DOCTOR',
        'BISMUTH_OWNER_TOKEN',
    ] as const
    const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}
    beforeEach(() => {
        for (const k of KEYS) saved[k] = process.env[k]
        process.env.BISMUTH_RUN_DIR = tempDir('app-errors-run-')
        process.env.BISMUTH_NO_BOOT_DOCTOR = '1'
        process.env.BISMUTH_OWNER_TOKEN = TOKEN
        clearAppErrors()
    })
    afterEach(() => {
        clearAppErrors()
        for (const k of KEYS)
            if (saved[k] === undefined) delete process.env[k]
            else process.env[k] = saved[k]
    })

    test('the owner window records an error stamped with its vault; nobody else can', async () => {
        const vault = makeVault({ 'a.md': '# a\n' })
        const server = createServer({ vault, port: 0 })
        const url = `http://localhost:${server.port}/app-errors`
        const post = (body: unknown, headers: Record<string, string> = {}) =>
            fetch(url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json', ...headers },
            })
        const report = { kind: 'error', message: 'TypeError: boom', source: 'App.tsx:3:4' }
        try {
            expect((await post(report)).status).toBe(403)
            expect((await post(report, { 'X-Bismuth-Token': 'nope' })).status).toBe(403)
            expect(
                (await post({ kind: 'nope' }, { 'X-Bismuth-Token': TOKEN })).status,
            ).toBe(400)
            expect(readAppErrors()).toEqual([])
            const ok = await post(report, { 'X-Bismuth-Token': TOKEN })
            expect(ok.status).toBe(200)
            const entries = readAppErrors()
            expect(entries).toHaveLength(1)
            expect(entries[0]).toMatchObject({
                kind: 'error',
                message: 'TypeError: boom',
                source: 'App.tsx:3:4',
                vault,
            })
        } finally {
            server.stop(true)
        }
    })
})
