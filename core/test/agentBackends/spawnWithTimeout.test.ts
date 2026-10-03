import { test, expect } from 'bun:test'
import { spawnWithTimeout } from '../../src/agentBackends/spawnWithTimeout'

test('a fast exit captures output and is not timed out', async () => {
    const r = await spawnWithTimeout(
        ['sh', '-c', 'echo out; echo err >&2'],
        5000,
    )
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('out')
    expect(r.stderr.trim()).toBe('err')
    expect(r.timedOut).toBe(false)
    expect(r.error).toBeUndefined()
})

test('a fast silent non-zero exit is not a timeout', async () => {
    const r = await spawnWithTimeout(['sh', '-c', 'exit 3'], 5000)
    expect(r.code).toBe(3)
    expect(r.timedOut).toBe(false)
})

test('the timer path kills the child and sets timedOut', async () => {
    const r = await spawnWithTimeout(['sleep', '30'], 100)
    expect(r.timedOut).toBe(true)
    expect(r.code).not.toBe(0)
})

test('a spawn failure reports error with a null code, never throws', async () => {
    const r = await spawnWithTimeout(['/nonexistent/binary-xyz'], 1000)
    expect(r.code).toBeNull()
    expect(r.timedOut).toBe(false)
    expect(r.error).toBeTruthy()
})
