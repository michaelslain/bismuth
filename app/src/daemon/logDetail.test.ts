import { describe, expect, test } from 'bun:test'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import {
    detailMeta,
    eventKey,
    logPath,
    fullDuration,
    fullTime,
} from './logDetail'

const ev = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
    ts: new Date(2026, 9, 12, 20, 11, 24).toISOString(),
    kind: 'cron',
    name: 'answer-emails',
    event: 'finished',
    outcome: 'success',
    ...over,
})

describe('logDetail', () => {
    test('eventKey is equal for equal events and differs by outcome', () => {
        expect(eventKey(ev())).toBe(eventKey(ev()))
        expect(eventKey(ev())).not.toBe(eventKey(ev({ outcome: 'failed' })))
    })

    test('fullTime keeps seconds', () => {
        expect(fullTime(ev().ts)).toBe('Oct 12, 20:11:24')
    })

    test('fullDuration buckets', () => {
        expect(fullDuration(undefined)).toBeNull()
        expect(fullDuration(420)).toBe('420ms')
        expect(fullDuration(1400)).toBe('1.4s')
        expect(fullDuration(192000)).toBe('3m 12s')
        expect(fullDuration(120000)).toBe('2m')
    })

    test('detailMeta joins with // and drops missing parts', () => {
        expect(detailMeta(ev())).toBe('Oct 12, 20:11:24 // cron')
        expect(detailMeta(ev({ durationMs: 1400, cause: 'manual' }))).toBe(
            'Oct 12, 20:11:24 // cron // 1.4s // cause manual',
        )
    })

    test('logPath names the day file under .daemon/logs, null without one', () => {
        expect(logPath(ev({ file: 'activity-2026-10-12.jsonl' }))).toBe(
            '.daemon/logs/activity-2026-10-12.jsonl',
        )
        expect(logPath(ev())).toBeNull()
    })
})
