// core/test/findAiRoute.test.ts — POST /find-ai against a real server: argument checks and the
// visibility gate, which both answer before any backend is resolved, so no AI runs here.
import { expect, test } from 'bun:test'
import { createServer } from '../src/server'
import { readRunRecords } from '../src/runRegistry'
import { makeVault, tempDir } from './helpers'

process.env.BISMUTH_RUN_DIR = tempDir('bismuth-findai-run-')

async function withServer(files: Record<string, string>, fn: (post: (body: unknown) => Promise<Response>) => Promise<void>) {
    const vault = makeVault(files)
    const server = createServer({ vault, port: 0 })
    try {
        const token = readRunRecords().find(r => r.vault === vault)?.token ?? ''
        await fn(body =>
            fetch(`http://localhost:${server.port}/find-ai`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(token ? { 'X-Bismuth-Token': token } : {}) },
                body: JSON.stringify(body),
            }),
        )
    } finally {
        server.stop(true)
    }
}

test('missing fields are a 400', async () => {
    await withServer({ 'a.md': 'hello' }, async post => {
        expect((await post({ path: 'a.md', query: 'x' })).status).toBe(400)
    })
})

test('a note hidden from ai is refused with a reason, even to the owner', async () => {
    await withServer({ 'secret.md': '---\nvisibility: hidden\n---\nthe pin is 1234\n' }, async post => {
        const r = await post({ path: 'secret.md', query: 'code', text: 'the pin is 1234' })
        expect(r.status).toBe(403)
        expect(await r.text()).toContain('this note is hidden from ai')
    })
})

test('a code or text file hidden from ai is refused as a file', async () => {
    await withServer(
        { 'Private/main.ts': 'x', '.settings': 'folderVisibility:\n  Private: hidden\n' },
        async post => {
            const r = await post({ path: 'Private/main.ts', query: 'q', text: 'x' })
            expect(r.status).toBe(403)
            expect(await r.text()).toContain('this file is hidden from ai')
        },
    )
})

test('a folder hidden from ai refuses its notes too', async () => {
    await withServer(
        { 'Private/a.md': 'x', '.settings': 'folderVisibility:\n  Private: hidden\n' },
        async post => {
            expect((await post({ path: 'Private/a.md', query: 'q', text: 'x' })).status).toBe(403)
        },
    )
})
