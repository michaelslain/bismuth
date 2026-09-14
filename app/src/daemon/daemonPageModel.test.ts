import { test, expect } from 'bun:test'
import {
    hasRecentFailure,
    faceCaption,
    barReadouts,
    RECENT_FAILURE_MS,
} from './daemonPageModel'
import type { DaemonSnapshot, DaemonCron } from '../../../core/src/daemonGraph'

const NOW = Date.parse('2026-09-14T15:00:00Z')
const cron = (over: Partial<DaemonCron>): DaemonCron => ({
    name: 'dream',
    schedule: '0 3 * * *',
    on: 'schedule',
    watch: null,
    enabled: true,
    lastFired: null,
    running: false,
    startedAt: null,
    ...over,
})
const snap = (crons: DaemonCron[], running = true): DaemonSnapshot => ({
    daemon: { label: 'daemon', running, home: '/v/.daemon' },
    crons,
    processes: [{ name: 'sync', enabled: true, running: true }],
})

test('recent failure window', () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString()
    expect(
        hasRecentFailure(
            [cron({ lastFired: { timestamp: at(60_000), result: 'failed' } })],
            NOW,
        ),
    ).toBe(true)
    expect(
        hasRecentFailure(
            [
                cron({
                    lastFired: {
                        timestamp: at(RECENT_FAILURE_MS + 1000),
                        result: 'failed',
                    },
                }),
            ],
            NOW,
        ),
    ).toBe(false)
    expect(
        hasRecentFailure(
            [
                cron({
                    enabled: false,
                    lastFired: { timestamp: at(1000), result: 'failed' },
                }),
            ],
            NOW,
        ),
    ).toBe(false)
    expect(
        hasRecentFailure(
            [cron({ lastFired: { timestamp: at(1000), result: 'success' } })],
            NOW,
        ),
    ).toBe(false)
})

test('captions', () => {
    expect(faceCaption(snap([], false), 'asleep', NOW)).toBe(
        'asleep // daemon is off',
    )
    expect(
        faceCaption(
            snap([cron({ running: true }), cron({ name: 'review', running: true })]),
            'busy',
            NOW,
        ),
    ).toBe('working // dream +1')
    expect(faceCaption(snap([]), 'idle', NOW)).toBe(
        'watching // nothing has run yet',
    )
    expect(
        faceCaption(
            snap([
                cron({
                    lastFired: {
                        timestamp: new Date(NOW - 7_200_000).toISOString(),
                        result: 'success',
                    },
                }),
            ]),
            'idle',
            NOW,
        ),
    ).toStartWith('watching // last: dream ')
})

test('the watching caption names the MOST RECENT run, with its age', () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString()
    expect(
        faceCaption(
            snap([
                cron({ name: 'old', lastFired: { timestamp: at(86_400_000), result: 'success' } }),
                cron({ name: 'fresh', lastFired: { timestamp: at(7_200_000), result: 'success' } }),
            ]),
            'idle',
            NOW,
        ),
    ).toBe('watching // last: fresh 2h ago')
})

test('readouts pluralize and hide an empty inbox', () => {
    expect(barReadouts(snap([cron({})]), 0)).toEqual(['1 cron', '1 service'])
    expect(barReadouts(snap([cron({}), cron({ name: 'b' })]), 3)).toEqual([
        '2 crons',
        '1 service',
        '3 in inbox',
    ])
})
