// Cron → activity-log wiring. fireJob is not directly callable in a test (it calls the Agent SDK
// through sendMessage), so this asserts the CONTRACT the wiring must satisfy: given the outcome
// values fireJob computes, the right event lands on disk. The pure decision half is
// cronActivityEvent; the wiring in fireJob is a one-line call to it.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    cronActivityEvent,
    cronResultDetail,
    cronStartDetail,
    parseCronResult,
} from '../src/daemon/cron'
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

test('the finished event carries the run summary; absent or empty summary adds no key', () => {
    const e = cronActivityEvent('dream', {
        result: 'success',
        startedAt: 0,
        endedAt: 1,
        summary: 'vault=2 memory=0 transcripts=1',
    })
    expect(e.summary).toBe('vault=2 memory=0 transcripts=1')
    const none = cronActivityEvent('dream', {
        result: 'success',
        startedAt: 0,
        endedAt: 1,
        summary: '',
    })
    expect('summary' in none).toBe(false)
})

test('a summary round-trips through the log', async () => {
    await logActivity(
        ctx,
        cronActivityEvent('dream', {
            result: 'success',
            startedAt: 0,
            endedAt: 5,
            summary: 'ok line',
        }),
    )
    expect(readAll()[0]!.summary).toBe('ok line')
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

test('a FAILURE marker carries its reason; a bare one and a missing one say what is missing', () => {
    const failed = parseCronResult(
        'did work\n[CRON_RESULT:FAILURE] the memory graph was unreachable\n',
    )
    expect(failed).toEqual({
        result: 'failed',
        reason: 'the memory graph was unreachable',
    })
    expect(cronResultDetail(failed)).toBe('the memory graph was unreachable')
    expect(cronResultDetail(parseCronResult('x\n[CRON_RESULT:FAILURE]'))).toBe(
        'the run reported failure without a reason',
    )
    expect(cronResultDetail(parseCronResult('no marker at all'))).toBe(
        'the run ended without a [CRON_RESULT] marker',
    )
    expect(parseCronResult('[CRON_RESULT:SUCCESS]')).toEqual({
        result: 'success',
    })
    expect(cronResultDetail({ result: 'success' })).toBe(undefined)
})

test('the last marker wins, so an earlier FAILURE quoted in the output is not the verdict', () => {
    expect(
        parseCronResult('[CRON_RESULT:FAILURE] old\n[CRON_RESULT:SUCCESS]').result,
    ).toBe('success')
})

test('a started event says why the run began and the model the cron asked for', () => {
    expect(cronStartDetail('schedule', {})).toBe('on schedule')
    expect(cronStartDetail('catch-up', { model: 'sonnet', effort: 'high' })).toBe(
        'catching up on a missed run // sonnet // high effort',
    )
    expect(cronStartDetail('trigger', { tier: 'deep' })).toBe(
        'run on request // tier deep',
    )
    expect(cronStartDetail('recovery', {})).toBe(
        'resumed after a daemon restart',
    )
    expect(cronStartDetail('file-change', {}, ['a.md', 'b/c.md'])).toBe(
        'file changed: a.md, b/c.md',
    )
})
