import { test, expect } from 'bun:test'
import activityLine from './activityLine'

const now = new Date('2026-09-14T15:00:00')

test('a failed cron today', () => {
    const l = activityLine(
        {
            ts: new Date('2026-09-14T13:02:00').toISOString(),
            kind: 'cron',
            name: 'dream',
            event: 'fired',
            outcome: 'failed',
            durationMs: 42000,
        },
        now,
    )
    expect(l).toEqual({
        time: '13:02',
        who: 'dream',
        what: 'fired failed',
        tone: 'fail',
        duration: '42s',
        note: null,
    })
})

test('a killed cron (a timeout) reads as a failure, same as an explicit failed result', () => {
    const l = activityLine(
        {
            ts: new Date('2026-09-14T13:02:00').toISOString(),
            kind: 'cron',
            name: 'dream',
            event: 'fired',
            outcome: 'killed',
        },
        now,
    )
    expect(l.tone).toBe('fail')
    expect(l.what).toBe('fired killed')
})

test('an older event shows the date and no duration', () => {
    const l = activityLine(
        {
            ts: new Date('2026-09-12T08:00:00').toISOString(),
            kind: 'daemon',
            name: '',
            event: 'brain-start',
        },
        now,
    )
    expect(l.time).toBe('Sep 12')
    expect(l.who).toBe('daemon')
    expect(l.duration).toBe(null)
    expect(l.tone).toBe('ok')
})

test('tones and durations', () => {
    const at = new Date('2026-09-14T14:00:00').toISOString()
    expect(
        activityLine(
            { ts: at, kind: 'process', name: 'sync', event: 'started' },
            now,
        ).tone,
    ).toBe('live')
    expect(
        activityLine(
            {
                ts: at,
                kind: 'cron',
                name: 'x',
                event: 'fired',
                outcome: 'skipped',
            },
            now,
        ).tone,
    ).toBe('quiet')
    expect(
        activityLine(
            {
                ts: at,
                kind: 'cron',
                name: 'x',
                event: 'fired',
                outcome: 'success',
                durationMs: 400,
            },
            now,
        ).duration,
    ).toBe('<1s')
    expect(
        activityLine(
            {
                ts: at,
                kind: 'cron',
                name: 'x',
                event: 'fired',
                outcome: 'success',
                durationMs: 180000,
            },
            now,
        ).duration,
    ).toBe('3m')
})

test('the note says why: an environment cause, detail, then a report line the detail did not already give', () => {
    const at = new Date('2026-09-14T14:00:00').toISOString()
    expect(
        activityLine(
            {
                ts: at,
                kind: 'cron',
                name: 'dream',
                event: 'finished',
                outcome: 'failed',
                cause: 'job',
                detail: 'the memory graph was unreachable',
                summary: 'vault=5 memory=1',
            },
            now,
        ).note,
    ).toBe('the memory graph was unreachable // vault=5 memory=1')
    expect(
        activityLine(
            {
                ts: at,
                kind: 'cron',
                name: 'dream',
                event: 'skipped',
                outcome: 'skipped',
                detail: 'skipped: no changes since 2026-10-12T18:17:52-07:00',
            },
            now,
        ).note,
    ).toBe('no changes since 2026-10-12T18:17:52-07:00')
    expect(
        activityLine(
            {
                ts: at,
                kind: 'cron',
                name: 'dream',
                event: 'started',
                detail: 'on schedule',
            },
            now,
        ).note,
    ).toBe('on schedule')
})

test('a skip says skipped once, and only an environment cause is named', () => {
    const at = new Date('2026-09-14T14:00:00').toISOString()
    const skip = { ts: at, kind: 'cron', name: 'dream', outcome: 'skipped' }
    expect(activityLine({ ...skip, event: 'skipped' }, now).what).toBe('skipped')
    expect(activityLine({ ...skip, event: 'finished' }, now).what).toBe('skipped')
    expect(
        activityLine(
            { ...skip, event: 'finished', detail: 'skipped: no changes' },
            now,
        ).note,
    ).toBe('no changes')
    const killed = activityLine(
        {
            ts: at,
            kind: 'cron',
            name: 'dream',
            event: 'finished',
            outcome: 'killed',
            cause: 'timeout',
            detail: 'aborted after 600s',
        },
        now,
    )
    expect(killed.note).toBe('aborted after 600s')
    const env = activityLine(
        {
            ts: at,
            kind: 'cron',
            name: 'dream',
            event: 'finished',
            outcome: 'failed',
            cause: 'environment',
            detail: 'claude not found on PATH',
        },
        now,
    )
    expect(env.note).toBe('environment // claude not found on PATH')
})
