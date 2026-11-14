// Live end-to-end proof of the opencode chat driver against a real opencode 2 server and LM Studio.
//   OPENCODE_CHAT_LIVE=1 perl ~/.claude/skills/execute/scripts/watchdog 900 bun test bench/opencodeChat.test.ts
// Without OPENCODE_CHAT_LIVE the suite skips. With it set, a missing prerequisite FAILS with the
// reason (a skip under the variable would read as a pass). Needs LM Studio on 127.0.0.1:1234 with
// qwen/qwen3.5-9b loaded at 8192 and the user's opencode config naming it. Every chat is private, so
// its opencode session is erased on close; the opencode server is the driver's own, never a background
// service, and no LM Studio model is loaded or unloaded.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '../core/src/chat'
import { whichBinary } from '../core/src/claudeWhich'
import * as oc from '../core/src/chatProviders/opencode/opencode'
import {
    ensureOpencodeServer,
    stopAllOpencodeServers,
} from '../core/src/chatProviders/opencode/opencodeServer'
import { defaultModelFromV2 } from '../core/src/chatProviders/opencode/opencodeV2Translate'
import { makeChatFrameCollector } from '../core/test/support/chatFrameCollector'
import { tempDir } from '../core/test/tempDirs'
import { startLoggingProxy, type ProxiedRequest } from './opencodeChatProxy'

const LIVE = !!process.env.OPENCODE_CHAT_LIVE
const LM = 'http://127.0.0.1:1234'
const QWEN_ID = 'qwen/qwen3.5-9b'
const QWEN = `lmstudio/${QWEN_ID}`
const LOCAL_QWEN = `local/${QWEN_ID}`
const WINDOW = 8192
const TURN_MS = 240_000

let proxy: Awaited<ReturnType<typeof startLoggingProxy>>
let vaultA = ''
let vaultB = ''
let chatNo = 0

/** research-budget.md's method: characters of the serialised body / 4. */
const estimate = (body: unknown) => Math.ceil(JSON.stringify(body).length / 4)
const chatRequests = () =>
    proxy.requests.filter(r => r.path.endsWith('/chat/completions'))

type Chat = Awaited<ReturnType<typeof open>>

async function open(vault: string, model?: string) {
    const id = `live-${++chatNo}`
    const c = makeChatFrameCollector(60_000)
    oc.openSession(id, vault, c.sink)
    oc.setPrivate(id, true)
    for (const t of ['models', 'auth'] as const)
        await c.waitFor(f => f.type === t)
    if (model) oc.setModel(id, model)
    const session = (await c.waitFor(f => f.type === 'session')) as Extract<
        ChatFrame,
        { type: 'session' }
    >
    return { id, vault, sessionId: session.sessionId, ...c }
}

async function turn(c: Chat, text: string): Promise<ChatFrame[]> {
    const from = c.frames.length
    oc.sendMessage(c.id, text, c.vault, c.sink)
    try {
        await c.waitFor(
            f => f.type === 'done' && c.frames.indexOf(f) >= from,
            TURN_MS,
        )
    } catch (e) {
        throw new Error(`${e}\nframes of the turn: ${dump(c.frames.slice(from))}`)
    }
    return c.frames.slice(from)
}

const assistantText = (frames: ChatFrame[]) =>
    frames
        .filter(f => f.type === 'assistant-text')
        .map(f => (f as { text: string }).text)
        .join('')
const dump = (frames: ChatFrame[]) =>
    JSON.stringify(frames.map(f => f.type === 'models' ? { type: 'models', n: f.models.length } : f)).slice(0, 4000)
/** LM Studio reports an over-window prompt as an `event: error` SSE inside a 200 response. */
const failed = (r: ProxiedRequest) =>
    r.status >= 400 || r.response.startsWith('event: error')
const dumpReqs = (rs: ProxiedRequest[]) =>
    JSON.stringify(
        rs.map(r => {
            const b = r.body as {
                messages?: { role: string; content?: unknown }[]
                tools?: unknown[]
            }
            return {
                failed: failed(r),
                est: estimate(r.body),
                messages: b.messages?.map(m => m.role).join(','),
                tools: b.tools?.length ?? 0,
                effort: (r.body as { reasoning_effort?: string }).reasoning_effort,
                response: r.response.slice(0, 120),
            }
        }),
    )

async function serverClient() {
    const bin = whichBinary('opencode') as string
    const h = await ensureOpencodeServer(bin)
    if (!h || h.version !== 2) throw new Error('no opencode 2 server is live')
    return h.client
}

/** The `opencode serve` processes this test process spawned (direct children), as `pid command`. */
function ownServes(): string[] {
    const out = Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,command='])
        .stdout.toString()
        .split('\n')
    return out
        .map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
        .filter(m => m && Number(m[2]) === process.pid && /opencode.*\bserve\b/.test(m[3]))
        .map(m => `${m![1]} ${m![3]}`)
}

describe.skipIf(!LIVE)('live: opencode chat driver on LM Studio', () => {
    beforeAll(async () => {
        const bin = whichBinary('opencode')
        if (!bin) throw new Error('prerequisite: opencode is not on PATH')
        const v = await Bun.spawn([bin, '--version'], { stdout: 'pipe' })
        const major = Number(
            (await new Response(v.stdout as ReadableStream).text()).match(
                /(\d+)\./,
            )?.[1],
        )
        if (!(major >= 2))
            throw new Error(`prerequisite: opencode 2 or newer needed, found major ${major}`)
        let listed: { id: string; state?: string; loaded_context_length?: number }[]
        try {
            const res = await fetch(`${LM}/api/v0/models`, {
                signal: AbortSignal.timeout(3000),
            })
            listed = ((await res.json()) as { data: typeof listed }).data
        } catch (e) {
            throw new Error(`prerequisite: LM Studio does not answer at ${LM}: ${e}`)
        }
        const q = listed.find(m => m.id === QWEN_ID)
        if (!q || q.state !== 'loaded')
            throw new Error(`prerequisite: ${QWEN_ID} is not loaded in LM Studio`)
        if (q.loaded_context_length !== WINDOW)
            throw new Error(
                `prerequisite: ${QWEN_ID} is loaded at ${q.loaded_context_length}, the bench needs ${WINDOW}`,
            )
        proxy = await startLoggingProxy(LM)
        vaultA = tempDir('bismuth-occhat-a-')
        vaultB = tempDir('bismuth-occhat-b-')
        writeFileSync(
            join(vaultA, '.settings'),
            `localModel:\n  enabled: true\n  url: ${proxy.url}\n  model: ${QWEN_ID}\n`,
        )
    })

    afterAll(async () => {
        proxy?.stop()
        // `bun test` never fires process 'exit', so the servers this run started are killed here.
        stopAllOpencodeServers()
        let left = ownServes()
        for (let i = 0; left.length && i < 30; i++) {
            await Bun.sleep(100)
            left = ownServes()
        }
        expect(left).toEqual([])
    })

    test('context size: an overflowing first turn compacts invisibly and answers; the second turn skips the default profile', async () => {
        const c = await open(vaultA)
        // The agents frame goes out before `auth`, with the local model on as without it.
        const agents = c.frames.find(f => f.type === 'agents') as
            | Extract<ChatFrame, { type: 'agents' }>
            | undefined
        expect(agents?.agents.map(a => a.value), dump(c.frames)).toContain('build')
        const first = await turn(c, 'say hi')
        const errors = first.filter(f => f.type === 'error')
        expect(errors, dump(first)).toEqual([])
        const results = first.filter(f => f.type === 'result') as {
            isError: boolean
        }[]
        expect(results.length, dump(first)).toBe(1)
        expect(results[0].isError, dump(first)).toBe(false)
        expect(assistantText(first).trim().length, dump(first)).toBeGreaterThan(0)

        const reqs = chatRequests()
        const failing = reqs.findIndex(failed)
        expect(failing, dumpReqs(reqs)).toBeGreaterThanOrEqual(0)
        const after = reqs.slice(failing + 1)
        const ok = after.filter(r => !failed(r))
        expect(ok.length, dumpReqs(reqs)).toBeGreaterThan(0)
        for (const r of ok)
            expect(estimate(r.body), dumpReqs(reqs)).toBeLessThan(WINDOW)
        expect(estimate(reqs[failing].body), dumpReqs(reqs)).toBeGreaterThan(
            Math.max(...ok.map(r => estimate(r.body))),
        )

        // The compact retry continues the same session (every server shares opencode's store) with the
        // failed default attempt dropped: it holds exactly one user message for the turn.
        const sessions = c.frames.filter(f => f.type === 'session') as {
            sessionId: string
        }[]
        const compactId = sessions[sessions.length - 1].sessionId
        const bin = whichBinary('opencode') as string
        const compact = await ensureOpencodeServer(bin, undefined, 'compact')
        if (!compact || compact.version !== 2)
            throw new Error('no compact opencode 2 server is live')
        const msgs = (await compact.client.messages(compactId)) as {
            type?: string
            text?: string
        }[]
        const users = msgs.filter(m => m.type === 'user')
        expect(
            users.length,
            `session ${compactId} (sessions announced: ${sessions.length}): types ${JSON.stringify(msgs.map(m => m.type))} users ${JSON.stringify(users.map(u => (u as { text?: string }).text?.slice(0, 200)))}`,
        ).toBe(1)

        const mark = proxy.requests.length
        const second = await turn(c, 'say hi again')
        expect(second.filter(f => f.type === 'error'), dump(second)).toEqual([])
        const fresh = proxy.requests
            .slice(mark)
            .filter(r => r.path.endsWith('/chat/completions'))
        expect(fresh.length, dump(second)).toBeGreaterThan(0)
        for (const r of fresh) {
            expect(failed(r), dumpReqs(fresh)).toBe(false)
            expect(estimate(r.body), dumpReqs(fresh)).toBeLessThan(WINDOW)
        }
        oc.closeChat(c.id)
    }, TURN_MS * 2 + 60_000)

    test('thinking: setEffort none sends reasoning_effort none and no thinking, high sends high and thinks', async () => {
        const c = await open(vaultA, LOCAL_QWEN)
        oc.setEffort(c.id, 'none')
        let mark = proxy.requests.length
        const off = await turn(c, 'what is 17 times 3? answer in one line')
        const offReqs = proxy.requests
            .slice(mark)
            .filter(r => r.path.endsWith('/chat/completions'))
        expect(offReqs.length, dump(off)).toBeGreaterThan(0)
        expect(
            offReqs.some(
                r =>
                    (r.body as { reasoning_effort?: string }).reasoning_effort ===
                    'none',
            ),
            dumpReqs(offReqs) + JSON.stringify(offReqs.map(r => Object.keys(r.body as object))),
        ).toBe(true)
        expect(off.filter(f => f.type === 'thinking'), dump(off)).toEqual([])

        oc.setEffort(c.id, 'high')
        mark = proxy.requests.length
        const on = await turn(c, 'what is 23 times 19? answer in one line')
        const onReqs = proxy.requests
            .slice(mark)
            .filter(r => r.path.endsWith('/chat/completions'))
        expect(
            onReqs.some(
                r =>
                    (r.body as { reasoning_effort?: string }).reasoning_effort ===
                    'high',
            ),
            dumpReqs(onReqs),
        ).toBe(true)
        expect(
            on.filter(f => f.type === 'thinking').length,
            dump(on),
        ).toBeGreaterThan(0)
        oc.closeChat(c.id)
    }, TURN_MS * 2 + 60_000)

    test('agent switching: build and plan listed, setAgent plan runs the turn as plan, an unknown name changes nothing', async () => {
        const c = await open(vaultB)
        await c.waitFor(f => f.type === 'agents')
        const agents = c.frames.find(f => f.type === 'agents') as Extract<
            ChatFrame,
            { type: 'agents' }
        >
        const names = agents.agents.map(a => a.value)
        expect(names, JSON.stringify(agents)).toContain('build')
        expect(names).toContain('plan')
        const client = await serverClient()
        oc.setAgent(c.id, 'plan')
        const frames = await turn(c, 'say hi')
        expect(
            ((await client.session(c.sessionId)) as { agent?: string }).agent,
            dump(frames),
        ).toBe('plan')
        oc.setAgent(c.id, 'nope')
        await turn(c, 'say hi again')
        expect(
            ((await client.session(c.sessionId)) as { agent?: string }).agent,
        ).toBe('plan')
        oc.closeChat(c.id)
    }, TURN_MS * 2 + 60_000)

    test('model picking: real labels and groups, the default model, and the detected window', async () => {
        const c = await open(vaultB)
        const models = c.frames.find(f => f.type === 'models') as Extract<
            ChatFrame,
            { type: 'models' }
        >
        const labels = models.models.map(m => m.label)
        expect(labels, JSON.stringify(labels)).toContain('Qwen3.5 9B (local)')
        expect(models.models.some(m => /text-embedding/.test(m.value))).toBe(false)
        const groups = new Map(
            models.models.map(m => [m.group?.id, m.group?.kind] as const),
        )
        expect(groups.get('lmstudio'), JSON.stringify([...groups])).toBe('local')
        expect(groups.get('opencode'), JSON.stringify([...groups])).toBe('zen')

        const client = await serverClient()
        const def = defaultModelFromV2(await client.defaultModel(vaultB))
        const manifest = c.frames.find(f => f.type === 'manifest') as Extract<
            ChatFrame,
            { type: 'manifest' }
        >
        expect(manifest.manifest.model).toBe(def as string)

        const all = (await client.models(vaultB)) as {
            providerID?: string
            id?: string
            limit?: { context?: number }
        }[]
        const qwen = all.find(m => `${m.providerID}/${m.id}` === QWEN)
        expect(qwen, 'lmstudio qwen missing from /api/model').toBeDefined()
        expect(qwen?.limit?.context).toBe(WINDOW)
        oc.closeChat(c.id)
    }, 120_000)
})
