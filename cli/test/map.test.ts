import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { makeLeakVault, runCli, TOKENS } from './visibilityLeak'
import { freePort } from '../../core/test/ports'

const T = 60_000

describe('bismuth map', () => {
    test('prints the formatted map, narrows to a folder, and emits json', async () => {
        const { vault } = makeLeakVault()
        const text = await runCli(['map'], { channel: 'owner' })
        expect(text.code).toBe(0)
        expect(text.stdout).toContain('Private')
        expect(text.stdout.length).toBeLessThanOrEqual(6000)

        const json = await runCli(['map', '--json'], { channel: 'owner' })
        const map = JSON.parse(json.stdout)
        expect(map.notes).toBeGreaterThan(0)
        expect(map.folders.some((f: { path: string }) => f.path === 'Private')).toBe(true)

        const scoped = await runCli(['map', '--json', '--folder', 'Private'], { channel: 'owner', })
        const sm = JSON.parse(scoped.stdout)
        expect(sm.folders.map((f: { path: string }) => f.path)).toEqual(['Private'])
        expect(vault).toBeTruthy()
    }, T)

    test('--around prints a neighbourhood and an unknown note exits non-zero', async () => {
        makeLeakVault()
        const ok = await runCli(['map', '--around', 'open.md', '--json'], { channel: 'owner' })
        expect(ok.code).toBe(0)
        expect(JSON.parse(ok.stdout).path).toBe('open.md')
        const bad = await runCli(['map', '--around', 'nope.md'], { channel: 'owner' })
        expect(bad.code).not.toBe(0)
        expect(bad.stderr).toContain('note not found')
    }, T)

    test('a daemon agent never sees a hidden or chat-only note', async () => {
        makeLeakVault()
        const owner = await runCli(['map', '--around', 'chatty.md'], { channel: 'owner' })
        expect(owner.code).toBe(0)
        const r = await runCli(['map', '--json'], { channel: 'daemon', via: 'mcp' })
        expect(r.code).toBe(0)
        expect(r.stdout).not.toContain('secret')
        expect(r.stdout).not.toContain('chatty')
        const around = await runCli(['map', '--around', 'chatty.md'], { channel: 'daemon' })
        expect(around.code).not.toBe(0)
    }, T)
})

describe('bismuth brain', () => {
    test('prints the vault map section for the owner and hides notes from the daemon', async () => {
        makeLeakVault()
        const owner = await runCli(['brain'], { channel: 'owner' })
        expect(owner.code).toBe(0)
        expect(owner.stdout).toContain('# Vault map')
        const daemon = await runCli(['brain'], { channel: 'daemon', via: 'mcp' })
        expect(daemon.code).toBe(0)
        expect(daemon.stdout).toContain('# Vault map')
        expect(daemon.stdout).not.toContain('chatty')
        expect(daemon.stdout).not.toContain(TOKENS.secret)
    }, T)
})

describe('bismuth map --around similar', () => {
    let API = ''
    let reply: unknown = { hits: [] }
    let server: ReturnType<typeof Bun.serve>
    beforeAll(() => {
        server = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch: () => Response.json(reply),
        })
        API = `http://127.0.0.1:${server.port}`
    })
    afterAll(() => server.stop(true))

    test('adds a similar line after memories and a json field when hits arrive', async () => {
        makeLeakVault()
        reply = { hits: [{ path: 'chatty.md', score: 0.9, excerpt: 'x' }, { path: 'a/b.md', score: 0.5, excerpt: 'y' }] }
        const text = await runCli(['map', '--around', 'open.md', '--api', API], { channel: 'owner' })
        expect(text.code).toBe(0)
        expect(text.stdout).toContain('similar: chatty.md, a/b.md')
        // order, not just presence: `similar:` is the last line, after `memories`
        const lines = text.stdout.split('\n').filter(Boolean)
        const labels = lines.map(l => l.split(':')[0])
        expect(labels[labels.length - 1]).toBe('similar')
        const mem = labels.indexOf('memories')
        if (mem !== -1) expect(mem).toBeLessThan(labels.indexOf('similar'))
        const json = await runCli(['map', '--around', 'open.md', '--json', '--api', API], { channel: 'owner' })
        expect(JSON.parse(json.stdout).similar).toEqual(['chatty.md', 'a/b.md'])
    }, T)

    test('unavailable embeddings leave the output unchanged and exit 0', async () => {
        makeLeakVault()
        reply = { unavailable: 'off', message: 'embeddings are off' }
        const a = await runCli(['map', '--around', 'open.md', '--api', API], { channel: 'owner' })
        expect(a.code).toBe(0)
        expect(a.stdout).not.toContain('similar')
        const j = await runCli(['map', '--around', 'open.md', '--json', '--api', API], { channel: 'owner' })
        expect('similar' in JSON.parse(j.stdout)).toBe(false)
        // no reachable core: the in-process path sees embeddings off
        const dead = await runCli(['map', '--around', 'open.md', '--api', `http://127.0.0.1:${freePort()}`], { channel: 'owner' })
        expect(dead.code).toBe(0)
        expect(dead.stdout).not.toContain('similar')
    }, T)

    test('a daemon agent never gets a hidden note as similar', async () => {
        makeLeakVault()
        reply = { hits: [{ path: 'Private/secret.md', score: 0.9, excerpt: 'z' }, { path: 'open.md', score: 0.4, excerpt: 'z' }] }
        const r = await runCli(['map', '--around', 'open.md', '--api', API], { channel: 'daemon' })
        expect(r.code).toBe(0)
        expect(r.stdout).not.toContain('secret')
    }, T)
})
