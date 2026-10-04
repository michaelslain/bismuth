import { test, expect } from 'bun:test'

async function runApi(channel: string | undefined, path: string) {
    const env: Record<string, string | undefined> = { ...process.env }
    if (channel === undefined) delete env.BISMUTH_AGENT_CHANNEL
    else env.BISMUTH_AGENT_CHANNEL = channel
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'api',
            'POST',
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
            expect(err).toContain('refused')
        })

test('the owner is not refused by the guard (fails only on connection)', async () => {
    const { err } = await runApi(undefined, '/status-bar/trust')
    expect(err).not.toContain('approving a status bar command')
})
