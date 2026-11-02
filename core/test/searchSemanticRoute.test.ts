import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createServer } from '../src/server'
import { createSemanticChannel, QUERY_PREFIX, type LiveEmbedder } from '../src/memoryEmbed'
import { configureVaultEmbed, isSemanticUnavailable } from '../src/vaultEmbed'
import { configureChatEmbed } from '../src/chatEmbed'
import { encodeProjectDir } from '@bismuth/memory'
import { sweepTempDirs, tempDir } from './tempDirs'

afterAll(sweepTempDirs)
const savedConfig = process.env.CLAUDE_CONFIG_DIR
afterEach(() => {
    configureVaultEmbed()
    configureChatEmbed()
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfig
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Denied notes embed closest to the query, so they outrank the allowed ones: k only holds if it counts allowed hits.
function fixture(opts: { restricted?: boolean; chat?: boolean } = {}) {
    const restricted = opts.restricted ?? true
    const vault = tempDir('vault-')
    const put = (rel: string, body: string) => {
        mkdirSync(dirname(join(vault, rel)), { recursive: true })
        writeFileSync(join(vault, rel), body)
    }
    put('.settings', 'embeddings:\n  enabled: true\nfolderVisibility:\n  Vault Hidden: hidden\n')
    if (restricted) {
        put('Private/secret.md', '---\nvisibility: hidden\n---\n# secret\nalpha text')
        put('chatty.md', '---\nvisibility: chat-only\n---\n# chatty\nalpha text')
        put('Vault Hidden/inner.md', '# inner\nalpha text')
    }
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
    if (opts.chat) {
        process.env.CLAUDE_CONFIG_DIR = tempDir('claude-')
        const dir = join(process.env.CLAUDE_CONFIG_DIR, 'projects', encodeProjectDir(vault))
        const at = '2026-10-20T10:00:00'
        const lines = [
            JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: 'about the secret plan' } }),
            JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }),
        ]
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'sess-1.jsonl'), lines.join('\n') + '\n')
        configureChatEmbed({ channel, vectorsDir: tempDir('cv-'), syncDebounceMs: 10, storeDebounceMs: 10 })
    }
    configureVaultEmbed({ channel, vectorsDir: tempDir('vv-'), syncDebounceMs: 10, storeDebounceMs: 10 })
    return { vault, memory: tempDir('mem-') }
}

async function post(port: number, headers: Record<string, string>, body: object) {
    return (await postRaw(port, headers, body)) as { path: string; kind?: string; session?: string; date?: string }[]
}

async function postRaw(port: number, headers: Record<string, string>, body: object) {
    for (let i = 0; i < 60; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/search/semantic`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
        })
        const json = (await res.json()) as { hits?: unknown[]; unavailable?: string }
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

test('an unrestricted vault returns files with a kind and chats merged by score, cut to k', async () => {
    const { vault, memory } = fixture({ restricted: false, chat: true })
    const server = createServer({ vault, memory, port: 0 })
    try {
        let hits: Awaited<ReturnType<typeof post>> = []
        for (let i = 0; i < 60 && !hits.some(h => h.kind === 'chat'); i++) {
            hits = await post(server.port!, {}, { query: 'alpha', k: 10 })
            if (!hits.some(h => h.kind === 'chat')) await sleep(100)
        }
        const chat = hits.find(h => h.kind === 'chat')!
        expect(chat).toMatchObject({ path: 'chat sess-1', session: 'sess-1', date: '2026-10-20' })
        expect(hits.filter(h => h.kind === 'note').map(h => h.path).sort()).toEqual(['a.md', 'b.md', 'c.md'])
        // the chat embeds closest to the query, so it ranks first
        expect(hits[0]).toBe(chat)
        const cut = await post(server.port!, {}, { query: 'alpha', k: 2 })
        expect(cut.length).toBe(2)
        // around stays files-only
        const near = await post(server.port!, {}, { around: 'a.md', k: 10 })
        expect(near.some(h => h.kind === 'chat')).toBe(false)
    } finally {
        await server.stop(true)
    }
}, 60_000)

test('an agent in a vault with a deny entry gets no chat hits', async () => {
    const { vault, memory } = fixture({ restricted: true, chat: true })
    const server = createServer({ vault, memory, port: 0 })
    try {
        for (const headers of [{} as Record<string, string>, { 'x-bismuth-channel': 'chat' }]) {
            const hits = await post(server.port!, headers, { query: 'secret alpha', k: 10 })
            expect(hits.length).toBeGreaterThan(0)
            expect(hits.some(h => h.kind === 'chat' || h.path.startsWith('chat '))).toBe(false)
        }
    } finally {
        await server.stop(true)
    }
}, 60_000)

test('chats: false leaves chats out for the owner even when a chat would rank first', async () => {
    const { vault, memory } = fixture({ restricted: false, chat: true })
    const server = createServer({ vault, memory, port: 0 })
    try {
        // wait until the chat index answers, so the absence below is the flag and not a cold index
        let hits: Awaited<ReturnType<typeof post>> = []
        for (let i = 0; i < 60 && !hits.some(h => h.kind === 'chat'); i++) {
            hits = await post(server.port!, {}, { query: 'alpha', k: 10 })
            if (!hits.some(h => h.kind === 'chat')) await sleep(100)
        }
        expect(hits.some(h => h.kind === 'chat')).toBe(true)
        const files = await post(server.port!, {}, { query: 'alpha', k: 3, chats: false })
        expect(files.length).toBe(3)
        expect(files.some(h => h.kind === 'chat' || h.path.startsWith('chat '))).toBe(false)
    } finally {
        await server.stop(true)
    }
}, 60_000)
