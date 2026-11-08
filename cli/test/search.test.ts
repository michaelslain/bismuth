import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { makeVault } from '../../core/test/helpers'
import { configureVaultEmbed } from '../../core/src/vaultEmbed'
import { runKey } from '../../core/src/runRegistry'
import { semanticQuery } from '../src/semantic'
import { makeLeakVault, runCli } from './visibilityLeak'
import { freePort } from '../../core/test/ports'

const T = 60_000
let API = ''
const DEAD = `http://127.0.0.1:${freePort()}`

let reply: unknown = { hits: [] }
const seen: Array<Record<string, unknown>> = []
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(req) {
            if (new URL(req.url).pathname !== '/search/hybrid')
                return new Response('no', { status: 404 })
            seen.push((await req.json()) as Record<string, unknown>)
            return Response.json(reply)
        },
    })
    API = `http://127.0.0.1:${server.port}`
})
afterAll(() => server.stop(true))

const HITS = [
    { path: 'open.md', score: 0.91234, excerpt: 'about open things' },
    { path: 'Private/secret.md', score: 0.8, excerpt: 'SECRETTOKEN' },
]

describe('bismuth search (blended)', () => {
    test('prints path score excerpt per hit and sends the limit', async () => {
        makeLeakVault()
        reply = { mode: 'hybrid', hits: [HITS[0]] }
        seen.length = 0
        const r = await runCli(['search', 'open things', '--limit', '3', '--api', API], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(r.stdout.trim()).toBe('open.md  0.912  about open things')
        expect(seen[0]).toEqual({ query: 'open things', limit: 3 })
    }, T)

    test('defaults to ten, --json prints the hits and a stale --semantic is ignored', async () => {
        makeLeakVault()
        reply = { mode: 'hybrid', hits: [HITS[0]] }
        seen.length = 0
        const r = await runCli(['search', '--semantic', 'open things', '--json', '--api', API], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(JSON.parse(r.stdout)).toEqual([HITS[0]])
        expect(seen[0].limit).toBe(10)
    }, T)

    test('a keyword answer from the core prints the stderr line and exits 0', async () => {
        makeLeakVault()
        reply = { mode: 'keyword', reason: 'warming', hits: [HITS[0]] }
        const r = await runCli(['search', 'x', '--api', API], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(r.stderr).toContain('meaning search unavailable (warming): keyword results only')
        expect(r.stdout).toContain('open.md')
    }, T)

    test('with no reachable core and embeddings off it prints keyword hits in the hit shape', async () => {
        makeLeakVault()
        const r = await runCli(['search', 'OPENTOKEN', '--json', '--api', DEAD], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(r.stderr).toContain('meaning search unavailable (off): keyword results only')
        const hits = JSON.parse(r.stdout) as { path: string; kind: string; score: number; excerpt: string }[]
        expect(hits.find(h => h.path === 'open.md')).toMatchObject({ kind: 'note' })
        expect(hits[0].score).toBe(1)
        expect(typeof hits[0].excerpt).toBe('string')
        expect(hits.some(h => h.path.includes('secret'))).toBe(false)
    }, T)

    test('a daemon agent never sees a hidden hit', async () => {
        makeLeakVault()
        reply = { mode: 'hybrid', hits: HITS }
        const r = await runCli(['search', 'x', '--json', '--api', API], { channel: 'daemon' })
        expect(r.code).toBe(0)
        expect(r.stdout).not.toContain('secret')
        expect(r.stdout).toContain('open.md')
    }, T)

    test('a keyword fallback for a daemon agent never names a hidden note', async () => {
        makeLeakVault()
        const r = await runCli(['search', 'SECRETTOKEN', '--json', '--api', DEAD], { channel: 'daemon' })
        expect(r.code).toBe(0)
        expect(r.stdout).not.toContain('secret')
    }, T)

    test('--regex keeps the literal keyword output and never asks the core', async () => {
        makeLeakVault()
        seen.length = 0
        const r = await runCli(['search', 'OPENTOK.N', '--regex'], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(JSON.parse(r.stdout).some((h: { path: string }) => h.path === 'open.md')).toBe(true)
        expect(JSON.parse(r.stdout)[0]).toHaveProperty('matchCount')
        expect(seen.length).toBe(0)
    }, T)
})

describe('semantic core selection and timing', () => {
    const OTHER = freePort()
    const SLOW = freePort()
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
            ['bun', 'run', join(import.meta.dir, '../src/index.ts'), 'search', 'x', '--vault', vault],
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
        expect(code).toBe(0)
        expect(err).toContain('meaning search unavailable (off): keyword results only')
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
        const dead = ['--api', DEAD]
        const deps = { workerAvailable: () => false }
        const a = await semanticQuery(dead, off, { query: 'x' }, [], 5, undefined, deps)
        expect(a).toMatchObject({ unavailable: 'off' })
        expect((a as { message: string }).message).toContain('embeddings.enabled')
        const b = await semanticQuery(dead, on, { query: 'x' }, [], 5, undefined, deps)
        expect(b).toMatchObject({ unavailable: 'no-worker' })
        expect((b as { message: string }).message).toContain('open the vault in the Bismuth app')
    }, T)
})
