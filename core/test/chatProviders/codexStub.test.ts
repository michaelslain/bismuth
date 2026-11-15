// The codex driver against a stand-in `codex` on PATH: setEffort honours the levels the selected
// model lists, and codex's model-metadata warning on a non-local model never becomes an error frame.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '../../src/chat'
import * as codex from '../../src/chatProviders/codex/driver'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { tempDir } from '../tempDirs'

const MODELS = join(import.meta.dir, '../fixtures/codexDebugModels.json')
let binDir = ''
let vault = ''
let argvLog = ''
let savedPath: string | undefined
let chat = 0

const lines = [
    { type: 'thread.started', thread_id: 'th_1' },
    {
        type: 'item.completed',
        item: {
            id: 'e1',
            type: 'error',
            message:
                'Model metadata for `gpt-6-luna` not found. Defaulting to fallback metadata.',
        },
    },
    {
        type: 'item.completed',
        item: { id: 'm1', type: 'agent_message', text: 'ok' },
    },
    {
        type: 'turn.completed',
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
    },
]

beforeAll(() => {
    binDir = tempDir('bismuth-fake-codex-')
    vault = tempDir('bismuth-codex-stub-vault-')
    argvLog = join(binDir, 'argv.log')
    const events = join(binDir, 'events.jsonl')
    writeFileSync(events, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    const stub = join(binDir, 'codex')
    writeFileSync(
        stub,
        `#!/bin/bash
if [ "$1" = "debug" ]; then cat ${JSON.stringify(MODELS)}; exit 0; fi
if [ "$1" = "exec" ]; then printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}; cat ${JSON.stringify(events)}; exit 0; fi
exit 0
`,
    )
    chmodSync(stub, 0o755)
    savedPath = process.env.PATH
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`
})

afterAll(() => {
    process.env.PATH = savedPath
    rmSync(binDir, { recursive: true, force: true })
    rmSync(vault, { recursive: true, force: true })
})

async function open() {
    const id = `codex-stub-${++chat}`
    const c = makeChatFrameCollector(10_000)
    codex.openSession(id, vault, c.sink)
    await c.waitFor(f => f.type === 'models')
    codex.setModel(id, 'gpt-6-luna')
    return { id, ...c }
}

const lastExec = () => readFileSync(argvLog, 'utf8').trim().split('\n').at(-1) ?? ''

describe('codex setEffort with listed levels', () => {
    test('a listed level, including max, rides the turn', async () => {
        const c = await open()
        codex.setEffort(c.id, 'max')
        codex.sendMessage(c.id, 'hi', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        expect(lastExec()).toContain('model_reasoning_effort="max"')
        codex.closeChat(c.id)
    })

    test('a level the model does not list is refused', async () => {
        const c = await open()
        codex.setEffort(c.id, 'max')
        codex.setEffort(c.id, 'bogus')
        codex.sendMessage(c.id, 'hi', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        expect(lastExec()).not.toContain('model_reasoning_effort')
        codex.closeChat(c.id)
    })
})

describe('codex model-metadata warning on a non-local turn', () => {
    test('is dropped: no error frame, the turn ends clean', async () => {
        const c = await open()
        codex.sendMessage(c.id, 'hi', vault, c.sink)
        await c.waitFor(f => f.type === 'done')
        expect(c.frames.some(f => f.type === 'error')).toBe(false)
        const result = c.frames.find(f => f.type === 'result') as
            | Extract<ChatFrame, { type: 'result' }>
            | undefined
        expect(result?.isError).toBe(false)
        codex.closeChat(c.id)
    })
})

describe('codex compaction overflow on a small local window', () => {
    const OVERFLOW =
        'tokens to keep from the initial prompt is greater than the context length'
    let dir = ''
    let promptLog = ''
    let server: ReturnType<typeof Bun.serve> | null = null
    let path = ''

    beforeAll(() => {
        dir = tempDir('bismuth-fake-codex-overflow-')
        promptLog = join(dir, 'prompts.log')
        const stub = join(dir, 'codex')
        // A TRIGGER prompt fails with the overflow unless it carries the condensed chat.
        writeFileSync(
            stub,
            `#!/bin/bash
if [ "$1" = "debug" ]; then cat ${JSON.stringify(MODELS)}; exit 0; fi
if [ "$1" = "exec" ]; then
  p=$(cat)
  printf '%s\\n---\\n' "$p" >> ${JSON.stringify(promptLog)}
  echo '{"type":"thread.started","thread_id":"th_x"}'
  if printf '%s' "$p" | grep -q TRIGGER && { [ -n "$STUB_ALWAYS_OVERFLOW" ] || ! printf '%s' "$p" | grep -q 'condensed to fit'; }; then
    echo '{"type":"turn.failed","error":{"message":"${OVERFLOW}"}}'
    exit 1
  fi
  echo '{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"recovered"}}'
  echo '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
  exit 0
fi
exit 0
`,
        )
        chmodSync(stub, 0o755)
        path = `${dir}:${binDir}:${process.env.PATH ?? ''}`
        server = Bun.serve({
            port: 0,
            fetch: () =>
                Response.json({
                    data: [
                        {
                            id: 'small-model',
                            type: 'llm',
                            state: 'loaded',
                            loaded_context_length: 8192,
                        },
                    ],
                }),
        })
        writeFileSync(
            join(vault, '.settings'),
            `localModel:\n  enabled: true\n  url: http://127.0.0.1:${server.port}\n  model: 'small-model'\n`,
        )
    })

    afterAll(async () => {
        rmSync(join(vault, '.settings'), { force: true })
        await server?.stop(true)
    })

    const run = async (always: boolean) => {
        const saved = process.env.PATH
        process.env.PATH = path
        if (always) process.env.STUB_ALWAYS_OVERFLOW = '1'
        else delete process.env.STUB_ALWAYS_OVERFLOW
        try {
            const c = await open()
            codex.setModel(c.id, 'small-model')
            codex.sendMessage(c.id, 'first question', vault, c.sink)
            await c.waitFor(f => f.type === 'done')
            c.frames.length = 0
            codex.sendMessage(c.id, 'TRIGGER', vault, c.sink)
            await c.waitFor(f => f.type === 'done', 20_000).catch(() => {})
            return c
        } finally {
            process.env.PATH = saved
            delete process.env.STUB_ALWAYS_OVERFLOW
        }
    }

    test('retries once in a fresh seeded session with one status line, no error', async () => {
        rmSync(promptLog, { force: true })
        const c = await run(false)
        expect(c.frames.filter(f => f.type === 'error')).toEqual([])
        expect(c.frames.filter(f => f.type === 'retry')).toEqual([
            {
                type: 'retry',
                attempt: 2,
                maxAttempts: 2,
                note: "chat condensed to fit the model's window",
            },
        ])
        const prompts = readFileSync(promptLog, 'utf8')
        expect(prompts).toContain('<bismuth-condensed-chat>\n')
        expect(prompts).toContain('condensed to fit the model window')
        expect(prompts).toContain('user: first question')
        codex.closeChat(c.id)
    }, 30_000)

    test('a second overflow is a plain error', async () => {
        rmSync(promptLog, { force: true })
        const c = await run(true)
        await c.waitFor(f => f.type === 'error')
        const errors = c.frames.filter(f => f.type === 'error')
        expect(errors).toHaveLength(1)
        expect(errors[0]).toMatchObject({ message: OVERFLOW })
        expect(c.frames.filter(f => f.type === 'retry')).toHaveLength(1)
        // first question, the TRIGGER turn, and its one retry
        const runs = readFileSync(promptLog, 'utf8').split('---\n').length - 1
        expect(runs).toBe(3)
        codex.closeChat(c.id)
    }, 30_000)

    test('an overflow on the first turn is a plain error, with no retry', async () => {
        rmSync(promptLog, { force: true })
        const saved = process.env.PATH
        process.env.PATH = path
        try {
            const c = await open()
            codex.setModel(c.id, 'small-model')
            codex.sendMessage(c.id, 'TRIGGER', vault, c.sink)
            await c.waitFor(f => f.type === 'error', 20_000)
            expect(c.frames.some(f => f.type === 'retry')).toBe(false)
            expect(readFileSync(promptLog, 'utf8').split('---\n').length - 1).toBe(1)
            codex.closeChat(c.id)
        } finally {
            process.env.PATH = saved
        }
    }, 30_000)

    test('a resumed chat seeds the retry with the thread it resumed', async () => {
        rmSync(promptLog, { force: true })
        const THREAD = '01a1dc64-89e7-7f30-b617-6462d33e0464'
        const home = tempDir('bismuth-codex-home-')
        const rolloutDir = join(home, 'sessions', '2026', '11', '13')
        mkdirSync(rolloutDir, { recursive: true })
        const msg = (type: string, text: string) =>
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'item_completed',
                    item: { type, id: 'i', content: [{ type: 'text', text }] },
                },
            })
        writeFileSync(
            join(rolloutDir, `rollout-2026-11-13T10-00-00-${THREAD}.jsonl`),
            [
                JSON.stringify({
                    type: 'session_meta',
                    payload: { id: THREAD, cwd: vault, thread_source: 'user' },
                }),
                msg('UserMessage', 'resumed question about tulips'),
                msg('AgentMessage', 'resumed answer about tulips'),
            ].join('\n') + '\n',
        )
        const saved = { path: process.env.PATH, home: process.env.CODEX_HOME }
        process.env.PATH = path
        process.env.CODEX_HOME = home
        try {
            const id = `codex-stub-${++chat}`
            const c = makeChatFrameCollector(10_000)
            codex.resumeSession(id, THREAD, vault, c.sink)
            await c.waitFor(f => f.type === 'models')
            codex.setModel(id, 'small-model')
            await Bun.sleep(300) // the thread's messages are read off disk
            codex.sendMessage(id, 'TRIGGER', vault, c.sink)
            await c.waitFor(f => f.type === 'done', 20_000).catch(() => {})
            expect(c.frames.filter(f => f.type === 'retry')).toHaveLength(1)
            const prompts = readFileSync(promptLog, 'utf8')
            expect(prompts).toContain('user: resumed question about tulips')
            expect(prompts).toContain('assistant: resumed answer about tulips')
            codex.closeChat(id)
        } finally {
            process.env.PATH = saved.path
            if (saved.home === undefined) delete process.env.CODEX_HOME
            else process.env.CODEX_HOME = saved.home
            rmSync(home, { recursive: true, force: true })
        }
    }, 30_000)
})
