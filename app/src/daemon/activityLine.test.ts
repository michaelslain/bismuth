import { test, expect } from 'bun:test'
import activityLine from './activityLine'

const now = new Date('2026-09-14T15:00:00')

test('a failed cron today', () => {
    const l = activityLine({ ts: new Date('2026-09-14T13:02:00').toISOString(), kind: 'cron', name: 'dream', event: 'fired', outcome: 'failed', durationMs: 42000 }, now)
    expect(l).toEqual({ time: '13:02', who: 'dream', what: 'fired failed', tone: 'fail', duration: '42s' })
})

test('an older event shows the date and no duration', () => {
    const l = activityLine({ ts: new Date('2026-09-12T08:00:00').toISOString(), kind: 'daemon', name: '', event: 'brain-start' }, now)
    expect(l.time).toBe('Sep 12')
    expect(l.who).toBe('daemon')
    expect(l.duration).toBe(null)
    expect(l.tone).toBe('ok')
})

test('tones and durations', () => {
    const at = new Date('2026-09-14T14:00:00').toISOString()
    expect(activityLine({ ts: at, kind: 'process', name: 'sync', event: 'started' }, now).tone).toBe('live')
    expect(activityLine({ ts: at, kind: 'cron', name: 'x', event: 'fired', outcome: 'skipped' }, now).tone).toBe('quiet')
    expect(activityLine({ ts: at, kind: 'cron', name: 'x', event: 'fired', outcome: 'success', durationMs: 400 }, now).duration).toBe('<1s')
    expect(activityLine({ ts: at, kind: 'cron', name: 'x', event: 'fired', outcome: 'success', durationMs: 180000 }, now).duration).toBe('3m')
})
