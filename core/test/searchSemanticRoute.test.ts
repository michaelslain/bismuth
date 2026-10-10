import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createServer } from '../src/server'
import { createSemanticChannel, QUERY_PREFIX, type LiveEmbedder } from '../src/memoryEmbed'
import { configureVaultEmbed, isSemanticUnavailable } from '../src/vaultEmbed'
import { sweepTempDirs, tempDir } from './tempDirs'

afterAll(sweepTempDirs)
afterEach(() => configureVaultEmbed())

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Denied notes embed closest to the query, so they outrank the allowed ones: k only holds if it counts allowed hits.
function fixture() {
    const vault = tempDir('vault-')
    const put = (rel: string, body: string) => {
        mkdirSync(dirname(join(vault, rel)), { recursive: true })
        writeFileSync(join(vault, rel), body)
    }
    put('.settings', 'embeddings:\n  enabled: true\nfolderVisibility:\n  Vault Hidden: hidden\n')
    put('Private/secret.md', '---\nvisibility: hidden\n---\n# secret\nalpha text')
    put('chatty.md', '---\nvisibility: chat-only\n---\n# chatty\nalpha text')
    put('Vault Hidden/inner.md', '# inner\nalpha text')
    for (const n of ['a', 'b', 'c']) put(`${n}.md`, `# ${n}\nalpha text`)
    const makeEmbedder = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            return texts.map(t =>
                Float32Array.from(t.startsWith(QUERY_PREFIX) || /secret|inner|chatty/.test(t) ? [1, 0, 0] : [0.8, 0.6, 0]),
            )
        },
    })
    const channel = createSemanticChannel({ makeEmbedder, vectorsDir: tempDir('rc-') })
    configureVaultEmbed({ channel, vectorsDir: tempDir('vv-'), syncDebounceMs: 10, storeDebounceMs: 10 })
    return { vault, memory: tempDir('mem-') }
}

async function post(port: number, headers: Record<string, string>, body: object) {
    for (let i = 0; i < 60; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/search/semantic`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
        })
        const json = (await res.json()) as { hits?: { path: string }[]; unavailable?: string }
        if (!json.unavailable) return json.hits ?? []
        if (!isSemanticUnavailable(json as never) || json.unavailable !== 'warming') throw new Error(JSON.stringify(json))
        await sleep(100)
    }
    throw new Error('never settled')
}

test('an agent-channel request never returns a denied path, and k counts only allowed hits', async () => {
    const { vault, memory } = fixture()
    const server = createServer({ vault, memory, port: 0 })
    const port = server.port!
    try {
        const daemon = await post(port, {}, { query: 'alpha', k: 10 })
        const paths = daemon.map(h => h.path)
        expect(paths.sort()).toEqual(['a.md', 'b.md', 'c.md'])

        const chat = await post(port, { 'x-bismuth-channel': 'chat' }, { query: 'alpha', k: 10 })
        const chatPaths = chat.map(h => h.path)
        expect(chatPaths).toContain('chatty.md')
        expect(chatPaths.some(p => p.startsWith('Private/') || p.startsWith('Vault Hidden/'))).toBe(false)

        // k applies after the deny filter: asking for 3 yields 3 allowed notes, not 3 minus denied
        const two = await post(port, {}, { query: 'alpha', k: 3 })
        expect(two.length).toBe(3)
        for (const h of two) expect(['a.md', 'b.md', 'c.md']).toContain(h.path)

        // neighbours of a denied note reveal nothing
        expect(await post(port, {}, { around: 'Private/secret.md' })).toEqual([])
    } finally {
        await server.stop(true)
    }
}, 60_000)
