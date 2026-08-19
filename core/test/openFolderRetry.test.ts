import { tempDir } from './helpers'
// github issue #6: "Open folder… silently fails after a few folder opens".
// findFreePort() closes its probe socket before the child binds, so two rapid opens can be
// handed the same port and the loser exits before it is ready. The port cannot be held across
// a spawn boundary, so spawnVaultBackend must RETRY on a fresh port instead of giving up.
import { describe, expect, it } from 'bun:test'
import { spawnVaultBackend } from '../src/openFolder'

const vault = tempDir('of-retry-vault-')
const memory = tempDir('of-retry-memory-')
const base = {
    folder: vault,
    memory,
    serverEntry: '/nonexistent/server.ts',
    waitMs: 2000,
}

/** A child that dies immediately — stands in for "another process took the port". */
const deadChild = (pid: number) => ({
    pid,
    kill: () => {},
    exited: Promise.resolve(1),
})
/** A child that lives. */
const liveChild = (pid: number) => ({
    pid,
    kill: () => {},
    exited: new Promise<number>(() => {}),
})

describe('spawnVaultBackend port-collision retry', () => {
    it('retries on a fresh port when the first child exits before it is ready', async () => {
        const ports: number[] = []
        let n = 0
        const spawned = await spawnVaultBackend({
            ...base,
            spawn: cmd => {
                ports.push(Number(cmd[cmd.indexOf('--port') + 1]))
                n++
                return n === 1 ? deadChild(100) : liveChild(200)
            },
            probe: async () => n >= 2, // only the second child ever answers
        })

        expect(n).toBe(2)
        expect(spawned.pid).toBe(200)
        // The retry must use a DIFFERENT port — reusing the contended one defeats the purpose.
        expect(ports).toHaveLength(2)
        expect(ports[0]).not.toBe(ports[1])
    })

    it('gives up after `attempts` children and reports the exit', async () => {
        let n = 0
        await expect(
            spawnVaultBackend({
                ...base,
                attempts: 2,
                spawn: () => {
                    n++
                    return deadChild(300 + n)
                },
                probe: async () => false,
            }),
        ).rejects.toThrow(/exited before it was ready/)
        expect(n).toBe(2)
    })

    it('does not retry when the child is alive but merely slow — that is a real timeout', async () => {
        let n = 0
        await expect(
            spawnVaultBackend({
                ...base,
                waitMs: 400,
                spawn: () => {
                    n++
                    return liveChild(400 + n)
                },
                probe: async () => false,
            }),
        ).rejects.toThrow(/did not become ready/)
        expect(n).toBe(1) // a live-but-slow child is not a port collision — no retry
    })

    it('succeeds on the first attempt without retrying when nothing collides', async () => {
        let n = 0
        const spawned = await spawnVaultBackend({
            ...base,
            spawn: () => {
                n++
                return liveChild(500)
            },
            probe: async () => true,
        })
        expect(n).toBe(1)
        expect(spawned.pid).toBe(500)
        expect(spawned.vault).toBe(vault)
    })
})
