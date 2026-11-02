import { test, expect, afterAll, afterEach, beforeEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { encodeProjectDir } from '@bismuth/memory'
import { createSemanticChannel } from '../src/memoryEmbed'
import type { LiveEmbedder } from '../src/memoryEmbed'
import { chatSemanticSearch, chatSourceHits, configureChatEmbed, syncChatEmbeddings } from '../src/chatEmbed'
import { SOURCE_EXCERPT_CHARS } from '../src/semanticSources'
import { tempDir, sweepTempDirs } from './tempDirs'

afterAll(sweepTempDirs)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const vecOf = (t: string) => (t.includes('beta') ? [0, 1, 0] : t.includes('gamma') ? [0, 0, 1] : [1, 0, 0])

const savedConfig = process.env.CLAUDE_CONFIG_DIR
beforeEach(() => {
    process.env.CLAUDE_CONFIG_DIR = tempDir('claude-')
})
afterEach(() => {
    configureChatEmbed()
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfig
})

function fixture(opts: { enabled?: boolean; worker?: boolean } = {}) {
    const vault = tempDir('vault-')
    if (opts.enabled !== false) writeFileSync(join(vault, '.settings'), 'embeddings:\n  enabled: true\n')
    const dir = join(process.env.CLAUDE_CONFIG_DIR!, 'projects', encodeProjectDir(vault))
    const calls = { embed: 0 }
    const mk = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            calls.embed++
            return texts.map(t => Float32Array.from(vecOf(t)))
        },
    })
    const channel = createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') })
    configureChatEmbed({ channel, vectorsDir: tempDir('cv-'), syncDebounceMs: 10, storeDebounceMs: 10 })
    const session = (id: string, turns: [string, string][], at = '2026-10-20T10:00:00') => {
        const lines = turns.flatMap(([u, c]) => [
            JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: u } }),
            JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: c }] } }),
        ])
        const path = join(dir, `${id}.jsonl`)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, lines.join('\n') + '\n')
        return path
    }
    return { vault, dir, calls, session }
}

const q = (vec: number[], extra: object = {}) => ({
    vec: Float32Array.from(vec),
    k: 5,
    channel: 'daemon' as const,
    ...extra,
})

async function settled<T>(f: () => Promise<T[]>, n = 1): Promise<T[]> {
    for (let i = 0; i < 60; i++) {
        const r = await f()
        if (r.length >= n) return r
        await sleep(50)
    }
    throw new Error('never settled')
}

test('a session is one hit: kind, id, local date, you/claude excerpt, hash', async () => {
    const f = fixture()
    f.session('s-alpha', [['tell me about alpha', 'alpha is the first letter']])
    f.session('s-beta', [['what is beta', 'beta is second ' + 'x'.repeat(600)]])
    const hits = await settled(() => chatSourceHits(f.vault, q([0, 1, 0])))
    expect(hits[0]).toMatchObject({ kind: 'chat', id: 's-beta', date: '2026-10-20' })
    expect(hits[0]!.excerpt.startsWith('you: what is beta claude: beta is second')).toBe(true)
    expect(hits[0]!.excerpt.length).toBeLessThanOrEqual(SOURCE_EXCERPT_CHARS)
    expect(hits[0]!.hash).toMatch(/^[0-9a-f]+$/)
})

test('cron and sidechain-only sessions are not indexed', async () => {
    const f = fixture()
    f.session('real', [['beta question', 'beta answer']])
    f.session('cron', [['[Cron: nightly] beta job', 'done beta']])
    await settled(() => chatSourceHits(f.vault, q([0, 1, 0])))
    await sleep(200)
    expect((await chatSourceHits(f.vault, q([0, 1, 0]))).map(h => h.id)).toEqual(['real'])
})

test('hash changes when the session text changes, and only changed logs are re-read', async () => {
    const f = fixture()
    f.session('s1', [['beta one', 'beta reply']])
    const a = (await settled(() => chatSourceHits(f.vault, q([0, 1, 0]))))[0]!
    const path = f.session('s1', [['beta one', 'beta reply'], ['beta two', 'beta more']])
    const b = (await settled(() => chatSourceHits(f.vault, q([0, 1, 0]))))[0]!
    expect(b.hash).not.toBe(a.hash)
    expect(f.calls.embed).toBeGreaterThan(0)
    expect(path).toContain('s1.jsonl')
})

test('visibility: channel filter, excluded session, trashed session', async () => {
    const f = fixture()
    writeFileSync(
        join(f.vault, '.settings'),
        'embeddings:\n  enabled: true\nchatVisibility:\n  secret: chat-only\n',
    )
    f.session('secret', [['beta secret', 'beta']])
    f.session('open', [['beta open', 'beta']])
    f.session('me', [['beta me', 'beta']])
    await settled(() => chatSourceHits(f.vault, q([0, 1, 0], { channel: 'chat' })), 3)
    const ids = async (extra: object) => (await chatSourceHits(f.vault, q([0, 1, 0], extra))).map(h => h.id).sort()
    expect(await ids({})).toEqual(['me', 'open'])
    expect(await ids({ channel: 'chat' })).toEqual(['me', 'open', 'secret'])
    expect(await ids({ excludeSessionId: 'me' })).toEqual(['open'])
    // moved to the trash: gone from the top level, never returned
    const { renameSync } = await import('node:fs')
    mkdirSync(join(f.dir, '.bismuth-trash'), { recursive: true })
    renameSync(join(f.dir, 'open.jsonl'), join(f.dir, '.bismuth-trash', 'open.jsonl'))
    expect(await ids({})).toEqual(['me'])
})

test('chatSemanticSearch: off, no-worker, build embeds inside waitMs', async () => {
    const off = fixture({ enabled: false })
    expect(await chatSemanticSearch(off.vault, 'beta', { channel: 'chat' })).toMatchObject({ unavailable: 'off' })

    const none = fixture()
    configureChatEmbed({ channel: createSemanticChannel({ compiled: true, env: {}, execPath: '/usr/local/bin/bismuth' }) })
    expect(await chatSemanticSearch(none.vault, 'beta', { channel: 'chat' })).toMatchObject({ unavailable: 'no-worker' })

    const f = fixture()
    f.session('s-beta', [['beta talk', 'beta']])
    f.session('s-gamma', [['gamma talk', 'gamma']])
    const r = await chatSemanticSearch(f.vault, 'beta', { channel: 'chat', build: true, waitMs: 5000, k: 1 })
    expect(Array.isArray(r)).toBe(true)
    expect((r as { id: string }[]).map(h => h.id)).toEqual(['s-beta'])
})

test('syncChatEmbeddings embeds in the background', async () => {
    const f = fixture()
    f.session('s-beta', [['beta talk', 'beta']])
    syncChatEmbeddings(f.vault)
    await sleep(300)
    expect(f.calls.embed).toBeGreaterThan(0)
    rmSync(f.dir, { recursive: true, force: true })
})

test('the excluded session log is not re-read or re-embedded after it grows', async () => {
    const f = fixture()
    const seenTexts: string[] = []
    const mk = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            seenTexts.push(...texts)
            return texts.map(t => Float32Array.from(vecOf(t)))
        },
    })
    configureChatEmbed({
        channel: createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') }),
        vectorsDir: tempDir('cv-'),
        syncDebounceMs: 10,
        storeDebounceMs: 10,
    })
    f.session('other', [['beta other', 'beta']])
    f.session('me', [['beta me first', 'beta']])
    const ask = () => chatSourceHits(f.vault, q([0, 1, 0], { excludeSessionId: 'me' }))
    expect((await settled(ask)).map(h => h.id)).toEqual(['other'])
    await sleep(200)
    f.session('me', [['beta me first', 'beta'], ['beta me grown zzz', 'beta']])
    expect((await ask()).map(h => h.id)).toEqual(['other'])
    await sleep(200)
    expect(seenTexts.some(t => t.includes('me first') || t.includes('zzz'))).toBe(false)
})
