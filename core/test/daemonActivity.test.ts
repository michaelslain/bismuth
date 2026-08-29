// The never-throwing reader over <vault>/.daemon/logs. Fixture style follows
// core/test/daemonGraph.test.ts: a real temp dir, hand-built files, and assertions against both
// well-formed and deliberately broken input.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import {
    readActivity,
    ACTIVITY_MAX_LIMIT,
    type ActivityEvent,
} from '../src/daemonActivity'

let daemonDir: string
let logsDir: string

const line = (e: Partial<ActivityEvent>) =>
    JSON.stringify({
        ts: '2026-08-29T10:00:00.000Z',
        kind: 'cron',
        name: 'dream',
        event: 'finished',
        ...e,
    })

beforeEach(() => {
    daemonDir = tempDir('bismuth-activity-read-')
    logsDir = join(daemonDir, 'logs')
    mkdirSync(logsDir, { recursive: true })
})
afterEach(() => rmSync(daemonDir, { recursive: true, force: true }))

test('returns newest first across multiple day files', () => {
    writeFileSync(
        join(logsDir, 'activity-2026-08-28.jsonl'),
        [
            line({ ts: '2026-08-28T09:00:00.000Z', name: 'older' }),
            line({ ts: '2026-08-28T10:00:00.000Z', name: 'middle' }),
        ].join('\n') + '\n',
    )
    writeFileSync(
        join(logsDir, 'activity-2026-08-29.jsonl'),
        line({ ts: '2026-08-29T09:00:00.000Z', name: 'newest' }) + '\n',
    )
    expect(readActivity(daemonDir).map(e => e.name)).toEqual([
        'newest',
        'middle',
        'older',
    ])
})

test('a missing logs dir yields an empty list instead of throwing', () => {
    expect(readActivity(join(daemonDir, 'nope'))).toEqual([])
})

test('a malformed line is skipped and its file still yields the good lines', () => {
    writeFileSync(
        join(logsDir, 'activity-2026-08-29.jsonl'),
        [line({ name: 'good-1' }), '{ truncated', line({ name: 'good-2' })].join(
            '\n',
        ) + '\n',
    )
    expect(readActivity(daemonDir).map(e => e.name).sort()).toEqual([
        'good-1',
        'good-2',
    ])
})

test('ignores the process stdout/stderr logs sharing the directory', () => {
    writeFileSync(join(logsDir, 'indexer.stdout.log'), 'not json at all\n')
    writeFileSync(join(logsDir, 'indexer.stderr.log'), 'also not json\n')
    writeFileSync(join(logsDir, 'activity-2026-08-29.jsonl'), line({}) + '\n')
    expect(readActivity(daemonDir)).toHaveLength(1)
})

test('limit caps the result and defaults to the newest events', () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
        line({
            ts: `2026-08-29T${String(i).padStart(2, '0')}:00:00.000Z`,
            name: `e${i}`,
        }),
    )
    writeFileSync(join(logsDir, 'activity-2026-08-29.jsonl'), lines.join('\n') + '\n')
    const got = readActivity(daemonDir, { limit: 5 })
    expect(got).toHaveLength(5)
    expect(got[0]!.name).toBe('e19')
})

test('limit is clamped to the maximum and a nonsense limit falls back to the default', () => {
    writeFileSync(join(logsDir, 'activity-2026-08-29.jsonl'), line({}) + '\n')
    expect(() => readActivity(daemonDir, { limit: 10_000_000 })).not.toThrow()
    expect(readActivity(daemonDir, { limit: 10_000_000 })).toHaveLength(1)
    expect(readActivity(daemonDir, { limit: Number.NaN })).toHaveLength(1)
    expect(readActivity(daemonDir, { limit: -5 })).toHaveLength(1)
    expect(ACTIVITY_MAX_LIMIT).toBeGreaterThan(0)
})

test('a limit above the maximum is clamped to ACTIVITY_MAX_LIMIT, keeping the newest', () => {
    const total = ACTIVITY_MAX_LIMIT + 500
    writeFileSync(
        join(logsDir, 'activity-2026-08-29.jsonl'),
        Array.from({ length: total }, (_, i) =>
            line({
                ts: new Date(Date.UTC(2026, 7, 29, 0, 0, 0, i)).toISOString(),
                name: `e${i}`,
            }),
        ).join('\n') + '\n',
    )
    const got = readActivity(daemonDir, { limit: 10_000_000 })
    expect(got).toHaveLength(ACTIVITY_MAX_LIMIT)
    // Newest first, and the window is the NEWEST slice — not the oldest, and not an arbitrary one.
    expect(got[0]!.name).toBe(`e${total - 1}`)
    expect(got[got.length - 1]!.name).toBe(`e${total - ACTIVITY_MAX_LIMIT}`)
})

test('a fractional limit is floored rather than rejected', () => {
    writeFileSync(
        join(logsDir, 'activity-2026-08-29.jsonl'),
        Array.from({ length: 20 }, (_, i) =>
            line({
                ts: new Date(Date.UTC(2026, 7, 29, 0, 0, 0, i)).toISOString(),
                name: `e${i}`,
            }),
        ).join('\n') + '\n',
    )
    expect(readActivity(daemonDir, { limit: 7.9 })).toHaveLength(7)
})

test('filters by kind and by name', () => {
    writeFileSync(
        join(logsDir, 'activity-2026-08-29.jsonl'),
        [
            line({ kind: 'cron', name: 'dream' }),
            line({ kind: 'process', name: 'indexer' }),
            line({ kind: 'cron', name: 'vault-review' }),
        ].join('\n') + '\n',
    )
    expect(readActivity(daemonDir, { kind: 'cron' })).toHaveLength(2)
    expect(readActivity(daemonDir, { name: 'indexer' })).toHaveLength(1)
    expect(readActivity(daemonDir, { kind: 'cron', name: 'indexer' })).toHaveLength(0)
})

test('since filters to events at or after the given instant', () => {
    writeFileSync(
        join(logsDir, 'activity-2026-08-29.jsonl'),
        [
            line({ ts: '2026-08-29T08:00:00.000Z', name: 'before' }),
            line({ ts: '2026-08-29T12:00:00.000Z', name: 'after' }),
        ].join('\n') + '\n',
    )
    const got = readActivity(daemonDir, { since: '2026-08-29T10:00:00.000Z' })
    expect(got.map(e => e.name)).toEqual(['after'])
})

test('an unparseable since is ignored rather than filtering everything out', () => {
    writeFileSync(join(logsDir, 'activity-2026-08-29.jsonl'), line({}) + '\n')
    expect(readActivity(daemonDir, { since: 'not a date' })).toHaveLength(1)
})
