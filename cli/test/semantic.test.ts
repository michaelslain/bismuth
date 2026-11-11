import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../src/registry'
import { hybridQuery, semanticQuery } from '../src/semantic'
import { semanticLabel } from '../src/commands/search'
import { tryCall } from '../src/http'
import type { DenyEntry } from '../../core/src/visibility'
import { makeLeakVault, runCli } from './visibilityLeak'

const T = 60_000
const entry = (rel: string): DenyEntry => ({ rel, abs: `/vault/${rel}` })

// A ranked corpus a stub core serves like the owner route does: top `k`, nothing filtered.
const RANKED = ['Private/a.md', 'n1.md', 'n2.md', 'n3.md', 'n4.md', 'n5.md', 'n6.md'].map((path, i) => ({
    path,
    score: 1 - i / 10,
    excerpt: path,
}))
let asked: Array<{ k: number }> = []
let mode: 'ok' | 'fail' | 'kinds' = 'ok'
const KINDS = [
    { path: 'chat s1', score: 0.95, excerpt: 'c', kind: 'chat', date: '2026-10-29', session: 's1' },
    { path: 'a.pdf', score: 0.9, excerpt: 'p', kind: 'pdf', page: 4 },
    { path: 'b.png', score: 0.8, excerpt: 'i', kind: 'image' },
    { path: 'n.md', score: 0.7, excerpt: 'n', kind: 'note' },
]
// More files than k, so a stub that ignores k or chats: false cannot pass by accident.
const SERVED = [
    { path: 'chat s1', score: 0.99, excerpt: 'c', kind: 'chat', date: '2026-10-29', session: 's1' },
    { path: 'chat s2', score: 0.97, excerpt: 'c', kind: 'chat', date: '2026-10-28', session: 's2' },
    { path: 'f1.md', score: 0.9, excerpt: 'f', kind: 'note' },
    { path: 'f2.md', score: 0.8, excerpt: 'f', kind: 'note' },
    { path: 'f3.md', score: 0.7, excerpt: 'f', kind: 'note' },
    { path: 'f4.md', score: 0.6, excerpt: 'f', kind: 'note' },
    { path: 'f5.md', score: 0.5, excerpt: 'f', kind: 'note' },
    { path: 'f6.md', score: 0.4, excerpt: 'f', kind: 'note' },
]
let server: ReturnType<typeof Bun.serve>
let api = ''

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: async req => {
            if (mode === 'fail') return Response.json({ error: 'index exploded' }, { status: 500 })
            const body = (await req.json()) as { k: number; chats?: boolean }
            if (mode === 'kinds') {
                const hits = (body.chats === false ? SERVED.filter(h => h.kind !== 'chat') : SERVED).slice(0, body.k)
                return Response.json({ hits })
            }
            asked.push(body)
            return Response.json({ hits: RANKED.slice(0, body.k) })
        },
    })
    api = `http://127.0.0.1:${server.port}`
})
afterAll(() => server.stop(true))

const query = (deny: DenyEntry[], k: number) => {
    mode = 'ok'
    asked = []
    return semanticQuery(['--api', api], '/vault-that-does-not-exist', { query: 'x' }, deny, k)
}

describe('semanticQuery over a running core', () => {
    test('a denied note among the top k still leaves k hits', async () => {
        const r = await query([entry('Private/a.md')], 5)
        expect(Array.isArray(r) && r.map(h => h.path)).toEqual(['n1.md', 'n2.md', 'n3.md', 'n4.md', 'n5.md'])
        expect(asked[0].k).toBe(6)
    }, T)

    test('no deny list asks for exactly k', async () => {
        const r = await query([], 3)
        expect(Array.isArray(r) && r.length).toBe(3)
        expect(asked[0].k).toBe(3)
    }, T)

    test('a deny list that matches nothing in the reply still returns exactly k', async () => {
        const r = await query([entry('zzz/x.md'), entry('zzz/y.md')], 3)
        expect(asked[0].k).toBe(5)
        expect(Array.isArray(r) && r.length).toBe(3)
    }, T)

    test('a folder-level deny drops everything under it', async () => {
        const r = await query([entry('Private')], 5)
        expect(Array.isArray(r) && r.map(h => h.path)).toEqual(['n1.md', 'n2.md', 'n3.md', 'n4.md', 'n5.md'])
    }, T)

    test('alternate spellings of a denied path are still denied', async () => {
        const spellings = ['./Private/a.md', 'private/A.md', '/vault/Private/a.md', 'Private//a.md']
        for (const sp of spellings) {
            mode = 'ok'
            const saved = RANKED[0].path
            RANKED[0].path = sp
            try {
                const r = await semanticQuery(['--api', api], '/vault-x', { query: 'x' }, [entry('Private/a.md')], 5)
                expect(Array.isArray(r) && r.map(h => h.path).includes(sp)).toBe(false)
                expect(Array.isArray(r) && r.length).toBe(5)
            } finally {
                RANKED[0].path = saved
            }
        }
    }, T)
})

describe('a failing live core is not an absent one', () => {
    test('tryCall maps a 5xx to { error: status } with the core message', async () => {
        mode = 'fail'
        const r = await tryCall(api, 'POST', '/search/semantic', { query: 'x' })
        expect(r).toMatchObject({ error: 500, message: 'index exploded' })
        expect('unreachable' in r).toBe(false)
    }, T)

    test('search prints the core error and exits non-zero without a local fallback', async () => {
        makeLeakVault()
        mode = 'fail'
        const r = await runCli(['search', 'x', '--api', api], { channel: 'owner' })
        expect(r.code).not.toBe(0)
        expect(r.stderr).toContain('500')
        expect(r.stderr).toContain('index exploded')
        // the in-process path would have answered "embeddings are off" instead
        expect(r.stderr).not.toContain('embeddings are off')
    }, T)

    test('map --around exits non-zero on a 5xx instead of silently dropping similar', async () => {
        makeLeakVault()
        mode = 'fail'
        const r = await runCli(['map', '--around', 'open.md', '--api', api], { channel: 'owner' })
        expect(r.code).not.toBe(0)
        expect(r.stderr).toContain('index exploded')
    }, T)
})

describe('semantic hits of every kind', () => {
    test('labels: note path, pdf page, image marker, chat date and session', () => {
        expect(KINDS.map(h => semanticLabel(h as never))).toEqual([
            'chat 2026-10-29 s1',
            'a.pdf p.4',
            'b.png (image)',
            'n.md',
        ])
        expect(semanticLabel({ path: 'x.md', score: 1, excerpt: '' })).toBe('x.md')
    })

    test('the owner keeps chat hits and their fields, cut to k', async () => {
        mode = 'kinds'
        const r = await semanticQuery(['--api', api], '/vault-that-does-not-exist', { query: 'x' }, [], 3)
        expect(Array.isArray(r) && r.map(h => h.kind)).toEqual(['chat', 'chat', 'note'])
        expect(Array.isArray(r) && r[0]).toMatchObject({ date: '2026-10-29', session: 's1' })
    }, T)

    test('an agent in a restricted vault gets no chat hits and still k files', async () => {
        mode = 'kinds'
        const r = await semanticQuery(['--api', api], '/vault-that-does-not-exist', { query: 'x' }, [entry('Private/a.md')], 3)
        expect(Array.isArray(r) && r.map(h => h.path)).toEqual(['f1.md', 'f2.md', 'f3.md'])
        expect(Array.isArray(r) && r.filter(h => h.kind === 'chat').length).toBe(0)
    }, T)

    test('map --around never prints a chat in similar', async () => {
        makeLeakVault()
        mode = 'kinds'
        const r = await runCli(['map', '--around', 'open.md', '--json', '--api', api], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(r.stdout).not.toContain('chat s1')
    }, T)
})

describe('hybridQuery over a running core', () => {
    test('an agent channel is sent as agent with the plain limit, and the reply is not padded or cut', async () => {
        const bodies: Array<Record<string, unknown>> = []
        const stub = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch: async req => {
                bodies.push((await req.json()) as Record<string, unknown>)
                const hits = ['n1.md', 'n2.md'].map(path => ({ path, kind: 'note', score: 1, excerpt: path }))
                return Response.json({ hits, mode: 'hybrid' })
            },
        })
        const saved = process.env.BISMUTH_AGENT_CHANNEL
        process.env.BISMUTH_AGENT_CHANNEL = 'chat'
        try {
            const r = await hybridQuery(['--api', `http://127.0.0.1:${stub.port}`], '/vault-that-does-not-exist', 'x', [entry('Private/a.md')], 2)
            expect(bodies[0]).toMatchObject({ limit: 2, agent: 'chat' })
            expect(r.hits.map(h => h.path)).toEqual(['n1.md', 'n2.md'])
        } finally {
            if (saved === undefined) delete process.env.BISMUTH_AGENT_CHANNEL
            else process.env.BISMUTH_AGENT_CHANNEL = saved
            stub.stop(true)
        }
    }, T)
})

describe('hybridQuery with a core that is too slow', () => {
    test('a core that does not answer in time yields the keyword list with reason warming', async () => {
        const vault = mkdtempSync(join(tmpdir(), 'slow-core-'))
        writeFileSync(join(vault, 'zebra.md'), 'zebra stripes\n')
        const stub = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch: async () => {
                await Bun.sleep(2000)
                return Response.json({ hits: [], mode: 'hybrid' })
            },
        })
        try {
            const r = await hybridQuery(['--api', `http://127.0.0.1:${stub.port}`], vault, 'zebra', [], 5, 150)
            expect(r.mode).toBe('keyword')
            expect(r.reason).toBe('warming')
            expect(r.hits.map(h => h.path)).toContain('zebra.md')
        } finally {
            stub.stop(true)
            rmSync(vault, { recursive: true, force: true })
        }
    }, T)
})

describe('docs search over a running core', () => {
    test('a keyword answer from the core is replaced by a search of this checkout docs root', async () => {
        const root = mkdtempSync(join(tmpdir(), 'docs-root-'))
        const vault = join(root, 'vault')
        const docs = join(root, 'docs')
        mkdirSync(vault)
        mkdirSync(docs)
        writeFileSync(join(docs, 'alpha.md'), '# Alpha\n\nzebra stripes are unique\n')
        const stub = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch: async () =>
                Response.json({
                    hits: [{ path: 'installed-copy.md', heading: 'Old', snippet: 'old', score: 1 }],
                    mode: 'keyword',
                    reason: 'off',
                }),
        })
        const saved = process.env.BISMUTH_DOCS_DIR
        process.env.BISMUTH_DOCS_DIR = docs
        const lines: string[] = []
        const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
        const err = spyOn(console, 'error').mockImplementation(() => {})
        try {
            await registry['docs search'].run(['zebra', '--vault', vault, '--api', `http://127.0.0.1:${stub.port}`])
            const hits = JSON.parse(lines.join('\n')) as Array<{ path: string }>
            expect(hits.map(h => h.path)).toContain('alpha.md')
            expect(hits.map(h => h.path)).not.toContain('installed-copy.md')
        } finally {
            log.mockRestore()
            err.mockRestore()
            if (saved === undefined) delete process.env.BISMUTH_DOCS_DIR
            else process.env.BISMUTH_DOCS_DIR = saved
            stub.stop(true)
            rmSync(root, { recursive: true, force: true })
        }
    }, T)
})
