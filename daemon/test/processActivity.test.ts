// Process → activity-log wiring. spawnProcess/stopProcess touch real child processes and have no
// test harness in this repo, so the tested unit is the pure projection they call.
import { test, expect } from 'bun:test'
import { processActivityEvent } from '../src/daemon/process'

test('a spawn records the pid in detail', () => {
    expect(processActivityEvent('indexer', { event: 'started', pid: 4242 })).toMatchObject({
        kind: 'process',
        name: 'indexer',
        event: 'started',
        detail: 'pid 4242',
    })
})

test('a clean exit is recorded as success', () => {
    const e = processActivityEvent('indexer', { event: 'exited', code: 0 })
    expect(e.outcome).toBe('success')
    expect(e.detail).toBe('code 0')
})

test('a non-zero exit is recorded as failed', () => {
    const e = processActivityEvent('indexer', { event: 'exited', code: 3 })
    expect(e.outcome).toBe('failed')
    expect(e.detail).toBe('code 3')
})

test('a signal exit is recorded as killed and names the signal', () => {
    const e = processActivityEvent('indexer', { event: 'exited', signal: 'SIGKILL' })
    expect(e.outcome).toBe('killed')
    expect(e.detail).toBe('signal SIGKILL')
})

test('a signal wins over a code when both are present, matching the exit handler', () => {
    const e = processActivityEvent('indexer', {
        event: 'exited',
        code: 0,
        signal: 'SIGTERM',
    })
    expect(e.outcome).toBe('killed')
    expect(e.detail).toBe('signal SIGTERM')
})

test('a restart records the backoff and the attempt number', () => {
    const e = processActivityEvent('indexer', {
        event: 'restarting',
        backoffMs: 4000,
        restarts: 3,
    })
    expect(e.event).toBe('restarting')
    expect(e.detail).toBe('in 4000ms (restart #3)')
    // A restart is a step, not a terminal state — no outcome to claim.
    expect(e.outcome).toBeUndefined()
})

test('a reaped orphan says which pid and why', () => {
    const e = processActivityEvent('indexer', {
        event: 'reaped',
        pid: 99,
        detail: 'stale pid file',
    })
    expect(e).toMatchObject({ event: 'reaped', detail: 'pid 99 (stale pid file)' })
})
