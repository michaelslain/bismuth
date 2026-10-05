import { test, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function runApi(
    channel: string | undefined,
    path: string,
    opts: { method?: string; mcpChannel?: string } = {},
) {
    const env: Record<string, string | undefined> = { ...process.env }
    // An empty registry + no vault: the visibility gate (which now checks every running core's
    // vault for `api`) must not see the developer's real cores, only the route refusals under test.
    env.BISMUTH_RUN_DIR = mkdtempSync(join(tmpdir(), 'bismuth-api-trust-run-'))
    delete env.BISMUTH_VAULT
    if (channel === undefined) delete env.BISMUTH_AGENT_CHANNEL
    else env.BISMUTH_AGENT_CHANNEL = channel
    if (opts.mcpChannel === undefined) delete env.BISMUTH_MCP_CHANNEL
    else env.BISMUTH_MCP_CHANNEL = opts.mcpChannel
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'api',
            opts.method ?? 'POST',
            path,
            '--json',
            '{"command":"echo hi"}',
            '--api',
            'http://127.0.0.1:1',
        ],
        { stdout: 'pipe', stderr: 'pipe', env },
    )
    const [err, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, err }
}

for (const channel of ['chat', 'daemon'])
    for (const path of ['/status-bar/trust', 'status-bar/trust', '//status-bar/trust'])
        test(`an AI session (${channel}) cannot approve a status bar command via api ${path}`, async () => {
            const { code, err } = await runApi(channel, path)
            expect(code).not.toBe(0)
            expect(err).toContain('is the user decision')
        })

// Spellings fetch normalises onto the real route: the guard must see the same route fetch will.
const SNEAKY: [string, string, string][] = [
    ['POST', './doctor/fix', 'doctor repairs go through'],
    ['GET', 'a/../doctor', 'doctor repairs go through'],
    ['GET', '%2e/doctor', 'doctor repairs go through'],
    ['GET', '%2E%2E/doctor', 'doctor repairs go through'],
    ['GET', '\\doctor', 'doctor repairs go through'],
    ['POST', './status-bar/trust', 'is the user decision'],
    ['POST', 'status-bar/./trust', 'is the user decision'],
]
for (const channel of ['chat', 'daemon'])
    for (const [method, path, msg] of SNEAKY)
        test(`an AI session (${channel}) cannot slip past the guard via api ${method} ${path}`, async () => {
            const { code, err } = await runApi(channel, path, { method })
            expect(code).not.toBe(0)
            expect(err).toContain(msg)
        })

test('the owner is not refused by the guard (fails only on connection)', async () => {
    const { err } = await runApi(undefined, '/status-bar/trust')
    expect(err).not.toContain('approving a status bar command')
})

for (const channel of ['chat', 'daemon'])
    for (const [method, path] of [
        ['POST', '/doctor/fix'],
        ['POST', 'doctor/fix'],
        ['GET', '/doctor'],
        ['GET', '//doctor'],
    ])
        test(`an AI session (${channel}) cannot reach doctor routes via api ${method} ${path}`, async () => {
            const { code, err } = await runApi(channel, path, { method })
            expect(code).not.toBe(0)
            expect(err).toContain('doctor repairs go through')
        })

test('an MCP-spawned CLI (no agent channel stamp) cannot reach doctor routes via api', async () => {
    for (const [method, path] of [
        ['POST', '/doctor/fix'],
        ['GET', '/doctor'],
    ]) {
        const { code, err } = await runApi(undefined, path, {
            method,
            mcpChannel: 'daemon',
        })
        expect(code).not.toBe(0)
        expect(err).toContain('doctor repairs go through')
    }
})

test('the owner is not refused on doctor routes (fails only on connection)', async () => {
    for (const [method, path] of [
        ['POST', '/doctor/fix'],
        ['GET', '/doctor'],
    ]) {
        const { err } = await runApi(undefined, path, { method })
        expect(err).not.toContain('doctor repairs go through')
        expect(err).not.toContain('is the user decision')
    }
})
