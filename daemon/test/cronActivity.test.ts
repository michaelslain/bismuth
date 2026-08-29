// Cron → activity-log wiring. fireJob is not directly callable in a test (it calls the Agent SDK
// through sendMessage), so this asserts the CONTRACT the wiring must satisfy: given the outcome
// values fireJob computes, the right event lands on disk. The pure decision half is
// cronActivityEvent; the wiring in fireJob is a one-line call to it.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cronActivityEvent } from '../src/daemon/cron'
import {
    logActivity,
    parseActivityLines,
    activityFileName,
} from '../src/lib/activityLog'
import type { VaultContext } from '../src/lib/config'

let logsDir: string
let ctx: VaultContext

beforeEach(() => {
    logsDir = mkdtempSync(join(tmpdir(), 'bismuth-cron-activity-'))
    ctx = { logsDir } as unknown as VaultContext
})
afterEach(() => rmSync(logsDir, { recursive: true, force: true }))

const readAll = () =>
    parseActivityLines(
        readFileSync(join(logsDir, activityFileName(new Date())), 'utf-8'),
    )

test('a successful run becomes a finished/success event carrying its duration', () => {
    const e = cronActivityEvent('dream', {
        result: 'success',
        startedAt: 1000,
        endedAt: 49213,
    })
    expect(e).toMatchObject({
        kind: 'cron',
        name: 'dream',
        event: 'finished',
        outcome: 'success',
        durationMs: 48213,
    })
})

test('a failure carries its cause so a post-mortem can see what drove the backoff', () => {
    const e = cronActivityEvent('dream', {
        result: 'failed',
        cause: 'environment',
        startedAt: 0,
        endedAt: 500,
        detail: 'fetch failed',
    })
    expect(e).toMatchObject({
        event: 'finished',
        outcome: 'failed',
        cause: 'environment',
        durationMs: 500,
        detail: 'fetch failed',
    })
})

test('a timeout kill is recorded as killed/timeout, not as a generic failure', () => {
    const e = cronActivityEvent('vault-review', {
        result: 'killed',
        cause: 'timeout',
        startedAt: 0,
        endedAt: 900_000,
    })
    expect(e.outcome).toBe('killed')
    expect(e.cause).toBe('timeout')
})

test('a skip is an event in its own right, with the reason preserved verbatim', () => {
    const e = cronActivityEvent('dream', {
        result: 'skipped',
        detail: 'skipped: no changes since 2026-07-20T10:00:00Z',
    })
    expect(e).toMatchObject({
        event: 'skipped',
        outcome: 'skipped',
        detail: 'skipped: no changes since 2026-07-20T10:00:00Z',
    })
    // A skip never started, so it has no duration to report.
    expect(e.durationMs).toBeUndefined()
})

test('cause and detail are omitted rather than sent as undefined keys', () => {
    const e = cronActivityEvent('dream', {
        result: 'success',
        startedAt: 0,
        endedAt: 1,
    })
    expect('cause' in e).toBe(false)
    expect('detail' in e).toBe(false)
})

test('a started event and its finished event round-trip through the log in order', async () => {
    await logActivity(ctx, { kind: 'cron', name: 'dream', event: 'started' })
    await logActivity(
        ctx,
        cronActivityEvent('dream', {
            result: 'success',
            startedAt: 0,
            endedAt: 1200,
        }),
    )
    const events = readAll()
    expect(events.map(e => e.event)).toEqual(['started', 'finished'])
    expect(events[1]!.durationMs).toBe(1200)
})
