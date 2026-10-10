import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { semanticQuery } from '../src/semantic'
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
let mode: 'ok' | 'fail' = 'ok'
let server: ReturnType<typeof Bun.serve>
let api = ''

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: async req => {
            if (mode === 'fail') return Response.json({ error: 'index exploded' }, { status: 500 })
            const body = (await req.json()) as { k: number }
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

    test('search --semantic prints the core error and exits non-zero without a local fallback', async () => {
        makeLeakVault()
        mode = 'fail'
        const r = await runCli(['search', 'x', '--semantic', '--api', api], { channel: 'owner' })
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
