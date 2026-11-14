// opencode 2 session titles, with the scripted stand-in (../support/fakeOpencodeV2.ts): a session
// the driver creates is named from the first prompt before that prompt is sent (opencode otherwise
// spends a model call naming it), and a session created mid-turn carries the title in its create body.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '../../src/chat'
import { whichBinary } from '../../src/claudeWhich'
import * as oc from '../../src/chatProviders/opencode/opencode'
import { ensureOpencodeServer } from '../../src/chatProviders/opencode/opencodeServer'
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

async function journal(profile: 'default' | 'compact'): Promise<LogEntry[]> {
    const h = await ensureOpencodeServer(
        whichBinary('opencode') as string,
        undefined,
        profile,
    )
    if (!h) throw new Error(`no ${profile} server`)
    return (await fetch(`${h.url}/__log`).then(r => r.json())) as LogEntry[]
}

async function open() {
    const id = `title-${++chat}`
    const c = makeChatFrameCollector(10_000)
    oc.openSession(id, vault, c.sink)
    await c.waitFor(f => f.type === 'auth')
    const sessionId = (
        (await c.waitFor(f => f.type === 'session')) as Extract<
            ChatFrame,
            { type: 'session' }
        >
    ).sessionId
    return { id, sessionId, ...c }
}

async function turn(c: Awaited<ReturnType<typeof open>>, text: string) {
    const from = c.frames.length
    oc.sendMessage(c.id, text, vault, c.sink)
    await c.waitFor(f => f.type === 'done' && c.frames.indexOf(f) >= from)
    return c.frames.slice(from)
}

beforeAll(() => {
    binDir = tempDir('bismuth-fake-opencode2t-')
    vault = tempDir('bismuth-opencode2t-vault-')
    pidFile = join(binDir, 'serve.pid')
    // No shared store: the compact server does not know the default server's sessions, so the
    // compact retry creates one.
    const stub = join(binDir, 'opencode')
    writeFileSync(
        stub,
        `#!/bin/bash\nexport FAKE_OPENCODE_PID_FILE=${JSON.stringify(pidFile)}\nexport FAKE_OPENCODE_EXTRAS=1\nexec bun run ${JSON.stringify(FAKE)} "$@"\n`,
    )
    chmodSync(stub, 0o755)
    savedPath = process.env.PATH
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`
})

afterAll(async () => {
    process.env.PATH = savedPath
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
    }
    rmSync(binDir, { recursive: true, force: true })
    rmSync(vault, { recursive: true, force: true })
})

describe('opencode 2 session titles', () => {
    test('the first prompt names the session before it is sent, once', async () => {
        const c = await open()
        await turn(c, 'plan the garden beds for spring')
        await turn(c, 'and the herbs')
        const log = await journal('default')
        const at = (e: LogEntry) => log.indexOf(e)
        const patches = log.filter(
            e => e.method === 'PATCH' && e.path === `/api/session/${c.sessionId}`,
        )
        expect(patches.map(e => e.body)).toEqual([
            { title: 'plan the garden beds for spring' },
        ])
        const firstPrompt = log.find(
            e => e.method === 'POST' && e.path === `/api/session/${c.sessionId}/prompt`,
        ) as LogEntry
        expect(at(patches[0])).toBeLessThan(at(firstPrompt))
        oc.closeChat(c.id)
    })

    test('a session created for the compact retry carries the title in its create body', async () => {
        const c = await open()
        const frames = await turn(c, 'OVERFLOW summarise my notes')
        expect(frames.filter(f => f.type === 'error')).toEqual([])
        const creates = (await journal('compact')).filter(
            e => e.method === 'POST' && e.path === '/api/session',
        )
        expect(creates.length).toBeGreaterThan(0)
        expect((creates.at(-1)?.body as { title?: string }).title).toBe(
            'OVERFLOW summarise my notes',
        )
        oc.closeChat(c.id)
    })
})
