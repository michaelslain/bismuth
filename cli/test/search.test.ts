import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { makeVault } from '../../core/test/helpers'
import { configureVaultEmbed } from '../../core/src/vaultEmbed'
import { runKey } from '../../core/src/runRegistry'
import { semanticQuery } from '../src/semantic'
import { makeLeakVault, runCli } from './visibilityLeak'

const T = 60_000
const PORT = 6206
const API = `http://127.0.0.1:${PORT}`
const DEAD = 'http://127.0.0.1:6299'

let reply: unknown = { hits: [] }
const seen: Array<Record<string, unknown>> = []
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
    server = Bun.serve({
        port: PORT,
        hostname: '127.0.0.1',
        async fetch(req) {
            if (new URL(req.url).pathname !== '/search/semantic')
                return new Response('no', { status: 404 })
            seen.push((await req.json()) as Record<string, unknown>)
            return Response.json(reply)
        },
    })
})
afterAll(() => server.stop(true))

const HITS = [
    { path: 'open.md', score: 0.91234, excerpt: 'about open things' },
    { path: 'Private/secret.md', score: 0.8, excerpt: 'SECRETTOKEN' },
]

describe('bismuth search --semantic', () => {
    test('prints path score excerpt per hit and sends the limit', async () => {
        makeLeakVault()
        reply = { hits: [HITS[0]] }
        seen.length = 0
        const r = await runCli(['search', 'open things', '--semantic', '--limit', '3', '--api', API], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(r.stdout.trim()).toBe('open.md  0.912  about open things')
        expect(seen[0]).toEqual({ query: 'open things', k: 3 })
    }, T)

    test('defaults to ten and --json prints the hits', async () => {
        makeLeakVault()
        reply = { hits: [HITS[0]] }
        seen.length = 0
        const r = await runCli(['search', '--semantic', 'open things', '--json', '--api', API], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(JSON.parse(r.stdout)).toEqual([HITS[0]])
        expect(seen[0].k).toBe(10)
    }, T)

    test('an unavailable reply exits non-zero with its message', async () => {
        makeLeakVault()
        reply = { unavailable: 'warming', message: 'the semantic index is still warming up' }
        const r = await runCli(['search', 'x', '--semantic', '--api', API], { channel: 'owner' })
        expect(r.code).not.toBe(0)
        expect(r.stderr).toContain('still warming up')
    }, T)

    test('with no reachable core and embeddings off it names embeddings.enabled', async () => {
        makeLeakVault()
        const r = await runCli(['search', 'x', '--semantic', '--api', DEAD], { channel: 'owner' })
        expect(r.code).not.toBe(0)
        expect(r.stderr).toContain('embeddings.enabled')
    }, T)

    test('a daemon agent never sees a hidden hit', async () => {
        makeLeakVault()
        reply = { hits: HITS }
        const r = await runCli(['search', 'x', '--semantic', '--json', '--api', API], { channel: 'daemon' })
        expect(r.code).toBe(0)
        expect(r.stdout).not.toContain('secret')
        expect(r.stdout).toContain('open.md')
    }, T)

    test('without --semantic the plain search is unchanged', async () => {
        makeLeakVault()
        seen.length = 0
        const r = await runCli(['search', 'OPENTOKEN'], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(JSON.parse(r.stdout).some((h: { path: string }) => h.path === 'open.md')).toBe(true)
        expect(seen.length).toBe(0)
    }, T)
})

describe('semantic core selection and timing', () => {
    const OTHER = 6256
    const SLOW = 6257
    const otherSeen: string[] = []
    let other: ReturnType<typeof Bun.serve>
    let slow: ReturnType<typeof Bun.serve>

    beforeAll(() => {
        other = Bun.serve({
            port: OTHER,
            hostname: '127.0.0.1',
            fetch(req) {
                otherSeen.push(new URL(req.url).pathname)
                return Response.json({ hits: [{ path: 'a.md', score: 1, excerpt: 'x' }] })
            },
        })
        slow = Bun.serve({
            port: SLOW,
            hostname: '127.0.0.1',
            async fetch() {
                await Bun.sleep(1500)
                return Response.json({ hits: [] })
            },
        })
    })
    afterAll(() => {
        other.stop(true)
        slow.stop(true)
        configureVaultEmbed()
    })

    test('an env core registered for another vault is never asked', async () => {
        const { vault } = makeLeakVault()
        const runDir = mkdtempSync(join(tmpdir(), 'bismuth-run-'))
        mkdirSync(runDir, { recursive: true })
        const otherVault = '/tmp/some-other-vault-for-test'
        writeFileSync(
            join(runDir, `${runKey(otherVault)}.json`),
            JSON.stringify({ port: OTHER, vault: otherVault, pid: process.pid }),
        )
        otherSeen.length = 0
        const proc = Bun.spawn(
            ['bun', 'run', join(import.meta.dir, '../src/index.ts'), 'search', 'x', '--semantic', '--vault', vault],
            {
                env: {
                    ...process.env,
                    BISMUTH_RUN_DIR: runDir,
                    BISMUTH_API: `http://127.0.0.1:${OTHER}`,
                    BISMUTH_AGENT_CHANNEL: '',
                    BROWSER: 'none',
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
        expect(code).not.toBe(0)
        expect(err).toContain('embeddings.enabled')
        expect(otherSeen).toEqual([])
    }, T)

    test('a core that answers after the timeout is warming and nothing runs in process', async () => {
        const vault = makeVault({ 'a.md': '# a\n', '.settings': 'embeddings:\n  enabled: true\n' })
        let embedderCalls = 0
        configureVaultEmbed({
            channel: {
                embedder: () => {
                    embedderCalls++
                    return null
                },
            } as never,
        })
        const r = await semanticQuery(['--api', `http://127.0.0.1:${SLOW}`], vault, { query: 'x' }, [], 5, 300, {
            workerAvailable: () => true,
        })
        expect(r).toEqual({ unavailable: 'warming', message: 'the running server did not answer in time' })
        expect(embedderCalls).toBe(0)
    }, T)

    test('with no worker, embeddings off names embeddings.enabled and on names the app', async () => {
        const off = makeVault({ 'a.md': '# a\n' })
        const on = makeVault({ 'a.md': '# a\n', '.settings': 'embeddings:\n  enabled: true\n' })
        const dead = ['--api', 'http://127.0.0.1:6299']
        const deps = { workerAvailable: () => false }
        const a = await semanticQuery(dead, off, { query: 'x' }, [], 5, undefined, deps)
        expect(a).toMatchObject({ unavailable: 'off' })
        expect((a as { message: string }).message).toContain('embeddings.enabled')
        const b = await semanticQuery(dead, on, { query: 'x' }, [], 5, undefined, deps)
        expect(b).toMatchObject({ unavailable: 'no-worker' })
        expect((b as { message: string }).message).toContain('open the vault in the Bismuth app')
    }, T)
})
