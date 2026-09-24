import { test, expect } from 'bun:test'
import { cronStatus, cronTone } from './cronStatus'
import type { DaemonCron } from '../../../core/src/daemonGraph'

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

test('disabled wins over everything else', () => {
    expect(
        cronStatus(
            cron({
                enabled: false,
                running: true,
                lastFired: { timestamp: 't', result: 'failed' },
            }),
        ),
    ).toBe('disabled')
})

test('running wins over a past failure', () => {
    expect(
        cronStatus(
            cron({
                running: true,
                lastFired: { timestamp: 't', result: 'failed' },
            }),
        ),
    ).toBe('running')
})

test('a killed run reads as failed, same as an explicit failed result', () => {
    expect(
        cronStatus(cron({ lastFired: { timestamp: 't', result: 'killed' } })),
    ).toBe('failed')
    expect(
        cronStatus(cron({ lastFired: { timestamp: 't', result: 'failed' } })),
    ).toBe('failed')
})

test('a successful last run is idle', () => {
    expect(
        cronStatus(cron({ lastFired: { timestamp: 't', result: 'success' } })),
    ).toBe('idle')
})

test('no run yet is idle', () => {
    expect(cronStatus(cron({}))).toBe('idle')
})

test('cronTone matches cronStatus for the ordinary keys', () => {
    expect(cronTone(cron({ enabled: false }), true)).toBe('off')
    expect(
        cronTone(cron({ lastFired: { timestamp: 't', result: 'failed' } }), true),
    ).toBe('failed')
    expect(cronTone(cron({ running: true }), true)).toBe('running')
    expect(
        cronTone(cron({ lastFired: { timestamp: 't', result: 'success' } }), true),
    ).toBe('ok')
    expect(cronTone(cron({}), true)).toBe('idle')
})

test('stale running + offline + failed lastFired reads as failed, not idle', () => {
    expect(
        cronTone(
            cron({
                running: true,
                lastFired: { timestamp: 't', result: 'failed' },
            }),
            false,
        ),
    ).toBe('failed')
})

test('stale running + offline + a killed lastFired also reads as failed', () => {
    expect(
        cronTone(
            cron({
                running: true,
                lastFired: { timestamp: 't', result: 'killed' },
            }),
            false,
        ),
    ).toBe('failed')
})

test('stale running + offline + a successful lastFired reads as ok', () => {
    expect(
        cronTone(
            cron({
                running: true,
                lastFired: { timestamp: 't', result: 'success' },
            }),
            false,
        ),
    ).toBe('ok')
})

test('stale running + offline + never fired reads as idle', () => {
    expect(cronTone(cron({ running: true }), false)).toBe('idle')
})
