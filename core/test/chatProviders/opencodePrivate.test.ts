// A private opencode conversation is erased from opencode's store when it ends (setPrivate).
import { describe, expect, test } from 'bun:test'
import { erasePrivateSession } from '../../src/chatProviders/opencode/opencode'

const base = { sessionId: 'ses_1', bin: 'opencode', cwd: '/v' }

describe('erasePrivateSession', () => {
    test('server mode deletes through the shared server', async () => {
        const calls: unknown[] = []
        await erasePrivateSession({ ...base, mode: 'server' }, null, {
            server: async () => ({
                client: { session: { delete: async (o: unknown) => void calls.push(o) } },
            }),
            cli: async () => void calls.push('cli'),
        })
        expect(calls).toEqual([{ path: { id: 'ses_1' }, query: { directory: '/v' } }])
    })

    test('server mode falls back to the CLI when the server is gone', async () => {
        const calls: unknown[] = []
        await erasePrivateSession({ ...base, mode: 'server' }, null, {
            server: async () => null,
            cli: async (_b, cwd, args) => void calls.push([cwd, args]),
        })
        expect(calls).toEqual([['/v', ['session', 'delete', 'ses_1']]])
    })

    test('run mode waits for the killed child before deleting', async () => {
        const order: string[] = []
        let release!: () => void
        const exited = new Promise<void>(r => (release = r)).then(() => void order.push('exited'))
        const done = erasePrivateSession({ ...base, mode: 'run' }, { exited }, {
            cli: async () => void order.push('delete'),
        })
        await new Promise(r => setTimeout(r, 0))
        expect(order).toEqual([])
        release()
        await done
        expect(order).toEqual(['exited', 'delete'])
    })

    test('nothing to erase before opencode named the session', async () => {
        const calls: string[] = []
        await erasePrivateSession({ ...base, sessionId: null, mode: 'run' }, null, {
            cli: async () => void calls.push('cli'),
        })
        expect(calls).toEqual([])
    })
})
