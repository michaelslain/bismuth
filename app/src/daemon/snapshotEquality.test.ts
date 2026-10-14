import { test, expect } from 'bun:test'
import { sameSnapshot, shareSnapshot, reuseEqual } from './snapshotEquality'
import { NO_SNAPSHOT } from './daemonSnapshotStore'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'

const cron = (name: string, running = false) =>
    ({ name, file: name, enabled: true, running }) as DaemonSnapshot['crons'][number]

const snap = (names: string[], running = false): DaemonSnapshot => ({
    ...NO_SNAPSHOT,
    crons: names.map(n => cron(n, running)),
})

test('structurally equal snapshots are the same', () => {
    expect(sameSnapshot(snap(['a', 'b']), snap(['a', 'b']))).toBe(true)
})

test('a changed field or length is not the same', () => {
    expect(sameSnapshot(snap(['a']), snap(['a'], true))).toBe(false)
    expect(sameSnapshot(snap(['a']), snap(['a', 'b']))).toBe(false)
    expect(
        sameSnapshot(NO_SNAPSHOT, {
            ...NO_SNAPSHOT,
            daemon: { ...NO_SNAPSHOT.daemon, running: true },
        }),
    ).toBe(false)
})

test('shareSnapshot returns prev when equal', () => {
    const prev = snap(['a'])
    expect(shareSnapshot(prev, snap(['a']))).toBe(prev)
})

test('shareSnapshot keeps identity of unchanged rows', () => {
    const prev = snap(['a', 'b'])
    const next = shareSnapshot(prev, snap(['a', 'b'], true))
    expect(next).not.toBe(prev)
    const kept = shareSnapshot(prev, {
        ...snap(['a', 'b']),
        crons: [cron('a'), cron('b', true)],
    })
    expect(kept.crons[0]).toBe(prev.crons[0])
    expect(kept.crons[1]).not.toBe(prev.crons[1])
})

test('reuseEqual keeps prev array or element identity', () => {
    const prev = [{ x: 1 }, { x: 2 }]
    expect(reuseEqual(prev, [{ x: 1 }, { x: 2 }])).toBe(prev)
    const out = reuseEqual(prev, [{ x: 2 }, { x: 3 }])
    expect(out[0]).toBe(prev[1])
    expect(out[1]).toEqual({ x: 3 })
})
