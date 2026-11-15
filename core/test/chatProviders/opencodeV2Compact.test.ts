// The opencode driver on opencode 2 with the scripted stand-in (../support/fakeOpencodeV2.ts, extras
// on) and a stand-in LM Studio: the injected window limits, the invisible compact retry and the
// overflow error, agents, the default model, model groups, stale picks and the saved-server refresh.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '../../src/chat'
import { CHAT_RENDERING_NOTE } from '../../src/chatRenderingNote'
import { whichBinary } from '../../src/claudeWhich'
import * as oc from '../../src/chatProviders/opencode/opencode'
import { ensureOpencodeServer } from '../../src/chatProviders/opencode/opencodeServer'
import { OpencodeV2Error } from '../../src/chatProviders/opencode/opencodeV2Client'
import { contextOverflowMessage } from '../../src/chatProviders/opencode/opencodeOverflow'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { pidAlive } from '../support/acpFakeAgentProcess'
import { tempDir } from '../tempDirs'

const FAKE = join(import.meta.dir, '../support/fakeOpencodeV2.ts')
const QWEN = 'lmstudio/qwen/qwen3.5-9b'
let binDir = ''
let vault = ''
let pidFile = ''
let spawnLog = ''
let savedPath: string | undefined
let chat = 0
let window = 8192
let lm: ReturnType<typeof Bun.serve>
let second: ReturnType<typeof Bun.serve>

type LogEntry = { method: string; path: string; body: unknown }

/** A stand-in LM Studio: `GET /api/v0/models` lists one loaded model at `windowOf()`. */
function lmStudio(id: string, windowOf: () => number) {
    return Bun.serve({
        port: 0,
        fetch(req) {
            if (new URL(req.url).pathname === '/api/v0/models')
                return Response.json({
                    data: [
                        {
                            id,
                            type: 'llm',
                            state: 'loaded',
                            loaded_context_length: windowOf(),
                            max_context_length: 262144,
                        },
                    ],
                })
            return new Response('no', { status: 404 })
        },
    })
}

async function serverUrl(profile: 'default' | 'compact'): Promise<string> {
    const bin = whichBinary('opencode') as string
    const h = await ensureOpencodeServer(bin, undefined, profile)
    if (!h) throw new Error(`no ${profile} server`)
    return h.url
}

async function journal(profile: 'default' | 'compact'): Promise<LogEntry[]> {
    return (await fetch(`${await serverUrl(profile)}/__log`).then(r =>
        r.json(),
    )) as LogEntry[]
}

async function injected(profile: 'default' | 'compact') {
    const r = (await fetch(`${await serverUrl(profile)}/__env`).then(r =>
        r.json(),
    )) as { config: string | null }
    return r.config ? JSON.parse(r.config) : null
}

/** The user messages of a session, read off the compact server (every server shares the store). */
async function userTexts(sessionId: string): Promise<string[]> {
    const bin = whichBinary('opencode') as string
    const h = await ensureOpencodeServer(bin, undefined, 'compact')
    if (h?.version !== 2) throw new Error('no compact server')
    const msgs = (await h.client.messages(sessionId)) as {
        type?: string
        text?: string
    }[]
    return msgs.filter(m => m.type === 'user').map(m => m.text ?? '')
}

const prompts = (log: LogEntry[]) =>
    log.filter(e => e.method === 'POST' && e.path.endsWith('/prompt'))

async function open(model?: string, cwd = vault, memoryDir?: string) {
    const id = `v2c-${++chat}`
    const c = makeChatFrameCollector(10_000)
    oc.openSession(id, cwd, c.sink, memoryDir)
    await c.waitFor(f => f.type === 'models')
    await c.waitFor(f => f.type === 'auth')
    await c.waitFor(f => f.type === 'agents')
    if (model) oc.setModel(id, model)
    const sessionId = (
        (await c.waitFor(f => f.type === 'session')) as Extract<
            ChatFrame,
            { type: 'session' }
        >
    ).sessionId
    return { id, sessionId, ...c }
}

async function turn(
    c: Awaited<ReturnType<typeof open>>,
    text: string,
    cwd = vault,
) {
    const from = c.frames.length
    oc.sendMessage(c.id, text, cwd, c.sink)
    await c.waitFor(f => f.type === 'done' && c.frames.indexOf(f) >= from)
    return c.frames.slice(from)
}

beforeAll(() => {
    binDir = tempDir('bismuth-fake-opencode2c-')
    vault = tempDir('bismuth-opencode2c-vault-')
    pidFile = join(binDir, 'serve.pid')
    spawnLog = join(binDir, 'serve.spawns')
    lm = lmStudio('qwen/qwen3.5-9b', () => window)
    second = lmStudio('other-model', () => 4096)
    const stub = join(binDir, 'opencode')
    writeFileSync(
        stub,
        `#!/bin/bash\n[ "$1" = serve ] && echo x >> ${JSON.stringify(spawnLog)}\nexport FAKE_OPENCODE_PID_FILE=${JSON.stringify(pidFile)}\nexport FAKE_OPENCODE_EXTRAS=1\nexport FAKE_OPENCODE_STORE=${JSON.stringify(join(binDir, 'store.json'))}\nexport FAKE_LMSTUDIO_URL=http://127.0.0.1:${lm.port}\nexec bun run ${JSON.stringify(FAKE)} "$@"\n`,
    )
    chmodSync(stub, 0o755)
    savedPath = process.env.PATH
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`
})

afterAll(async () => {
    process.env.PATH = savedPath
    lm.stop(true)
    second.stop(true)
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

describe('opencode 2 driver: windows, compact, agents', () => {
    test('open carries groups, agents, the default model and the injected window limit', async () => {
        const c = await open()
        const models = c.frames.find(f => f.type === 'models') as Extract<
            ChatFrame,
            { type: 'models' }
        >
        const qwen = models.models.find(m => m.value === QWEN)
        expect(qwen?.group).toEqual({
            id: 'lmstudio',
            label: 'lm studio',
            kind: 'local',
        })
        expect(
            models.models.find(m => m.value === 'acme/paid')?.group?.kind,
        ).toBe('cloud')
        expect(
            models.models.find(m => m.value === 'opencode/free-one')?.group
                ?.kind,
        ).toBe('zen')
        // Primaries only, hidden and subagents left out, `build` current.
        expect(c.frames.find(f => f.type === 'agents')).toEqual({
            type: 'agents',
            agents: [
                { value: 'build', label: 'build', description: '' },
                { value: 'plan', label: 'plan', description: '' },
            ],
            current: 'build',
        })
        // F4: no pick, local model off: opencode's default model is the session's.
        const manifest = c.frames.find(f => f.type === 'manifest') as Extract<
            ChatFrame,
            { type: 'manifest' }
        >
        expect(manifest.manifest.model).toBe('acme/paid')
        const cfg = await injected('default')
        expect(cfg.provider.lmstudio.models['qwen/qwen3.5-9b'].limit).toEqual({
            context: 8192,
            output: 8192,
        })
        oc.closeChat(c.id)
    })

    test('an unchanged reopen keeps the server', async () => {
        const before = await serverUrl('default')
        const c = await open()
        expect(await serverUrl('default')).toBe(before)
        oc.closeChat(c.id)
    })

    test('a small window starts on the compact profile, before any overflow', async () => {
        const defaultBefore = prompts(await journal('default')).length
        const compactBefore = prompts(await journal('compact')).length
        const c = await open(QWEN)
        const frames = await turn(c, 'hello small')
        expect(frames.find(f => f.type === 'error')).toBeUndefined()
        expect(prompts(await journal('default')).length).toBe(defaultBefore)
        expect(prompts(await journal('compact')).length).toBe(compactBefore + 1)
        expect(await userTexts(c.sessionId)).toEqual(['hello small'])
        oc.closeChat(c.id)
    })

    test('an overflowing turn retries once on the compact profile, invisibly, and later turns skip the default', async () => {
        // A window the estimate says holds the default prompt, which overflows anyway.
        window = 65536
        const c = await open(QWEN)
        const frames = await turn(c, 'OVERFLOW please')
        expect(frames.find(f => f.type === 'error')).toBeUndefined()
        expect(
            frames
                .filter(f => f.type === 'assistant-text')
                .map(f => (f as { text: string }).text),
        ).toEqual(['Hello ', 'there.'])
        expect(
            (frames.find(f => f.type === 'result') as { isError: boolean })
                .isError,
        ).toBe(false)
        // Both servers read one session store: the retry continues the same session, with the failed
        // attempt dropped from it, so the turn holds one user message and no new session is announced.
        expect(frames.find(f => f.type === 'session')).toBeUndefined()
        expect(await userTexts(c.sessionId)).toEqual(['OVERFLOW please'])
        const compactCfg = await injected('compact')
        expect(
            compactCfg.permissions.some(
                (p: { action: string }) => p.action === 'opencode_*',
            ),
        ).toBe(true)
        const onDefault = prompts(await journal('default')).length
        const onCompact = prompts(await journal('compact')).length
        expect(onDefault).toBeGreaterThan(0)
        expect(onCompact).toBe(1)

        await turn(c, 'OVERFLOW again')
        expect(await userTexts(c.sessionId)).toEqual([
            'OVERFLOW please',
            'OVERFLOW again',
        ])
        expect(prompts(await journal('default')).length).toBe(onDefault)
        expect(prompts(await journal('compact')).length).toBe(onCompact + 1)
        const instructions = (await journal('compact')).filter(
            e =>
                e.method !== 'GET' &&
                JSON.stringify(e.body ?? '').includes(
                    JSON.stringify(CHAT_RENDERING_NOTE).slice(1, -1),
                ),
        )
        expect(instructions.length).toBeGreaterThan(0)
        oc.closeChat(c.id)
        window = 8192
    })

    test('the default turn carries the brain block (vault map) and the compact turn drops it', async () => {
        const brainVault = tempDir('bismuth-opencode2c-brain-')
        const memoryDir = tempDir('bismuth-opencode2c-memory-')
        writeFileSync(join(brainVault, 'Alpha.md'), '# Alpha\n\nA note.\n')
        // The brain only composes with memory recall switched on in the vault's .settings.
        writeFileSync(join(brainVault, '.settings'), 'daemon:\n  recall:\n    enabled: true\n')
        const mapped = async (profile: 'default' | 'compact', sessionId: string) =>
            (await journal(profile)).filter(
                e =>
                    e.method !== 'GET' &&
                    e.path.includes(sessionId) &&
                    JSON.stringify(e.body ?? '').includes('# Vault map'),
            )
        const d = await open(undefined, brainVault, memoryDir)
        await turn(d, 'BRAIN_DEFAULT', brainVault)
        expect((await mapped('default', d.sessionId)).length).toBeGreaterThan(0)
        oc.closeChat(d.id)
        // QWEN is on the compact profile by now (an earlier test overflowed it); either way this
        // turn ends there, and its instructions entry must carry the rendering note but no brain.
        const c = await open(QWEN, brainVault, memoryDir)
        await turn(c, 'OVERFLOW BRAIN_COMPACT', brainVault)
        const entries = (await journal('compact')).filter(
            e =>
                e.method !== 'GET' &&
                JSON.stringify(e.body ?? '').includes(
                    JSON.stringify(CHAT_RENDERING_NOTE).slice(1, -1),
                ),
        )
        expect(entries.length).toBeGreaterThan(0)
        expect(await mapped('compact', c.sessionId)).toEqual([])
        expect(
            entries.some(e => JSON.stringify(e.body).includes('# Vault map')),
        ).toBe(false)
        oc.closeChat(c.id)
    })

    test('a model that sends nothing ends the turn with an error naming it and the window', async () => {
        process.env.BISMUTH_OPENCODE_NO_PROGRESS_MS = '1000'
        try {
            const c = await open(QWEN)
            const t0 = Date.now()
            const frames = await turn(c, 'SILENT please')
            expect(Date.now() - t0).toBeLessThan(8000)
            const errors = frames.filter(f => f.type === 'error') as Extract<
                ChatFrame,
                { type: 'error' }
            >[]
            expect(errors).toHaveLength(1)
            expect(errors[0]!.message).toContain(QWEN)
            expect(errors[0]!.message).toContain('1 s')
            expect(frames.some(f => f.type === 'result')).toBe(true)
            oc.closeChat(c.id)
        } finally {
            delete process.env.BISMUTH_OPENCODE_NO_PROGRESS_MS
        }
    })

    test('a card left open by Stop does not hold the next turn from the no-progress error', async () => {
        process.env.BISMUTH_OPENCODE_NO_PROGRESS_MS = '1000'
        try {
            const c = await open(QWEN)
            oc.sendMessage(c.id, 'PERM', vault, c.sink)
            await c.waitFor(f => f.type === 'permission')
            oc.abortTurn(c.id)
            await c.waitFor(f => f.type === 'done')
            const t0 = Date.now()
            const frames = await turn(c, 'SILENT please')
            expect(Date.now() - t0).toBeLessThan(8000)
            const errors = frames.filter(f => f.type === 'error')
            expect(errors.length).toBeGreaterThan(0)
            expect(JSON.stringify(errors)).toContain('sent nothing')
            oc.closeChat(c.id)
        } finally {
            delete process.env.BISMUTH_OPENCODE_NO_PROGRESS_MS
        }
    })

    test('the compact turn names the vault skills in its text, and its retry replaces the entry with the lean one', async () => {
        const skillVault = tempDir('bismuth-opencode2c-skill-')
        mkdirSync(join(skillVault, '.claude/skills/bench-skill'), { recursive: true })
        writeFileSync(
            join(skillVault, '.claude/skills/bench-skill/SKILL.md'),
            '---\nname: bench-skill\ndescription: Use when the bench asks for the bench skill.\n---\n',
        )
        // A window no earlier test overflowed on, so the first attempt runs on the default profile.
        window = 49152
        const c = await open(QWEN, skillVault)
        await turn(c, 'OVERFLOW skills', skillVault)
        window = 8192
        const log = (await journal('compact')).filter(
            e => e.path.includes(c.sessionId) && e.path.includes('/instructions/entries/'),
        )
        const methods = log.map(e => e.method)
        // The failed first attempt may have written an entry on the default server; on the compact
        // one the old entry goes before the lean one is put.
        expect(methods.indexOf('DELETE')).toBeGreaterThanOrEqual(0)
        expect(methods.indexOf('DELETE')).toBeLessThan(methods.indexOf('PUT'))
        const put = log.find(e => e.method === 'PUT')!
        expect(JSON.stringify(put.body)).toContain('bench-skill')
        expect(JSON.stringify(put.body)).toContain('.claude/skills/bench-skill/SKILL.md')
        oc.closeChat(c.id)
    })

    test('a compact turn that still overflows ends with the window error', async () => {
        const c = await open(QWEN)
        const frames = await turn(c, 'OVERFLOW_ALWAYS')
        const errors = frames.filter(f => f.type === 'error') as Extract<
            ChatFrame,
            { type: 'error' }
        >[]
        expect(errors.map(e => e.message)).toEqual([
            contextOverflowMessage({
                model: 'Qwen3.5 9B (local)',
                window: 8192,
                kind: 'lmstudio',
            }),
        ])
        oc.closeChat(c.id)
    })

    test('setAgent switches once, ignores unlisted names, and a resume reads the session agent', async () => {
        const c = await open()
        oc.setAgent(c.id, 'explore')
        oc.setAgent(c.id, 'title')
        oc.setAgent(c.id, 'plan')
        await turn(c, 'hello')
        await turn(c, 'hello again')
        const posts = (await journal('default')).filter(
            e =>
                e.method === 'POST' &&
                e.path === `/api/session/${c.sessionId}/agent`,
        )
        expect(posts.map(p => p.body)).toEqual([{ agent: 'plan' }])
        const r = makeChatFrameCollector(10_000)
        oc.resumeSession('v2c-resume', c.sessionId, vault, r.sink)
        const agents = (await r.waitFor(f => f.type === 'agents')) as Extract<
            ChatFrame,
            { type: 'agents' }
        >
        expect(agents.current).toBe('plan')
        oc.closeChat('v2c-resume')
        oc.closeChat(c.id)
    })

    test('the default model takes the chosen effort variant', async () => {
        const c = await open()
        oc.setEffort(c.id, 'high')
        await turn(c, 'hello')
        const switches = (await journal('default')).filter(
            e =>
                e.method === 'POST' &&
                e.path === `/api/session/${c.sessionId}/model`,
        )
        expect(switches.at(-1)?.body).toMatchObject({
            model: { variant: 'high' },
        })
        oc.closeChat(c.id)
    })

    test('a pick the model list lacks is refused with the model the session keeps', async () => {
        const c = await open()
        oc.setModel(c.id, 'nowhere/missing')
        const refused = await c.waitFor(f => f.type === 'model-refused')
        expect(refused).toEqual({
            type: 'model-refused',
            model: 'nowhere/missing',
            current: 'acme/paid',
        })
        oc.setModel(c.id, 'bismuth/zen-free-rotate')
        await Bun.sleep(50)
        expect(c.frames.filter(f => f.type === 'model-refused').length).toBe(1)
        oc.closeChat(c.id)
    })

    test('refreshOpencodeFrames(vault) picks up a server saved in .settings', async () => {
        const c = await open()
        writeFileSync(
            join(vault, '.settings'),
            `chat:\n  opencodeServers:\n    - name: Second\n      url: http://127.0.0.1:${second.port}\n`,
        )
        await oc.refreshOpencodeFrames(vault)
        const models = (await c.waitFor(
            f =>
                f.type === 'models' &&
                f.models.some(m => m.value === 'local-second/other-model'),
        )) as Extract<ChatFrame, { type: 'models' }>
        expect(
            models.models.find(m => m.value === 'local-second/other-model')
                ?.group,
        ).toEqual({ id: 'local-second', label: 'second', kind: 'local' })
        oc.closeChat(c.id)
        rmSync(join(vault, '.settings'))
    })

    test('a window that changed before a turn replaces the default server once', async () => {
        const c = await open(QWEN)
        const before = await serverUrl('default')
        window = 16384
        const first = await turn(c, 'hello')
        expect(first.filter(f => f.type === 'error')).toEqual([])
        const after = await serverUrl('default')
        expect(after).not.toBe(before)
        expect(
            (await injected('default')).provider.lmstudio.models[
                'qwen/qwen3.5-9b'
            ].limit,
        ).toEqual({ context: 16384, output: 8192 })
        const second2 = await turn(c, 'hello')
        expect(second2.filter(f => f.type === 'error')).toEqual([])
        expect(await serverUrl('default')).toBe(after)
        oc.closeChat(c.id)
    })

    test('two opens racing a changed window replace the default server once and both turns succeed', async () => {
        const spawns = () =>
            existsSync(spawnLog)
                ? readFileSync(spawnLog, 'utf8').split('\n').filter(Boolean).length
                : 0
        window = 20480
        const before = spawns()
        const mk = () => {
            const id = `v2c-${++chat}`
            const c = makeChatFrameCollector(10_000)
            oc.openSession(id, vault, c.sink)
            return { id, c }
        }
        const a = mk()
        const b = mk()
        for (const x of [a, b]) {
            await x.c.waitFor(f => f.type === 'models')
            await x.c.waitFor(f => f.type === 'session')
            oc.setModel(x.id, QWEN)
        }
        const run = async (x: typeof a) => {
            const from = x.c.frames.length
            oc.sendMessage(x.id, 'hello', vault, x.c.sink)
            await x.c.waitFor(
                f => f.type === 'done' && x.c.frames.indexOf(f) >= from,
            )
            return x.c.frames.slice(from)
        }
        const [fa, fb] = await Promise.all([run(a), run(b)])
        expect(fa.filter(f => f.type === 'error')).toEqual([])
        expect(fb.filter(f => f.type === 'error')).toEqual([])
        expect(spawns() - before).toBeLessThanOrEqual(1)
        expect(
            (await injected('default')).provider.lmstudio.models[
                'qwen/qwen3.5-9b'
            ].limit,
        ).toEqual({ context: 20480, output: 8192 })
        oc.closeChat(a.id)
        oc.closeChat(b.id)
    })

    test('an overflow mid-conversation retries in the same session and keeps the earlier turns', async () => {
        // acme/paid has not overflowed yet, so this turn starts on the default profile.
        const c = await open()
        await turn(c, 'hello')
        const frames = await turn(c, 'OVERFLOW midway')
        expect(frames.filter(f => f.type === 'error')).toEqual([])
        expect(frames.find(f => f.type === 'session')).toBeUndefined()
        expect(await userTexts(c.sessionId)).toEqual(['hello', 'OVERFLOW midway'])
        oc.closeChat(c.id)
    })

    test('the agents frame comes with the local model on too', async () => {
        writeFileSync(
            join(vault, '.settings'),
            `localModel:\n  enabled: true\n  url: http://127.0.0.1:${lm.port}\n  model: qwen/qwen3.5-9b\n`,
        )
        const id = `v2c-${++chat}`
        const c = makeChatFrameCollector(10_000)
        oc.openSession(id, vault, c.sink)
        const models = (await c.waitFor(f => f.type === 'models')) as Extract<
            ChatFrame,
            { type: 'models' }
        >
        expect(models.models.map(m => m.value)).toEqual(['local/qwen/qwen3.5-9b'])
        await c.waitFor(f => f.type === 'auth')
        // Emitted before `auth`, from a server just started for the local model's config, whose
        // first agent read answers empty.
        expect(c.frames.find(f => f.type === 'agents')).toEqual({
            type: 'agents',
            agents: [
                { value: 'build', label: 'build', description: '' },
                { value: 'plan', label: 'plan', description: '' },
            ],
            current: 'build',
        })
        oc.closeChat(id)
        rmSync(join(vault, '.settings'))
    })
})

type SessionFrame = Extract<ChatFrame, { type: 'session' }>

/** Resume `sessionId` as chat `id` and wait for its header. */
async function resume(id: string, sessionId: string) {
    const r = makeChatFrameCollector(10_000)
    oc.resumeSession(id, sessionId, vault, r.sink)
    await r.waitFor(f => f.type === 'agents')
    return r
}

/** Both servers' journals: a chat whose window is small runs its turns on the compact one. */
async function journals(): Promise<LogEntry[]> {
    const [a, b] = await Promise.all([journal('default'), journal('compact')])
    return [...a, ...b]
}

/** Wait until a server's journal holds an entry `pick` matches. */
async function journalWait(pick: (e: LogEntry) => boolean): Promise<void> {
    for (let i = 0; i < 50; i++) {
        if ((await journals()).some(pick)) return
        await Bun.sleep(100)
    }
    throw new Error('journal never held the entry')
}

describe('opencode 2 driver: resume, permission modes, a waiting permission', () => {
    test('a public chat resumed by id keeps its session and its agent', async () => {
        const c = await open()
        oc.setAgent(c.id, 'plan')
        await turn(c, 'hello')
        oc.closeChat(c.id)
        const r = await resume('v2c-keep', c.sessionId)
        const before = (await journal('default')).length
        oc.sendMessage('v2c-keep', 'hello again', vault, r.sink)
        await r.waitFor(f => f.type === 'done')
        const log = (await journal('default')).slice(before)
        expect(
            log.some(e => e.method === 'POST' && e.path === '/api/session'),
        ).toBe(false)
        expect(prompts(log).map(e => e.path)).toEqual([
            `/api/session/${c.sessionId}/prompt`,
        ])
        expect(log.some(e => e.path.endsWith('/agent'))).toBe(false)
        const moved = r.frames.filter(
            f => f.type === 'session' && f.sessionId !== c.sessionId,
        )
        expect(moved).toHaveLength(0)
        oc.closeChat('v2c-keep')
    })

    test('a private chat is erased at close, so its resume adopts a fresh session and sends nothing to the old id', async () => {
        const c = await open()
        oc.setPrivate(c.id, true)
        await turn(c, 'hello')
        oc.closeChat(c.id)
        await journalWait(
            e =>
                e.method === 'DELETE' &&
                e.path === `/api/session/${c.sessionId}`,
        )
        const r = await resume('v2c-gone', c.sessionId)
        const before = (await journal('default')).length
        oc.sendMessage('v2c-gone', 'hello again', vault, r.sink)
        await r.waitFor(f => f.type === 'done')
        const fresh = r.frames.findLast(f => f.type === 'session') as
            | SessionFrame
            | undefined
        expect(fresh?.sessionId).toBeTruthy()
        expect(fresh?.sessionId).not.toBe(c.sessionId)
        const log = (await journal('default')).slice(before)
        expect(
            log.some(
                e =>
                    e.method !== 'GET' &&
                    e.path.startsWith(`/api/session/${c.sessionId}/`),
            ),
        ).toBe(false)
        expect(prompts(log).map(e => e.path)).toEqual([
            `/api/session/${fresh?.sessionId}/prompt`,
        ])
        expect(r.frames.some(f => f.type === 'error')).toBe(false)
        oc.closeChat('v2c-gone')
    })

    test('a missing session is known by its status, its message or its tag', () => {
        expect(oc.isSessionMissing(new OpencodeV2Error('gone', 404))).toBe(true)
        expect(
            oc.isSessionMissing(
                new OpencodeV2Error('Session not found: ses_1', 500),
            ),
        ).toBe(true)
        expect(
            oc.isSessionMissing(
                new OpencodeV2Error('gone', 400, 'SessionNotFoundError'),
            ),
        ).toBe(true)
        expect(oc.isSessionMissing(new OpencodeV2Error('boom', 500))).toBe(
            false,
        )
        expect(oc.isSessionMissing(new Error('Session not found'))).toBe(false)
    })

    test('bypassPermissions allows every ask, acceptEdits allows edits, other modes ask', () => {
        expect(oc.opencodeAutoPermission('bypassPermissions', 'shell')).toBe(
            'once',
        )
        expect(oc.opencodeAutoPermission('acceptEdits', 'edit')).toBe('once')
        expect(oc.opencodeAutoPermission('acceptEdits', 'write')).toBe('once')
        expect(oc.opencodeAutoPermission('acceptEdits', 'shell')).toBeNull()
        expect(oc.opencodeAutoPermission('default', 'edit')).toBeNull()
        expect(oc.opencodeAutoPermission('plan', 'edit')).toBeNull()
        expect(oc.opencodeAutoPermission(undefined, 'edit')).toBeNull()
    })

    test('a chat in bypassPermissions answers the ask itself: no card, and the tool runs', async () => {
        const c = await open()
        oc.setPermissionMode(c.id, 'bypassPermissions')
        oc.setPermissionMode(c.id, 'nonsense')
        const manifest = c.frames.findLast(f => f.type === 'manifest') as
            | Extract<ChatFrame, { type: 'manifest' }>
            | undefined
        expect(manifest?.manifest.permissionMode).toBe('bypassPermissions')
        const frames = await turn(c, 'PERM please')
        expect(frames.some(f => f.type === 'permission')).toBe(false)
        expect(frames.some(f => f.type === 'error')).toBe(false)
        const isReply = (e: LogEntry) =>
            e.method === 'POST' &&
            e.path === `/api/session/${c.sessionId}/permission/per_1/reply`
        await journalWait(isReply)
        const replies = (await journals()).filter(isReply)
        expect(replies.map(e => e.body)).toEqual([{ decision: 'once' }])
        oc.closeChat(c.id)
    })

    test('a card answered after the no-progress window still finishes the turn', async () => {
        process.env.BISMUTH_OPENCODE_NO_PROGRESS_MS = '1000'
        try {
            const c = await open()
            oc.setPermissionMode(c.id, 'acceptEdits')
            const from = c.frames.length
            oc.sendMessage(c.id, 'PERM please', vault, c.sink)
            const ask = (await c.waitFor(
                f => f.type === 'permission' && c.frames.indexOf(f) >= from,
            )) as Extract<ChatFrame, { type: 'permission' }>
            await Bun.sleep(2500)
            oc.respondPermission(c.id, ask.id, 'allow')
            await c.waitFor(
                f => f.type === 'done' && c.frames.indexOf(f) >= from,
            )
            const frames = c.frames.slice(from)
            expect(frames.some(f => f.type === 'error')).toBe(false)
            expect(frames.some(f => f.type === 'result')).toBe(true)
            oc.closeChat(c.id)
        } finally {
            delete process.env.BISMUTH_OPENCODE_NO_PROGRESS_MS
        }
    }, 15_000)
})
