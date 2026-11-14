// The opencode driver in run mode (no `serve`): the scripted stand-in's `serve` exits 1, so each
// turn spawns `opencode run`. Covers the `--agent` argument and the invisible compact respawn.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as oc from '../../src/chatProviders/opencode/opencode'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { tempDir } from '../tempDirs'

const FAKE = join(import.meta.dir, '../support/fakeOpencodeV2.ts')
let binDir = ''
let vault = ''
let runLog = ''
let sessionLog = ''
let savedPath: string | undefined
let chat = 0

function runs(): { argv: string[]; config: string | null }[] {
    if (!existsSync(runLog)) return []
    return readFileSync(runLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l))
}

async function turn(
    c: ReturnType<typeof makeChatFrameCollector>,
    id: string,
    text: string,
) {
    const from = c.frames.length
    oc.sendMessage(id, text, vault, c.sink)
    await c.waitFor(f => f.type === 'done' && c.frames.indexOf(f) >= from)
    return c.frames.slice(from)
}

beforeAll(() => {
    binDir = tempDir('bismuth-fake-opencode-run-')
    vault = tempDir('bismuth-opencode-run-vault-')
    runLog = join(binDir, 'run.log')
    sessionLog = join(binDir, 'session.log')
    const stub = join(binDir, 'opencode')
    writeFileSync(
        stub,
        `#!/bin/bash\nexport FAKE_OPENCODE_NO_SERVE=1\nexport FAKE_OPENCODE_RUN_LOG=${JSON.stringify(runLog)}\nexport FAKE_OPENCODE_SESSION_LOG=${JSON.stringify(sessionLog)}\nexec bun run ${JSON.stringify(FAKE)} "$@"\n`,
    )
    chmodSync(stub, 0o755)
    savedPath = process.env.PATH
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`
})

afterAll(() => {
    process.env.PATH = savedPath
})

describe('opencode run mode', () => {
    test('the picked agent reaches argv as --agent', async () => {
        const id = `run-${++chat}`
        const c = makeChatFrameCollector(10_000)
        oc.openSession(id, vault, c.sink)
        await c.waitFor(f => f.type === 'auth')
        oc.setAgent(id, 'plan')
        const frames = await turn(c, id, 'hello')
        expect(frames.filter(f => f.type === 'error')).toEqual([])
        const argv = runs().at(-1)?.argv ?? []
        const i = argv.indexOf('--agent')
        expect(i).toBeGreaterThan(-1)
        expect(argv[i + 1]).toBe('plan')
        oc.closeChat(id)
    })

    test('a context overflow respawns once with the compact config and shows no error', async () => {
        const id = `run-${++chat}`
        const c = makeChatFrameCollector(10_000)
        oc.openSession(id, vault, c.sink)
        await c.waitFor(f => f.type === 'auth')
        const before = runs().length
        const frames = await turn(c, id, 'OVERFLOW please')
        const log = runs().slice(before)
        expect(log.length).toBe(2)
        expect(log[0].config ?? '').not.toContain('opencode_*')
        expect(log[1].config).toContain('opencode_*')
        expect(frames.filter(f => f.type === 'error')).toEqual([])
        const result = frames.find(f => f.type === 'result') as
            { isError: boolean } | undefined
        expect(result?.isError).toBe(false)
        oc.closeChat(id)
    })

    test('the compact retry of a first turn starts a new session, announced, and deletes the failed one', async () => {
        const id = `run-${++chat}`
        const c = makeChatFrameCollector(10_000)
        oc.openSession(id, vault, c.sink)
        await c.waitFor(f => f.type === 'auth')
        // A model of its own: the test above already moved the default model to the compact profile.
        oc.setModel(id, 'lmstudio/first-turn-model')
        const before = runs().length
        const frames = await turn(c, id, 'OVERFLOW first')
        const log = runs().slice(before)
        const sessionsSeen = frames
            .filter(f => f.type === 'session')
            .map(f => (f as { sessionId: string }).sessionId)
        expect(sessionsSeen.length).toBe(2)
        const [failed, kept] = sessionsSeen
        expect(kept).not.toBe(failed)
        // The default run, then the compact run with no `-s` (a new session).
        expect(log.length).toBe(2)
        expect(log[0].argv).not.toContain('-s')
        expect(log[1].argv).not.toContain('-s')
        expect(log[1].config).toContain('opencode_*')
        const deleted = readFileSync(sessionLog, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(l => (JSON.parse(l) as { argv: string[] }).argv)
        expect(deleted).toContainEqual(['session', 'delete', failed, '--standalone'])
        expect(frames.filter(f => f.type === 'error')).toEqual([])
        // The next turn continues the kept session.
        await turn(c, id, 'again')
        const next = runs().at(-1)?.argv ?? []
        expect(next[next.indexOf('-s') + 1]).toBe(kept)
        oc.closeChat(id)
    })
})
