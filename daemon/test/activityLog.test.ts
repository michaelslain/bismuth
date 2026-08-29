// The activity log's pure half (naming, formatting, parsing, expiry arithmetic) plus one
// round-trip through the real filesystem. House style: pure functions with an INJECTED clock,
// real mkdtemp dirs rather than fs mocks, and a partial VaultContext cast to just the fields the
// function under test reads.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    activityFileName,
    formatActivityLine,
    parseActivityLines,
    expiredActivityFiles,
    logActivity,
    pruneActivityLogs,
    type ActivityEvent,
} from '../src/lib/activityLog'
import type { VaultContext } from '../src/lib/config'

let logsDir: string
let ctx: VaultContext

beforeEach(() => {
    logsDir = mkdtempSync(join(tmpdir(), 'bismuth-activity-'))
    ctx = { logsDir } as unknown as VaultContext
})

afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true })
})

test('activityFileName buckets by UTC day', () => {
    expect(activityFileName(new Date('2026-08-29T23:59:59.999Z'))).toBe(
        'activity-2026-08-29.jsonl',
    )
    expect(activityFileName(new Date('2026-08-30T00:00:00.000Z'))).toBe(
        'activity-2026-08-30.jsonl',
    )
})

test('formatActivityLine emits one newline-terminated JSON line', () => {
    const line = formatActivityLine({
        ts: '2026-08-29T14:03:00.000Z',
        kind: 'cron',
        name: 'dream',
        event: 'finished',
        outcome: 'success',
    })
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(JSON.parse(line)).toMatchObject({ name: 'dream', outcome: 'success' })
})

test('formatActivityLine escapes a newline inside detail so the line stays splittable', () => {
    const line = formatActivityLine({
        ts: '2026-08-29T14:03:00.000Z',
        kind: 'cron',
        name: 'dream',
        event: 'finished',
        detail: 'first line\nsecond line',
    })
    expect(line.split('\n')).toHaveLength(2)
    expect(JSON.parse(line).detail).toBe('first line\nsecond line')
})

test('parseActivityLines skips malformed and non-object lines without throwing', () => {
    const text = [
        '{"ts":"2026-08-29T10:00:00.000Z","kind":"cron","name":"a","event":"started"}',
        'not json at all',
        '{"broken":',
        '"a bare string"',
        '{"ts":"2026-08-29T11:00:00.000Z","kind":"process","name":"b","event":"exited"}',
        '',
    ].join('\n')
    const events = parseActivityLines(text)
    expect(events.map(e => e.name)).toEqual(['a', 'b'])
})

test('parseActivityLines drops objects missing the required fields', () => {
    const text = [
        '{"ts":"2026-08-29T10:00:00.000Z","kind":"cron","name":"ok","event":"started"}',
        '{"kind":"cron","name":"no-ts","event":"started"}',
        '{"ts":"2026-08-29T10:00:00.000Z","name":"no-kind","event":"started"}',
    ].join('\n')
    expect(parseActivityLines(text).map(e => e.name)).toEqual(['ok'])
})

test('expiredActivityFiles keeps today and the retention window, drops older', () => {
    const names = [
        'activity-2026-08-29.jsonl',
        'activity-2026-08-27.jsonl',
        'activity-2026-08-25.jsonl',
        'activity-2026-07-01.jsonl',
        'dream.stdout.log',
        'not-an-activity-file.jsonl',
    ]
    const expired = expiredActivityFiles(names, 3, new Date('2026-08-29T12:00:00.000Z'))
    expect(expired).toEqual(['activity-2026-08-25.jsonl', 'activity-2026-07-01.jsonl'])
})

test('expiredActivityFiles never touches the process stdout/stderr logs', () => {
    const expired = expiredActivityFiles(
        ['dream.stdout.log', 'dream.stderr.log'],
        1,
        new Date('2030-01-01T00:00:00.000Z'),
    )
    expect(expired).toEqual([])
})

test('logActivity appends to today’s file and stamps ts when absent', async () => {
    await logActivity(ctx, { kind: 'cron', name: 'dream', event: 'started' })
    await logActivity(ctx, {
        kind: 'cron',
        name: 'dream',
        event: 'finished',
        outcome: 'success',
        durationMs: 1234,
    })
    const file = join(logsDir, activityFileName(new Date()))
    const events = parseActivityLines(readFileSync(file, 'utf-8'))
    expect(events).toHaveLength(2)
    expect(events[0]!.event).toBe('started')
    expect(events[1]!.durationMs).toBe(1234)
    expect(Number.isNaN(Date.parse(events[0]!.ts))).toBe(false)
})

test('logActivity creates the logs dir when it is missing', async () => {
    const missing = join(logsDir, 'nested', 'logs')
    await logActivity({ logsDir: missing } as unknown as VaultContext, {
        kind: 'daemon',
        name: 'daemon',
        event: 'brain-started',
    })
    const events = parseActivityLines(
        readFileSync(join(missing, activityFileName(new Date())), 'utf-8'),
    )
    expect(events).toHaveLength(1)
})

test('logActivity never throws when the path is unwritable', async () => {
    // A file where a directory must be: mkdir -p fails, so the append can never succeed.
    const blocked = join(logsDir, 'blocker')
    writeFileSync(blocked, 'i am a file, not a directory')
    await expect(
        logActivity({ logsDir: blocked } as unknown as VaultContext, {
            kind: 'cron',
            name: 'x',
            event: 'started',
        }),
    ).resolves.toBeUndefined()
})

test('logActivity never throws on a malformed caller-supplied ts', async () => {
    await expect(
        logActivity(ctx, {
            kind: 'cron',
            name: 'x',
            event: 'started',
            ts: 'not-a-date',
        }),
    ).resolves.toBeUndefined()
})

test('a malformed ts is replaced with a real timestamp and the event still lands', async () => {
    await logActivity(ctx, {
        kind: 'cron',
        name: 'stamped',
        event: 'started',
        ts: 'not-a-date',
    })
    const events = parseActivityLines(
        readFileSync(join(logsDir, activityFileName(new Date())), 'utf-8'),
    )
    expect(events).toHaveLength(1)
    expect(Number.isNaN(Date.parse(events[0]!.ts))).toBe(false)
})

test('concurrent logActivity calls all land, none interleave mid-line', async () => {
    const events: ActivityEvent[] = Array.from({ length: 40 }, (_, i) => ({
        ts: new Date().toISOString(),
        kind: 'cron' as const,
        name: `job-${i}`,
        event: 'started',
    }))
    await Promise.all(events.map(e => logActivity(ctx, e)))
    const parsed = parseActivityLines(
        readFileSync(join(logsDir, activityFileName(new Date())), 'utf-8'),
    )
    expect(parsed).toHaveLength(40)
    expect(new Set(parsed.map(e => e.name)).size).toBe(40)
})

test('pruneActivityLogs deletes only expired activity files and reports the count', async () => {
    writeFileSync(join(logsDir, 'activity-2020-01-01.jsonl'), '{}\n')
    writeFileSync(join(logsDir, 'activity-2020-01-02.jsonl'), '{}\n')
    writeFileSync(join(logsDir, 'dream.stdout.log'), 'keep me\n')
    const today = activityFileName(new Date())
    writeFileSync(join(logsDir, today), '{}\n')

    const removed = await pruneActivityLogs(logsDir, 30, new Date())
    expect(removed).toBe(2)
    const left = await readdir(logsDir)
    expect(left.sort()).toEqual(['dream.stdout.log', today].sort())
})

test('pruneActivityLogs returns 0 for a missing dir instead of throwing', async () => {
    await expect(
        pruneActivityLogs(join(logsDir, 'does-not-exist'), 30, new Date()),
    ).resolves.toBe(0)
})
