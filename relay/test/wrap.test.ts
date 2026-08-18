// Exercises the ACTUAL relay/bin/wrap.ts against a real mock relay server (a plain Bun.serve
// standing in for core's /relay/* routes) and real stub binaries — never a real agent CLI (only
// claude/opencode/openclaw exist on this machine; a throwaway bash script is a legitimate double).
//
// Covers exactly what WRAPPER_REPORTING_ENABLED's doc comment (core/src/terminal.ts) claims was
// verified: signal forwarding, exit-code fidelity, and the "never wrap Claude Code" guard — the
// three things that make wrapping an interactive TUI risky if done wrong.
import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WRAP_TS = join(import.meta.dir, '..', 'bin', 'wrap.ts')

function tmp(): string {
    return mkdtempSync(join(tmpdir(), 'bismuth-wrap-test-'))
}

function writeStub(dir: string, name: string, body: string): string {
    const p = join(dir, name)
    writeFileSync(p, body)
    chmodSync(p, 0o755)
    return p
}

/** A minimal stand-in for core's POST /relay/session[/end] routes: records every request. */
function startMockRelay() {
    const requests: { path: string; body: unknown }[] = []
    const server = Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url)
            let body: unknown = undefined
            try {
                body = await req.json()
            } catch {
                body = undefined
            }
            requests.push({ path: url.pathname, body })
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'content-type': 'application/json' },
            })
        },
    })
    return { server, requests, url: `http://localhost:${server.port}` }
}

async function waitFor(
    predicate: () => boolean,
    timeoutMs = 3000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise(r => setTimeout(r, 20))
    }
    throw new Error('waitFor timed out')
}

test('wrap.ts reports session start/end, forwards SIGINT to the child, and relays its exact exit code', async () => {
    const dir = tmp()
    const stub = writeStub(
        dir,
        'stub-agent',
        `#!/bin/bash\ntrap 'echo CHILD_GOT_SIGINT; exit 77' INT\necho CHILD_READY\nwhile true; do sleep 0.05; done\n`,
    )
    const relay = startMockRelay()

    const proc = Bun.spawn(['bun', 'run', WRAP_TS, 'goose', stub], {
        env: {
            ...process.env,
            CLAUDE_TERMINAL_ID: 'test-tab-1',
            CLAUDE_RELAY_URL: relay.url,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    })

    let out = ''
    ;(async () => {
        for await (const chunk of proc.stdout)
            out += Buffer.from(chunk).toString()
    })()

    await waitFor(() => out.includes('CHILD_READY'))
    await waitFor(() => relay.requests.some(r => r.path === '/relay/session'))
    const startReq = relay.requests.find(r => r.path === '/relay/session')!
    expect(startReq.body).toMatchObject({
        terminalId: 'test-tab-1',
        backend: 'goose',
    })

    proc.kill('SIGINT') // simulates Ctrl+C reaching the wrapper in its foreground process group

    const code = await proc.exited
    expect(code).toBe(77) // the CHILD's own trap exit code, relayed exactly
    expect(out).toContain('CHILD_GOT_SIGINT')

    await waitFor(() =>
        relay.requests.some(r => r.path === '/relay/session/end'),
    )
    const endReq = relay.requests.find(r => r.path === '/relay/session/end')!
    expect((endReq.body as { sessionId?: string }).sessionId).toBe(
        (startReq.body as { sessionId?: string }).sessionId,
    )

    relay.server.stop(true)
})

test('wrap.ts relays a normal (non-signal) exit code and still reports start/end', async () => {
    const dir = tmp()
    const stub = writeStub(
        dir,
        'stub-agent',
        `#!/bin/bash\necho CHILD_RAN\nexit 5\n`,
    )
    const relay = startMockRelay()

    const proc = Bun.spawn(
        ['bun', 'run', WRAP_TS, 'opencode', stub, '--some-flag'],
        {
            env: {
                ...process.env,
                CLAUDE_TERMINAL_ID: 'test-tab-2',
                CLAUDE_RELAY_URL: relay.url,
            },
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited

    expect(code).toBe(5)
    expect(out).toContain('CHILD_RAN')
    expect(relay.requests.map(r => r.path)).toEqual([
        '/relay/session',
        '/relay/session/end',
    ])
    expect(relay.requests[0].body).toMatchObject({
        backend: 'opencode',
        terminalId: 'test-tab-2',
    })

    relay.server.stop(true)
})

test("wrap.ts NEVER reports for backendId 'claude' (guard), even with a terminal id set, but still runs it transparently", async () => {
    const dir = tmp()
    const stub = writeStub(
        dir,
        'stub-claude',
        `#!/bin/bash\necho CHILD_RAN_CLAUDE\nexit 3\n`,
    )
    const relay = startMockRelay()

    const proc = Bun.spawn(['bun', 'run', WRAP_TS, 'claude', stub], {
        env: {
            ...process.env,
            CLAUDE_TERMINAL_ID: 'test-tab-3',
            CLAUDE_RELAY_URL: relay.url,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited

    expect(code).toBe(3) // still runs the real binary and relays its exit code...
    expect(out).toContain('CHILD_RAN_CLAUDE')
    expect(relay.requests).toEqual([]) // ...but never reports it, even though claude is misrouted here

    relay.server.stop(true)
})

test('wrap.ts reports nothing when not launched from a Bismuth terminal tab (no CLAUDE_TERMINAL_ID), but still runs the binary', async () => {
    const dir = tmp()
    const stub = writeStub(
        dir,
        'stub-agent',
        `#!/bin/bash\necho CHILD_RAN\nexit 0\n`,
    )
    const relay = startMockRelay()

    const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_RELAY_URL: relay.url,
    }
    delete env.CLAUDE_TERMINAL_ID

    const proc = Bun.spawn(['bun', 'run', WRAP_TS, 'goose', stub], {
        env,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited

    expect(code).toBe(0)
    expect(out).toContain('CHILD_RAN')
    expect(relay.requests).toEqual([])

    relay.server.stop(true)
})
