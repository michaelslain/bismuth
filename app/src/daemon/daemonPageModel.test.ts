import { test, expect } from 'bun:test'
import {
    hasRecentFailure,
    faceCaption,
    barReadouts,
    initialFacet,
    facetCount,
    DAEMON_FACETS,
    RECENT_FAILURE_MS,
} from './daemonPageModel'
import type { DaemonSnapshot, DaemonCron } from '../../../core/src/daemonGraph'

const NOW = Date.parse('2026-09-14T15:00:00Z')
const cron = (over: Partial<DaemonCron>): DaemonCron => ({
    name: 'dream',
    file: 'dream',
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
    processes: [{ name: 'sync', file: 'sync', enabled: true, running: false }],
    identity: { name: 'daemon', blurb: '' },
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

test('a killed cron (a timeout) hurts the same as an explicit failed result', () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString()
    expect(
        hasRecentFailure(
            [cron({ lastFired: { timestamp: at(60_000), result: 'killed' } })],
            NOW,
        ),
    ).toBe(true)
})

test('captions', () => {
    expect(faceCaption(snap([], false), 'asleep', NOW, false)).toBe(
        'asleep // daemon is off',
    )
    expect(
        faceCaption(
            snap([
                cron({ running: true }),
                cron({ name: 'review', running: true }),
            ]),
            'busy',
            NOW,
            true,
        ),
    ).toBe('working // dream +1')
    expect(faceCaption(snap([]), 'idle', NOW, true)).toBe(
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
            true,
        ),
    ).toStartWith('watching // last: dream ')
})

test('enabled but not running reads as "not running", never "off" — the setting says on', () => {
    expect(faceCaption(snap([], false), 'asleep', NOW, true)).toBe(
        'asleep // daemon not running',
    )
})

test('the watching caption names the MOST RECENT run, with its age', () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString()
    expect(
        faceCaption(
            snap([
                cron({
                    name: 'old',
                    lastFired: { timestamp: at(86_400_000), result: 'success' },
                }),
                cron({
                    name: 'fresh',
                    lastFired: { timestamp: at(7_200_000), result: 'success' },
                }),
            ]),
            'idle',
            NOW,
            true,
        ),
    ).toBe('watching // last: fresh 2h ago')
})

test('facet order', () => {
    expect(DAEMON_FACETS).toEqual([
        'inbox',
        'crons',
        'services',
        'memory',
        'log',
    ])
})

test('initial facet: anything due wins outright, else the remembered facet, else crons', () => {
    expect(initialFacet(3, 'log')).toBe('inbox')
    expect(initialFacet(0, null)).toBe('crons')
    expect(initialFacet(0, 'memory')).toBe('memory')
    expect(initialFacet(0, 'services')).toBe('services')
})

test('initial facet: an unrecognised remembered value falls back to crons, not the value itself', () => {
    expect(initialFacet(0, 'bogus')).toBe('crons')
    expect(initialFacet(0, '')).toBe('crons')
})

test('facet counts read the matching field, log has none', () => {
    const c = { due: 3, crons: 4, services: 2, memory: 118 }
    expect(facetCount('inbox', c)).toBe(3)
    expect(facetCount('crons', c)).toBe(4)
    expect(facetCount('services', c)).toBe(2)
    expect(facetCount('memory', c)).toBe(118)
    expect(facetCount('log', c)).toBeUndefined()
})

test('an unknown memory count (not yet fetched) is omitted, not zero', () => {
    expect(
        facetCount('memory', { due: 0, crons: 0, services: 0 }),
    ).toBeUndefined()
})

test('bar readouts are the status alone now — counts moved onto the facet labels', () => {
    expect(barReadouts('watching // last: dream 4m ago')).toEqual([
        'watching // last: dream 4m ago',
    ])
    expect(barReadouts('')).toEqual([])
})
