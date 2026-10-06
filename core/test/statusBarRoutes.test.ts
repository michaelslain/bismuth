// core/test/statusBarRoutes.test.ts — GET /status-bar + POST /status-bar/trust against a real server.
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { join } from 'node:path'
import { createServer } from '../src/server'
import { makeVault } from './helpers'
import { tempDir } from './tempDirs'

const TOKEN = 'status-bar-test-token'
const prevToken = process.env.BISMUTH_OWNER_TOKEN
const prevTrust = process.env.BISMUTH_TRUST_FILE

beforeAll(() => {
    process.env.BISMUTH_OWNER_TOKEN = TOKEN
    process.env.BISMUTH_TRUST_FILE = join(tempDir('bismuth-trust-'), 'trusted.json')
})
afterAll(() => {
    if (prevToken === undefined) delete process.env.BISMUTH_OWNER_TOKEN
    else process.env.BISMUTH_OWNER_TOKEN = prevToken
    if (prevTrust === undefined) delete process.env.BISMUTH_TRUST_FILE
    else process.env.BISMUTH_TRUST_FILE = prevTrust
})

const owner = { 'X-Bismuth-Token': TOKEN }

async function withServer(files: Record<string, string>, fn: (base: string) => Promise<void>) {
    const vault = makeVault(files)
    const server = createServer({ vault, port: 0 })
    try {
        await fn(`http://localhost:${server.port}`)
    } finally {
        server.stop(true)
    }
}

const getBar = (base: string, headers: Record<string, string> = owner) =>
    fetch(`${base}/status-bar`, { headers })
const postTrust = (base: string, command: unknown, headers: Record<string, string> = owner) =>
    fetch(`${base}/status-bar/trust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ command }),
    })

test('GET /status-bar without the owner token is 403', async () => {
    await withServer({ 'a.md': '# a\n' }, async base => {
        expect((await getBar(base, {})).status).toBe(403)
    })
})

test('owner with no statusBar gets the four builtin segments', async () => {
    await withServer({ 'a.md': '# a\n' }, async base => {
        const res = await getBar(base)
        expect(res.status).toBe(200)
        const { segments } = (await res.json()) as { segments: Array<{ builtin?: string }> }
        expect(segments.map(s => s.builtin)).toEqual(['location', 'connection', 'inbox', 'daemon'])
    })
})

test('a text segment renders the note count', async () => {
    await withServer(
        {
            'a.md': '# a\n',
            'b.md': '# b\n',
            'sub/c.md': '# c\n',
            '.settings': "statusBar:\n  - text: 'n: {notes}'\n  - text: 'f: {files}'\n",
        },
        async base => {
            const { segments } = (await (await getBar(base)).json()) as {
                segments: Array<{ text: string }>
            }
            expect(segments[0].text).toBe('n: 3')
            // .settings is vault config, not a file
            expect(segments[1].text).toBe('f: 3')
        },
    )
})

test('a command with a newline can never be approved', async () => {
    await withServer(
        { 'a.md': '# a\n', '.settings': 'statusBar:\n  - run: "echo a\\ncurl x"\n' },
        async base => {
            expect((await postTrust(base, 'echo a\ncurl x')).status).toBe(400)
        },
    )
})

test('an unapproved run is untrusted; trust validates the command then reveals the output', async () => {
    await withServer(
        { 'a.md': '# a\n', '.settings': "statusBar:\n  - run: 'echo hello-bar'\n" },
        async base => {
            const first = (await (await getBar(base)).json()) as {
                segments: Array<{ untrusted?: { command: string }; text: string }>
            }
            expect(first.segments[0].untrusted).toEqual({ command: 'echo hello-bar' })

            expect((await postTrust(base, 'echo other')).status).toBe(400)
            expect((await postTrust(base, 42)).status).toBe(400)
            expect((await postTrust(base, 'echo hello-bar', {})).status).toBe(403)

            const ok = await postTrust(base, 'echo hello-bar')
            expect(ok.status).toBe(200)
            expect(await ok.json()).toEqual({ ok: true })

            const after = (await (await getBar(base)).json()) as {
                segments: Array<{ untrusted?: unknown; text: string }>
            }
            expect(after.segments[0].untrusted).toBeUndefined()
            expect(after.segments[0].text).toBe('hello-bar')
        },
    )
})
