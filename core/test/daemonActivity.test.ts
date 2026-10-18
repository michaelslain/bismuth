// The never-throwing reader over <vault>/.daemon/logs. Fixture style follows
// core/test/daemonGraph.test.ts: a real temp dir, hand-built files, and assertions against both
// well-formed and deliberately broken input.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import {
    appendActivity,
    readActivity,
    deleteActivityEntry,
    restoreActivityEntry,
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

test('appendActivity adds a line to the day file the reader reads, beside the daemon\'s own', () => {
    writeFileSync(
        join(logsDir, 'activity-2026-08-29.jsonl'),
        line({ ts: '2026-08-29T09:00:00.000Z' }) + '\n',
    )
    appendActivity(daemonDir, {
        ts: '2026-08-29T10:30:00.000Z',
        kind: 'doctor',
        name: 'legacy.skills-dir',
        event: 'repair',
        outcome: 'success',
        detail: 'delete ~/.bismuth/skills',
    })
    const all = readActivity(daemonDir)
    expect(all.map(e => [e.kind, e.name])).toEqual([
        ['doctor', 'legacy.skills-dir'],
        ['cron', 'dream'],
    ])
    expect(readActivity(daemonDir, { kind: 'doctor' })[0].outcome).toBe('success')
})

test('appendActivity creates logs/ under an existing daemon dir and skips a missing one', () => {
    rmSync(logsDir, { recursive: true })
    const ev: ActivityEvent = {
        ts: '2026-08-30T00:00:00.000Z',
        kind: 'doctor',
        name: 'x',
        event: 'repair',
    }
    appendActivity(daemonDir, ev)
    expect(readActivity(daemonDir).length).toBe(1)
    const missing = join(daemonDir, 'nope')
    expect(() => appendActivity(missing, ev)).not.toThrow()
    expect(readActivity(missing)).toEqual([])
})

test('every event names the day file it was read from', () => {
    writeFileSync(join(logsDir, 'activity-2026-08-29.jsonl'), line({}) + '\n')
    expect(readActivity(daemonDir)[0].file).toBe('activity-2026-08-29.jsonl')
})

test('deleteActivityEntry removes only the matching line and keeps the rest byte-for-byte', () => {
    const file = 'activity-2026-08-29.jsonl'
    const keep1 = line({ ts: '2026-08-29T09:00:00.000Z', name: 'a' })
    const gone = line({ ts: '2026-08-29T10:00:00.000Z', name: 'b', outcome: 'failed' })
    const keep2 = line({ ts: '2026-08-29T11:00:00.000Z', name: 'c' })
    writeFileSync(join(logsDir, file), [keep1, gone, keep2].join('\n') + '\n')
    const target = readActivity(daemonDir).find(e => e.name === 'b')!
    expect(deleteActivityEntry(daemonDir, { ...target, file })).toBe(gone)
    expect(readFileSync(join(logsDir, file), 'utf-8')).toBe(
        [keep1, keep2].join('\n') + '\n',
    )
    // The undo puts the removed line back in its time slot, byte-for-byte.
    expect(restoreActivityEntry(daemonDir, file, gone)).toBe(true)
    expect(readFileSync(join(logsDir, file), 'utf-8')).toBe(
        [keep1, gone, keep2].join('\n') + '\n',
    )
})

test('restoreActivityEntry appends the latest entry, recreates a removed day file and refuses a non-event', () => {
    const file = 'activity-2026-08-29.jsonl'
    const early = line({ ts: '2026-08-29T09:00:00.000Z' })
    const late = line({ ts: '2026-08-29T12:00:00.000Z' })
    writeFileSync(join(logsDir, file), early + '\n')
    expect(restoreActivityEntry(daemonDir, file, late)).toBe(true)
    expect(readFileSync(join(logsDir, file), 'utf-8')).toBe([early, late].join('\n') + '\n')
    const other = 'activity-2026-08-30.jsonl'
    expect(restoreActivityEntry(daemonDir, other, late)).toBe(true)
    expect(readFileSync(join(logsDir, other), 'utf-8')).toBe(late + '\n')
    expect(restoreActivityEntry(daemonDir, file, 'not json')).toBe(false)
    expect(restoreActivityEntry(daemonDir, 'crons.md', late)).toBe(false)
})

test('deleteActivityEntry tells an outcome apart and reports a miss', () => {
    const file = 'activity-2026-08-29.jsonl'
    writeFileSync(join(logsDir, file), line({ outcome: 'success' }) + '\n')
    const ref = {
        file,
        ts: '2026-08-29T10:00:00.000Z',
        kind: 'cron',
        name: 'dream',
        event: 'finished',
    }
    expect(deleteActivityEntry(daemonDir, { ...ref, outcome: 'failed' })).toBeNull()
    expect(deleteActivityEntry(daemonDir, { ...ref, outcome: 'success' })).not.toBeNull()
    expect(readActivity(daemonDir)).toEqual([])
})

test('deleteActivityEntry refuses a file name that is not a day file', () => {
    writeFileSync(join(daemonDir, 'crons.md'), line({}) + '\n')
    const ref = {
        ts: '2026-08-29T10:00:00.000Z',
        kind: 'cron',
        name: 'dream',
        event: 'finished',
    }
    expect(deleteActivityEntry(daemonDir, { ...ref, file: '../crons.md' })).toBeNull()
    expect(deleteActivityEntry(daemonDir, { ...ref, file: 'activity-2026-08-30.jsonl' })).toBeNull()
    expect(readFileSync(join(daemonDir, 'crons.md'), 'utf-8')).toBe(line({}) + '\n')
})
