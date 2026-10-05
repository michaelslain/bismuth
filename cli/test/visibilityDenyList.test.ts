import { test as bunTest, expect } from 'bun:test'
import { makeLeakVault, runCli, type RunOpts } from './visibilityLeak'

// `settings deny-list` prints the full path list only to the owner's own hand. An MCP-spawned CLI
// (only BISMUTH_MCP_CHANNEL set) is an agent and must get the count, never a path.
const SPAWN_TIMEOUT_MS = 30_000
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, SPAWN_TIMEOUT_MS)

const CASES: Array<[string, RunOpts]> = [
    ['chat via cli', { channel: 'chat', via: 'cli' }],
    ['daemon via cli', { channel: 'daemon', via: 'cli' }],
    ['daemon via mcp', { channel: 'daemon', via: 'mcp' }],
]

test('the owner sees every restricted path', async () => {
    makeLeakVault()
    const r = await runCli(['settings', 'deny-list'], { channel: 'owner' })
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.stdout) as { entries: string[]; count: number }
    expect(parsed.entries.join('\n')).toContain('Private/secret.md')
    expect(parsed.count).toBe(parsed.entries.length)
})

for (const [label, opts] of CASES) {
    test(`an agent gets a count and no path: ${label}`, async () => {
        makeLeakVault()
        const r = await runCli(['settings', 'deny-list', '--channel', opts.channel], opts)
        expect(r.code).toBe(0)
        const parsed = JSON.parse(r.stdout) as Record<string, unknown>
        expect(parsed.entries).toBeUndefined()
        expect(typeof parsed.count).toBe('number')
        for (const name of ['Private', 'secret', 'Vault Hidden', 'Secret Tpl', 'Cal Secret'])
            expect(r.stdout, `"${name}" leaked`).not.toContain(name)
    })
}

test('daemon via mcp with the default channel prints no restricted path', async () => {
    makeLeakVault()
    const r = await runCli(['settings', 'deny-list'], { channel: 'daemon', via: 'mcp' })
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain('Private')
    expect(r.stdout).not.toContain('chatty')
})
