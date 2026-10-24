// The opencode driver against opencode 2's server, with a scripted stand-in binary
// (../support/fakeOpencodeV2.ts) on PATH: the shared server starts with a password and is driven
// over `/api`, turns end on `session.execution.*` events, and every chat control (model, images,
// commands, permissions, Stop, history, private erase, the provider list) reaches the right route.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '../../src/chat'
import * as oc from '../../src/chatProviders/opencode/opencode'
import { listProviders } from '../../src/chatProviders/opencode/opencodeProviders'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { pidAlive } from '../support/acpFakeAgentProcess'
import { tempDir } from '../tempDirs'

const FAKE = join(import.meta.dir, '../support/fakeOpencodeV2.ts')
let binDir = ''
let vault = ''
let pidFile = ''
let savedPath: string | undefined
let chat = 0

type LogEntry = { method: string; path: string; body: unknown }

/** The fake server's request journal. */
async function journal(): Promise<LogEntry[]> {
    const url = ((await oc.opencodeClient()) as { url?: string } | null)?.url
    if (!url) throw new Error('no opencode server')
    return (await fetch(`${url}/__log`).then(r => r.json())) as LogEntry[]
}

/** Open a chat on the fake and wait for its header frames. */
async function open(model?: string) {
    const id = `v2-${++chat}`
    const c = makeChatFrameCollector(10_000)
    oc.openSession(id, vault, c.sink)
    await c.waitFor(f => f.type === 'models')
    await c.waitFor(f => f.type === 'auth')
    if (model) oc.setModel(id, model)
    const sessionId = (
        (await c.waitFor(f => f.type === 'session')) as Extract<
            ChatFrame,
            { type: 'session' }
        >
    ).sessionId
    return { id, sessionId, ...c }
}

const resultOf = (frames: ChatFrame[]) =>
    frames.find(f => f.type === 'result') as
        Extract<ChatFrame, { type: 'result' }> | undefined

beforeAll(() => {
    binDir = tempDir('bismuth-fake-opencode2-')
    vault = tempDir('bismuth-opencode2-vault-')
    pidFile = join(binDir, 'serve.pid')
    const stub = join(binDir, 'opencode')
    writeFileSync(
        stub,
        `#!/bin/bash\nexport FAKE_OPENCODE_PID_FILE=${JSON.stringify(pidFile)}\nexec bun run ${JSON.stringify(FAKE)} "$@"\n`,
    )
    chmodSync(stub, 0o755)
    savedPath = process.env.PATH
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`
})

afterAll(async () => {
    process.env.PATH = savedPath
    // The fake server stops with this process anyway; killing it now also clears the driver's
    // shared-server handle for any later file in the same run.
    let pid = 0
    try {
        pid = Number(readFileSync(pidFile, 'utf8').trim())
    } catch {
        /* never started */
    }
    if (pid > 0) {
        try {
            process.kill(pid)
        } catch {
            /* already gone */
        }
        for (let i = 0; i < 50 && pidAlive(pid); i++) await Bun.sleep(100)
        expect(pidAlive(pid)).toBe(false)
    }
    rmSync(binDir, { recursive: true, force: true })
    rmSync(vault, { recursive: true, force: true })
})

describe('opencode 2 driver', () => {
    test('opens on the v2 server: models with Zen Free, its commands, connected providers', async () => {
        const c = await open()
        const models = c.frames.find(f => f.type === 'models') as Extract<
            ChatFrame,
            { type: 'models' }
        >
        expect(models.models.map(m => [m.value, m.free])).toEqual([
            ['bismuth/zen-free-rotate', true],
            ['opencode/free-one', true],
            ['acme/paid', false],
        ])
        const manifests = c.frames.filter(
            f => f.type === 'manifest',
        ) as Extract<ChatFrame, { type: 'manifest' }>[]
        expect(manifests.at(-1)?.manifest.slashCommands).toContain('init')
        expect(c.frames.find(f => f.type === 'auth')).toEqual({
            type: 'auth',
            providers: [{ name: 'Acme', kind: 'api' }],
        })
        const create = (await journal()).find(
            e => e.method === 'POST' && e.path === '/api/session',
        )
        expect(create?.body).toEqual({ location: { directory: vault } })
        oc.closeChat(c.id)
    })

    test('a turn streams deltas once, chips its tool, reports cost and switches the model first', async () => {
        const c = await open('acme/paid')
        oc.sendMessage(c.id, 'hello', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        const text = c.frames
            .filter(f => f.type === 'assistant-text')
            .map(f => (f as { text: string }).text)
        expect(text).toEqual(['Hello ', 'there.'])
        expect(
            c.frames.filter(
                f => f.type === 'tool-use' || f.type === 'tool-result',
            ),
        ).toEqual([
            {
                type: 'tool-use',
                id: 'call_r',
                name: 'read',
                input: { path: 'a.md' },
            },
            {
                type: 'tool-result',
                id: 'call_r',
                content: 'file body',
                isError: false,
            },
        ])
        expect(resultOf(c.frames)).toEqual({
            type: 'result',
            isError: false,
            numTurns: 1,
            costUsd: 0.01,
        })
        const log = await journal()
        const model = log.findLast(
            e => e.path === `/api/session/${c.sessionId}/model`,
        )
        expect(model?.body).toEqual({
            model: { providerID: 'acme', id: 'paid' },
        })
        const prompt = log.findLast(
            e => e.path === `/api/session/${c.sessionId}/prompt`,
        )
        expect(prompt?.body).toEqual({ text: 'hello' })

        const history = await oc.sessionHistoryFrames(c.sessionId, vault)
        expect(history).toEqual([
            { type: 'user-message', text: 'hello' },
            { type: 'assistant-text', text: 'Hello there.' },
        ])
        oc.closeChat(c.id)
    })

    test('an image rides the prompt as a data URI file', async () => {
        const c = await open()
        oc.sendMessage(c.id, 'what is this', vault, c.sink, [
            { media_type: 'image/png', data: 'AAAA' } as never,
        ])
        await c.waitFor(f => f.type === 'done')
        const prompt = (await journal()).findLast(
            e => e.path === `/api/session/${c.sessionId}/prompt`,
        )
        expect(prompt?.body).toEqual({
            text: 'what is this',
            files: [{ uri: 'data:image/png;base64,AAAA', name: 'image-1.png' }],
        })
        oc.closeChat(c.id)
    })

    test('a known /command runs through the command route', async () => {
        const c = await open()
        await c.waitFor(
            f =>
                f.type === 'manifest' &&
                f.manifest.slashCommands.includes('init'),
        )
        oc.sendMessage(c.id, '/init keep it short', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        const cmd = (await journal()).findLast(
            e => e.path === `/api/session/${c.sessionId}/command`,
        )
        expect(cmd?.body).toEqual({ name: 'init', text: 'keep it short' })
        oc.closeChat(c.id)
    })

    test('a permission ask becomes a card, and allow runs the tool', async () => {
        const c = await open()
        oc.sendMessage(c.id, 'PERM', vault, c.sink)
        const ask = await c.waitFor(f => f.type === 'permission')
        expect(ask).toEqual({
            type: 'permission',
            id: 'per_1',
            toolName: 'shell',
            input: { command: 'ls -1' },
        })
        oc.respondPermission(c.id, 'per_1', 'allow')
        await c.waitFor(f => f.type === 'done')
        expect(resultOf(c.frames)?.isError).toBe(false)
        const reply = (await journal()).findLast(e =>
            e.path.endsWith('/permission/per_1/reply'),
        )
        expect(reply?.body).toEqual({ decision: 'once' })
        oc.closeChat(c.id)
    })

    test('deny declines the tool and ends the turn cleanly', async () => {
        const c = await open()
        oc.sendMessage(c.id, 'PERM', vault, c.sink)
        await c.waitFor(f => f.type === 'permission')
        oc.respondPermission(c.id, 'per_1', 'deny')
        await c.waitFor(f => f.type === 'done')
        expect(c.frames.find(f => f.type === 'tool-result')).toEqual({
            type: 'tool-result',
            id: 'call_1',
            content: 'The user declined this tool call',
            isError: true,
        })
        expect(c.frames.some(f => f.type === 'error')).toBe(false)
        expect(resultOf(c.frames)?.isError).toBe(false)
        oc.closeChat(c.id)
    })

    test('Stop interrupts the session and reports a clean stop', async () => {
        const c = await open()
        oc.sendMessage(c.id, 'LONG', vault, c.sink)
        await c.waitFor(f => f.type === 'assistant-text')
        oc.abortTurn(c.id)
        await c.waitFor(f => f.type === 'done')
        expect(resultOf(c.frames)?.isError).toBe(false)
        expect(c.frames.some(f => f.type === 'error')).toBe(false)
        expect(
            (await journal()).some(
                e => e.path === `/api/session/${c.sessionId}/interrupt`,
            ),
        ).toBe(true)
        oc.closeChat(c.id)
    })

    test('a provider that keeps failing is stopped with its error, not retried forever', async () => {
        const c = await open()
        oc.sendMessage(c.id, 'FAIL', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        expect(c.frames.find(f => f.type === 'error')).toEqual({
            type: 'error',
            code: 'error',
            message:
                'opencode could not reach the model after 3 attempts: ConnectionRefused',
        })
        expect(resultOf(c.frames)?.isError).toBe(true)
        oc.closeChat(c.id)
    })

    test('a private chat is deleted from the store when it closes', async () => {
        const c = await open()
        oc.setPrivate(c.id, true)
        oc.closeChat(c.id)
        for (let i = 0; i < 50; i++) {
            const log = await journal()
            if (log.some(e => e.method === 'DELETE')) break
            await Bun.sleep(50)
        }
        expect(
            (await journal()).some(
                e =>
                    e.method === 'DELETE' &&
                    e.path === `/api/session/${c.sessionId}`,
            ),
        ).toBe(true)
    })

    test('the provider manager reads integrations off the same server', async () => {
        const client = await oc.opencodeClient()
        expect(client).not.toBeNull()
        const list = await listProviders(client!)
        expect(list.connected).toEqual([
            { id: 'acme', name: 'Acme', kind: 'api' },
        ])
    })
})

describe('opencode 2 effort', () => {
    test('a model lists its reasoning variants as effort levels', async () => {
        const c = await open()
        const models = c.frames.find(f => f.type === 'models') as Extract<
            ChatFrame,
            { type: 'models' }
        >
        expect(models.models.map(m => [m.value, m.effortLevels])).toEqual([
            ['bismuth/zen-free-rotate', []],
            ['opencode/free-one', []],
            ['acme/paid', ['low', 'high']],
        ])
        oc.closeChat(c.id)
    })

    test('the picked level rides the model as its variant, and only where the model lists it', async () => {
        const c = await open('acme/paid')
        oc.setEffort(c.id, 'high')
        oc.sendMessage(c.id, 'one', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        const switches = () =>
            journal().then(log =>
                log
                    .filter(e => e.path === `/api/session/${c.sessionId}/model`)
                    .map(e => e.body),
            )
        expect(await switches()).toEqual([
            { model: { providerID: 'acme', id: 'paid', variant: 'high' } },
        ])

        // Same pick again: no switch. A level the model does not list: the model's default.
        c.frames.length = 0
        oc.sendMessage(c.id, 'two', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        oc.setEffort(c.id, 'max')
        c.frames.length = 0
        oc.sendMessage(c.id, 'three', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        expect(await switches()).toEqual([
            { model: { providerID: 'acme', id: 'paid', variant: 'high' } },
            { model: { providerID: 'acme', id: 'paid' } },
        ])
        oc.closeChat(c.id)
    })
})
