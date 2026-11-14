// The `agents` frame on opencode 2 with the scripted stand-in (../support/fakeOpencodeV2.ts, extras
// on) and the vault's local model on: a fresh server that answers several agent reads empty still
// yields the frame, and the frame goes out ahead of the `models` frame.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '../../src/chat'
import * as oc from '../../src/chatProviders/opencode/opencode'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { pidAlive } from '../support/acpFakeAgentProcess'
import { tempDir } from '../tempDirs'

const FAKE = join(import.meta.dir, '../support/fakeOpencodeV2.ts')
let binDir = ''
let vault = ''
let pidFile = ''
let savedPath: string | undefined
let lm: ReturnType<typeof Bun.serve>

beforeAll(() => {
    binDir = tempDir('bismuth-fake-opencode2a-')
    vault = tempDir('bismuth-opencode2a-vault-')
    pidFile = join(binDir, 'serve.pid')
    lm = Bun.serve({
        port: 0,
        fetch(req) {
            if (new URL(req.url).pathname === '/api/v0/models')
                return Response.json({
                    data: [
                        {
                            id: 'qwen/qwen3.5-9b',
                            type: 'llm',
                            state: 'loaded',
                            loaded_context_length: 8192,
                            max_context_length: 262144,
                        },
                    ],
                })
            return new Response('no', { status: 404 })
        },
    })
    writeFileSync(
        join(vault, '.settings'),
        `localModel:\n  enabled: true\n  url: http://127.0.0.1:${lm.port}\n  model: qwen/qwen3.5-9b\n`,
    )
    // Three empty agent reads: one more than a single re-read covers.
    const stub = join(binDir, 'opencode')
    writeFileSync(
        stub,
        `#!/bin/bash\nexport FAKE_OPENCODE_PID_FILE=${JSON.stringify(pidFile)}\nexport FAKE_OPENCODE_EXTRAS=1\nexport FAKE_OPENCODE_EMPTY_AGENT_READS=3\nexport FAKE_LMSTUDIO_URL=http://127.0.0.1:${lm.port}\nexec bun run ${JSON.stringify(FAKE)} "$@"\n`,
    )
    chmodSync(stub, 0o755)
    savedPath = process.env.PATH
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`
})

afterAll(async () => {
    process.env.PATH = savedPath
    lm.stop(true)
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

describe('opencode 2 agents frame with the local model on', () => {
    test('a server that answers its first agent reads empty still sends the agents, before the models', async () => {
        const c = makeChatFrameCollector(10_000)
        oc.openSession('agents-1', vault, c.sink)
        await c.waitFor(f => f.type === 'auth')
        const agents = c.frames.find(f => f.type === 'agents')
        expect(agents).toEqual({
            type: 'agents',
            agents: [
                { value: 'build', label: 'build', description: '' },
                { value: 'plan', label: 'plan', description: '' },
            ],
            current: 'build',
        })
        const models = c.frames.find(f => f.type === 'models') as Extract<
            ChatFrame,
            { type: 'models' }
        >
        expect(models.models.map(m => m.value)).toEqual(['local/qwen/qwen3.5-9b'])
        expect(c.frames.indexOf(agents as ChatFrame)).toBeLessThan(
            c.frames.indexOf(models),
        )
        oc.closeChat('agents-1')
    })

    test('a second chat on the same server gets the agents frame from the cache', async () => {
        const c = makeChatFrameCollector(10_000)
        oc.openSession('agents-2', vault, c.sink)
        await c.waitFor(f => f.type === 'auth')
        const types = c.frames.map(f => f.type)
        expect(types).toContain('agents')
        expect(types.indexOf('agents')).toBeLessThan(types.indexOf('models'))
        oc.closeChat('agents-2')
    })
})

describe('opencode 2 model pick during a refresh', () => {
    test('a pick made while refreshOpencodeFrames refetches waits for the new list', async () => {
        const c = makeChatFrameCollector(10_000)
        oc.openSession('refresh-1', vault, c.sink)
        await c.waitFor(f => f.type === 'auth')
        const from = c.frames.length
        const refresh = oc.refreshOpencodeFrames(vault)
        // The list is empty until the refetch lands; an id it will not hold is refused, not taken.
        oc.setModel('refresh-1', 'local/not-loaded')
        await refresh
        const refused = (await c.waitFor(
            f => f.type === 'model-refused' && c.frames.indexOf(f) >= from,
        )) as Extract<ChatFrame, { type: 'model-refused' }>
        expect(refused.model).toBe('local/not-loaded')
        expect(refused.current).toBe('local/qwen/qwen3.5-9b')
        oc.closeChat('refresh-1')
    })
})

describe('opencode 2 model pick with the local model on', () => {
    test('a cloud id is refused with model-refused naming the local model the chat keeps', async () => {
        const c = makeChatFrameCollector(10_000)
        oc.openSession('pin-1', vault, c.sink)
        await c.waitFor(f => f.type === 'auth')
        oc.setModel('pin-1', 'opencode/big-pickle')
        const refused = (await c.waitFor(
            f => f.type === 'model-refused',
        )) as Extract<ChatFrame, { type: 'model-refused' }>
        expect(refused).toEqual({
            type: 'model-refused',
            model: 'opencode/big-pickle',
            current: 'local/qwen/qwen3.5-9b',
        })
        oc.closeChat('pin-1')
    })
})
