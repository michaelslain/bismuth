// hook() and registerSession against a local Bun.serve standing in for core's /relay/* routes.
// hook() ends in process.exit(0), so it is exercised in a child process.
import { afterAll, test, expect } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerSession } from '../lib/report'
import { sweepTempDirs, tempDir } from './tempDirs'

afterAll(sweepTempDirs)

function startMockRelay() {
    const requests: { path: string; body: any }[] = []
    const server = Bun.serve({
        port: 0,
        async fetch(req) {
            requests.push({
                path: new URL(req.url).pathname,
                body: await req.json().catch(() => undefined),
            })
            return new Response('{}')
        },
    })
    return { server, requests, url: `http://localhost:${server.port}` }
}

async function withRelayUrl<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const prev = process.env.CLAUDE_RELAY_URL
    process.env.CLAUDE_RELAY_URL = url
    try {
        return await fn()
    } finally {
        if (prev === undefined) delete process.env.CLAUDE_RELAY_URL
        else process.env.CLAUDE_RELAY_URL = prev
    }
}

test('registerSession posts session, terminal and cwd', async () => {
    const m = startMockRelay()
    try {
        await withRelayUrl(m.url, () =>
            registerSession({ session_id: 's1', cwd: '/x' }, 't1'),
        )
        expect(m.requests).toEqual([
            {
                path: '/relay/session',
                body: { sessionId: 's1', terminalId: 't1', cwd: '/x' },
            },
        ])
    } finally {
        m.server.stop(true)
    }
})

test('registerSession no-ops without a session id', async () => {
    const m = startMockRelay()
    try {
        await withRelayUrl(m.url, () => registerSession({}, 't1'))
        expect(m.requests).toHaveLength(0)
    } finally {
        m.server.stop(true)
    }
})

async function runHook(env: Record<string, string | undefined>, stdin: string) {
    const dir = tempDir('bismuth-relay-hook-test-')
    const script = join(dir, 'h.ts')
    writeFileSync(
        script,
        `import { hook, registerSession } from ${JSON.stringify(join(import.meta.dir, '..', 'lib', 'report'))}\nhook(registerSession)\n`,
    )
    const proc = Bun.spawn(['bun', script], {
        env: { ...process.env, CLAUDE_TERMINAL_ID: undefined, ...env },
        stdin: new Blob([stdin]),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    return await proc.exited
}

test('hook posts the payload and exits 0 inside a terminal', async () => {
    const m = startMockRelay()
    try {
        const code = await runHook(
            { CLAUDE_TERMINAL_ID: 'tab9', CLAUDE_RELAY_URL: m.url },
            JSON.stringify({ session_id: 'sess', cwd: '/w' }),
        )
        expect(code).toBe(0)
        expect(m.requests).toEqual([
            { path: '/relay/session', body: { sessionId: 'sess', terminalId: 'tab9', cwd: '/w' } },
        ])
    } finally {
        m.server.stop(true)
    }
})

test('hook is a no-op (exit 0, no post) without CLAUDE_TERMINAL_ID', async () => {
    const m = startMockRelay()
    try {
        const code = await runHook(
            { CLAUDE_RELAY_URL: m.url },
            JSON.stringify({ session_id: 'sess' }),
        )
        expect(code).toBe(0)
        expect(m.requests).toHaveLength(0)
    } finally {
        m.server.stop(true)
    }
})
