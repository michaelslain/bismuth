// core/test/server.chat-ws.test.ts
// THE FIRST TEST OF THE /chat WEBSOCKET HANDLER.
//
// Before this file, nothing in core/test had ever opened a chat socket — the only WS upgrades any
// test exercised were /terminal (terminal-ws.test.ts) and /ui (server.test.ts's app-control pair).
// So core/src/server.ts's entire chat open/message/close block was untested end to end: the open
// rebind, the nine message verbs, the identity-guarded detach, the `code === 1000` arm, and the
// grace-window teardown. Every chat test that DID exist drove the drivers directly
// (chatProviders/*.test.ts) — below the socket, so none of them could see this layer at all.
//
// THE BUG THIS FILE EXISTS TO CATCH (recently fixed, previously unprotected): a stale socket's
// `close` event arriving AFTER a successful reconnect used to re-detach the LIVE session and arm a
// 30s teardown of a chat the user was actively watching. Reachable in the product by opening one
// chat in two windows and closing one, or by any half-open drop (lid close, wifi loss, NAT timeout)
// where the client's reconnect wins the race against the old socket's close. The fix made
// sessionSink.ts's detachSessionSink RETURN whether it acted, and gated the teardown on that:
//
//     } else if (!sink || chatDetachSink(ws.data.chatId, sink)) {
//       scheduleChatClose(ws.data.chatId, chatGraceMs());
//     }
//
// Deleting that `chatDetachSink(...)` gate — arming the timer unconditionally — left the whole
// 2051-test suite green. `the stale close…` test below is the one that fails when it is removed.
//
// ── WHY THE FAKE ACP AGENT ─────────────────────────────────────────────────────────────────────
// This layer can only be tested with a LIVE chat session behind it, and every chat backend except
// one needs a vendor CLI that may not exist on the machine running this suite. The exception is
// core/test/support/fakeAcpAgent.ts, driven through a stub `cline` binary on PATH — the exact
// pattern core/test/chatProviders/acpFakeAgent.test.ts already uses. It needs no CLI, no model, and
// makes no network call of any kind (there is no LLM on the other end of it, mock or real). The
// REAL, unmodified chatProviders/acp/driver.ts runs against it, dispatched through the REAL router,
// reached over a REAL websocket against a REAL booted Bun.serve — only the agent process is fake.
//
// ── THE 30-SECOND GRACE, AND THE ONE PRODUCTION CHANGE THIS TASK MADE ──────────────────────────
// The close path's whole question is "was a teardown armed, or correctly NOT armed?", and 30s is
// not a wait a test can make. Two routes were considered:
//
//   (1) spyOn(globalThis, "setTimeout") and assert no 30_000 timer was armed. No production change.
//       Rejected: it asserts the SHAPE of a call, not the consequence — a rewrite that armed the
//       teardown by some other means would pass it, and it cannot distinguish "armed on this
//       session" from "armed on any of the dozens of timers a booted server, its PTY pre-warm pool,
//       its file watcher, its 60s gcal ticker and the ACP driver itself are all arming concurrently
//       in the same process". Patching a global that the code under test depends on for correctness
//       is also a live hazard for every other test sharing the process.
//   (2) Make the grace env-tunable, as reattachGraceMs() ALREADY is for terminals eleven lines above
//       it in the same file (BISMUTH_TERMINAL_GRACE_MS, used by two tests in terminal-ws.test.ts).
//
// (2) was taken. It is four lines (`chatGraceMs()` + its call site), it follows an existing in-file
// convention rather than inventing one, and — the deciding reason — it lets these tests assert the
// CONSEQUENCE the bug actually had: the session object is still there, and still serves a turn,
// after a window in which the buggy code would have killed it. That is a strictly stronger signal
// than "no 30_000 timer was armed", and it stays true under any refactor of HOW the teardown is
// scheduled. The cost is a named constant becoming a named function; production behaviour with the
// env var unset is byte-identical (`Number(undefined) || 30_000` === 30_000).
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    test,
} from 'bun:test'
import {
    chmodSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../src/server'
import { CHAT_BACKENDS } from '../src/chatProviders/backends'
import { makeSampleVault } from './helpers'
import { shouldRunSlowTests } from './slowGate'

const FAKE_AGENT_SCRIPT = join(import.meta.dir, 'support', 'fakeAcpAgent.ts')
/** Must match fakeAcpAgent.ts's own FAKE_TURN_TEXT constant. */
const FAKE_TURN_TEXT = 'Hello from the fake ACP agent'

/** Write an executable `cline` shim that execs the fake ACP agent, and return its dir (to be
 *  PREPENDED onto PATH so claudeWhich.ts's whichBinary("cline") resolves it over any real cline
 *  this machine might have). Same shape as acpFakeAgent.ts's own makeStubBinDir. `exec` matters:
 *  it replaces bash with bun, so the driver's kill targets the actual agent process, leaving no
 *  orphaned shell behind. */
function makeStubBinDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-chatws-stub-'))
    const stubPath = join(dir, 'cline')
    writeFileSync(
        stubPath,
        `#!/bin/bash\nexec bun run ${JSON.stringify(FAKE_AGENT_SCRIPT)} "$@"\n`,
    )
    chmodSync(stubPath, 0o755)
    return dir
}

type Frame = { type?: string; [k: string]: unknown }

/** A /chat client socket with its full frame transcript. Every handler is attached SYNCHRONOUSLY
 *  in the constructor call below, before any event can fire, so the transcript is complete from
 *  the first byte — including frames the server pushes from its `open` handler (the rebind's
 *  synthetic `done`, or the reconnect-too-late `error`), which land before the client could
 *  otherwise have subscribed. */
interface ChatSocket {
    ws: WebSocket
    /** Every JSON frame received, in arrival order. Ordering assertions read this directly. */
    frames: Frame[]
    send(obj: unknown): void
    waitFor(
        pred: (f: Frame) => boolean,
        what: string,
        timeoutMs?: number,
    ): Promise<Frame>
    /** Resolves with the close code once the socket is fully closed — awaited before any
     *  post-close assertion, so "the server processed this close" is proven rather than assumed. */
    closed: Promise<number>
    close(code: number, reason: string): Promise<number>
}

async function openChatWs(
    base: string,
    chatId: string,
    opts: { rebind?: boolean } = {},
): Promise<ChatSocket> {
    const q = new URLSearchParams({ chatId })
    if (opts.rebind) q.set('rebind', '1')
    const ws = new WebSocket(`${base}/chat?${q.toString()}`)
    const frames: Frame[] = []
    const waiters: {
        pred: (f: Frame) => boolean
        resolve: (f: Frame) => void
    }[] = []
    let closeCode: number | undefined
    let onClosed: ((code: number) => void) | undefined
    const closed = new Promise<number>(res => {
        if (closeCode !== undefined) res(closeCode)
        else onClosed = res
    })

    ws.onmessage = ev => {
        let f: Frame
        try {
            f = JSON.parse(ev.data as string) as Frame
        } catch {
            return // the chat protocol is text JSON only; a non-JSON frame is not ours
        }
        frames.push(f)
        for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].pred(f)) {
                waiters[i].resolve(f)
                waiters.splice(i, 1)
            }
        }
    }
    ws.onclose = ev => {
        closeCode = ev.code
        onClosed?.(ev.code)
    }

    await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () =>
            reject(new Error(`chat ws failed to open for chatId=${chatId}`))
    })

    return {
        ws,
        frames,
        send: (obj: unknown) => ws.send(JSON.stringify(obj)),
        waitFor: (pred, what, timeoutMs = 15_000) =>
            new Promise<Frame>((resolve, reject) => {
                const hit = frames.find(pred)
                if (hit) return resolve(hit)
                const t = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `timeout waiting for ${what}; frames seen: ${JSON.stringify(frames.map(f => f.type))}`,
                            ),
                        ),
                    timeoutMs,
                )
                waiters.push({
                    pred,
                    resolve: f => {
                        clearTimeout(t)
                        resolve(f)
                    },
                })
            }),
        closed,
        close: (code: number, reason: string) => {
            ws.close(code, reason)
            return closed
        },
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** One `{method, params}` line per inbound JSON-RPC request the fake agent received — see
 *  fakeAcpAgent.ts's `echo()`. Tolerant of a missing file (not written yet) and of a torn read
 *  (polled while the agent may be mid-append), for the same reasons acpFakeAgent.test.ts's copy is. */
function readEchoLines(path: string): { method: string; params: unknown }[] {
    let text: string
    try {
        text = readFileSync(path, 'utf8')
    } catch {
        return []
    }
    const out: { method: string; params: unknown }[] = []
    for (const l of text
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)) {
        try {
            out.push(JSON.parse(l) as { method: string; params: unknown })
        } catch {
            /* torn line — retried by the caller's poll */
        }
    }
    return out
}

async function waitForCondition(
    check: () => boolean,
    timeoutMs: number,
    description: string,
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (check()) return
        await sleep(50)
    }
    throw new Error(`timeout waiting for: ${description}`)
}

// Spawns real processes/sockets, so it is gated as a SLOW suite (see slowGate.ts): the
// pre-commit gate skips it for latency; pre-push and CI still run it in full.
const describeOrSkipSlow = shouldRunSlowTests(process.env)
    ? describe
    : describe.skip

describeOrSkipSlow(
    'the /chat websocket handler (fake ACP agent — no CLI, no model, no network)',
    () => {
        let stubDir: string
        let savedPath: string | undefined
        let savedShape: string | undefined
        let savedGrace: string | undefined
        let savedEchoFile: string | undefined
        let echoDir: string | undefined
        /** Chat ids whose sessions must be torn down after the test, whatever it asserted or threw —
         *  each one owns a live fake-agent subprocess. */
        const chatIds: string[] = []
        /** Servers booted by the current test, stopped in afterEach even if the test throws mid-way. */
        const servers: { stop(closeActive?: boolean): void }[] = []

        beforeEach(() => {
            // Snapshot env BEFORE anything that can throw (makeStubBinDir does fs work): on a throw here
            // savedPath would stay undefined and afterEach's restore would strip PATH from the shared
            // `bun test` process for every later test that spawns a subprocess. Same ordering fix
            // acpFakeAgent.test.ts records for itself.
            savedPath = process.env.PATH
            savedShape = process.env.FAKE_ACP_MODEL_SHAPE
            savedGrace = process.env.BISMUTH_CHAT_GRACE_MS
            savedEchoFile = process.env.FAKE_ACP_ECHO_FILE
            echoDir = undefined
            stubDir = makeStubBinDir()
            process.env.PATH = `${stubDir}:${savedPath ?? ''}`
            // The fake agent's OLD model shape (models.availableModels/currentModelId). Either shape works
            // for everything this file asserts — the chosen one just has to be pinned so the session
            // handshake is deterministic rather than inheriting whatever a previous file left set.
            process.env.FAKE_ACP_MODEL_SHAPE = 'old'
        })

        afterEach(() => {
            for (const s of servers.splice(0)) {
                try {
                    s.stop(true)
                } catch {
                    /* already stopped */
                }
            }
            for (const id of chatIds.splice(0))
                CHAT_BACKENDS.cline.closeChat(id)
            if (savedPath === undefined) delete process.env.PATH
            else process.env.PATH = savedPath
            if (savedShape === undefined)
                delete process.env.FAKE_ACP_MODEL_SHAPE
            else process.env.FAKE_ACP_MODEL_SHAPE = savedShape
            if (savedGrace === undefined)
                delete process.env.BISMUTH_CHAT_GRACE_MS
            else process.env.BISMUTH_CHAT_GRACE_MS = savedGrace
            if (savedEchoFile === undefined)
                delete process.env.FAKE_ACP_ECHO_FILE
            else process.env.FAKE_ACP_ECHO_FILE = savedEchoFile
            rmSync(stubDir, { recursive: true, force: true })
            if (echoDir) rmSync(echoDir, { recursive: true, force: true })
        })

        afterAll(() => {
            // Belt-and-suspenders: a thrown assertion mid-test must never leave a later, unrelated test file
            // in this same process pointed at a stub PATH or a 1-second chat grace. afterEach already does
            // this; both branches are repeated here so a failure inside afterEach itself can't leak either.
            const restore = (k: string, v: string | undefined) => {
                if (v === undefined) delete process.env[k]
                else process.env[k] = v
            }
            restore('PATH', savedPath)
            restore('FAKE_ACP_MODEL_SHAPE', savedShape)
            restore('BISMUTH_CHAT_GRACE_MS', savedGrace)
            restore('FAKE_ACP_ECHO_FILE', savedEchoFile)
        })

        /** Boot a server on a throwaway vault, registered for teardown. */
        async function boot(): Promise<{ base: string; wsBase: string }> {
            const { vault, memory } = await makeSampleVault()
            const server = createServer({ vault, memory, port: 0 })
            servers.push(server)
            return {
                base: `http://localhost:${server.port}`,
                wsBase: `ws://localhost:${server.port}`,
            }
        }

        /** Open a chat socket, drive the `{type:"open"}` verb, and wait until the session genuinely
         *  EXISTS — proven twice, independently: the `session` frame came back over the wire, AND the
         *  driver's own registry reports it. Every test below builds on this, so a silently-failed
         *  connect or a never-spawned agent can never leave a later assertion passing on an empty
         *  transcript. */
        async function openLiveChat(
            wsBase: string,
            chatId: string,
        ): Promise<ChatSocket> {
            chatIds.push(chatId)
            const sock = await openChatWs(wsBase, chatId)
            sock.send({ type: 'open', provider: 'cline', computerUse: false })
            const sessionFrame = await sock.waitFor(
                f => f.type === 'session',
                'the session frame from the fake ACP agent',
            )
            expect(sessionFrame.sessionId).toStartWith('fake-session-old-')
            expect(CHAT_BACKENDS.cline.hasSession(chatId)).toBe(true)
            return sock
        }

        test("a STALE socket's close after a reconnect must NOT tear down the live session (the identity-guard regression)", async () => {
            // 1s grace: long enough that nothing races it, short enough that this test can outwait it
            // three times over. Under the sabotage (teardown armed unconditionally on the stale close),
            // the session dies 1s after ws1 closes and every assertion after that point fails.
            process.env.BISMUTH_CHAT_GRACE_MS = '1000'
            const { wsBase } = await boot()
            const chatId = `chat-ws-stale-${Date.now()}`

            // ── ws1: the original window. Session exists (proven by openLiveChat's two assertions).
            const ws1 = await openLiveChat(wsBase, chatId)

            // ── ws2: the SAME chat opened in a second window / reconnected. Its `open` handler rebinds
            // the live session's sink to ws2. Proven positively, not assumed: rebindSessionSink pushes a
            // synthetic `done` whenever no turn is in flight, so a `done` arriving on a socket that has
            // sent NOTHING is itself the evidence the rebind ran. A FAILED rebind (no session found)
            // would instead push {type:"error", code:"exit"} — asserted absent, so "no frame at all"
            // cannot be mistaken for success either.
            const ws2 = await openChatWs(wsBase, chatId, { rebind: true })
            await ws2.waitFor(
                f => f.type === 'done',
                "the rebind's synthetic done frame on ws2",
            )
            // SETTLE before counting. A snapshot taken the instant the first `done` lands cannot see a
            // SECOND one still in flight — found by sabotage: a rebind pushing two synthetic dones slid
            // straight past the bare count below, which then "passed" while claiming exactly one had
            // arrived. Every frame-count assertion in this file waits out this window first.
            await sleep(300)
            expect(ws2.frames.filter(f => f.type === 'error').length).toBe(0)
            expect(ws2.frames.filter(f => f.type === 'done').length).toBe(1)

            // ── The stale close. ws1 is the OLD socket; its close lands after ws2 already owns the sink.
            // Code 4001 (not 1000) is the abnormal-close path — the one that detaches and arms a grace
            // teardown. Awaiting the close handshake proves the SERVER processed it; without that, every
            // "the session survived" assertion below could pass on a close that never arrived.
            const code = await ws1.close(4001, 'simulated half-open drop')
            expect(code).toBe(4001)

            // Outwait the grace 2.5x over. Under the sabotage the timer armed by that stale close fires
            // in here and kills a session nobody asked to close.
            await sleep(2500)

            // THE REGRESSION ASSERTION: the live session is still registered.
            expect(CHAT_BACKENDS.cline.hasSession(chatId)).toBe(true)

            // …and still SERVING. The registry entry surviving is necessary but not sufficient — a turn
            // must actually round-trip to the fake agent and back on ws2's own sink, which is what the
            // user watching that second window would experience.
            ws2.send({
                type: 'user',
                text: 'still there?',
                provider: 'cline',
                computerUse: false,
            })
            const assistant = await ws2.waitFor(
                f => f.type === 'assistant-text',
                "the turn's assistant-text on ws2",
            )
            expect(assistant.text).toBe(FAKE_TURN_TEXT)
            await waitForCondition(
                () => ws2.frames.filter(f => f.type === 'done').length >= 2,
                15_000,
                "the second done frame on ws2 (rebind's synthetic done, then this turn's own)",
            )
            await sleep(400) // settle — see the rebind count's comment above
            expect(ws2.frames.filter(f => f.type === 'done').length).toBe(2)
            // Ordering, not mere presence: the rebind's synthetic done came first, the turn's text after
            // it, and the turn's own done last. A transcript that merely CONTAINS these frames in any
            // order would not describe the sequence a reconnecting client actually depends on.
            const types = ws2.frames.map(f => f.type)
            expect(types.indexOf('done')).toBe(0)
            expect(types.indexOf('assistant-text')).toBeGreaterThan(0)
            expect(types.lastIndexOf('done')).toBeGreaterThan(
                types.indexOf('assistant-text'),
            )

            // ── The counterpart: closing the LAST socket abnormally MUST arm the teardown. Without this
            // half, a "gate" that simply never armed anything would also pass everything above.
            expect(CHAT_BACKENDS.cline.hasSession(chatId)).toBe(true) // precondition, restated after the turn
            const code2 = await ws2.close(4002, 'drop')
            expect(code2).toBe(4002)
            await sleep(200) // comfortably inside the 1s grace
            expect(CHAT_BACKENDS.cline.hasSession(chatId)).toBe(true)
            // Poll for the teardown rather than sleeping a fixed margin past it — same shape as the
            // abnormal-close test below, and it removes this file's only wait whose correctness depended
            // on a margin rather than on the event itself.
            await waitForCondition(
                () => CHAT_BACKENDS.cline.hasSession(chatId) === false,
                5_000,
                "the grace teardown to fire after the LAST socket's abnormal close",
            )
            expect(CHAT_BACKENDS.cline.hasSession(chatId)).toBe(false)
        }, 45_000)

        test('a CLEAN close (1000) tears the chat session down immediately — it does not take the grace path', async () => {
            // A long grace on purpose: if the clean-close arm ever fell through to scheduleChatClose, the
            // session would still be alive at the check below, and this test would fail. With the
            // `code === 1000` arm intact, closeChat runs synchronously in the close handler.
            const graceMs = 10_000
            process.env.BISMUTH_CHAT_GRACE_MS = String(graceMs)
            const { wsBase } = await boot()
            const chatId = `chat-ws-clean-${Date.now()}`

            const ws = await openLiveChat(wsBase, chatId)
            const t0 = Date.now()
            const code = await ws.close(1000, 'tab closed')
            expect(code).toBe(1000)

            // No sleeping past anything: closeChat is synchronous inside the close handler, so the
            // registry is already empty once the handshake completes. The 2s budget covers only the gap
            // between the server processing the frame and the client observing the handshake.
            await waitForCondition(
                () => CHAT_BACKENDS.cline.hasSession(chatId) === false,
                2_000,
                'the session to be gone immediately after a clean (1000) close',
            )
            // Restated as a hard assertion so a future edit to waitForCondition cannot soften this.
            expect(CHAT_BACKENDS.cline.hasSession(chatId)).toBe(false)
            // What actually distinguishes the clean-close arm from a grace timer that happened to fire is
            // that the teardown was observed in FAR less time than the grace — so measure that, rather
            // than re-reading the env var this test set itself twenty lines up (which production only ever
            // reads, and which would therefore pass even if the code did nothing at all — a review finding
            // on this file's first version, and a defect that a flip-the-expected-literal sabotage
            // structurally cannot detect, because flipping a self-referential expectation always fails).
            // This couples the two numbers: raise the observation budget above `graceMs` and this fails,
            // which is exactly the edit that would quietly let a grace timer satisfy the test.
            const elapsedMs = Date.now() - t0
            expect(elapsedMs).toBeLessThan(graceMs)
        }, 30_000)

        test('an ABNORMAL close arms the grace teardown; reconnecting with rebind=1 after it fired gets the explicit exit frame', async () => {
            process.env.BISMUTH_CHAT_GRACE_MS = '500'
            const { wsBase } = await boot()
            const chatId = `chat-ws-expired-${Date.now()}`

            const ws1 = await openLiveChat(wsBase, chatId)
            const code = await ws1.close(4001, 'network drop')
            expect(code).toBe(4001)

            // Inside the grace the session is still there — this is the window a reconnect would use.
            await sleep(100)
            expect(CHAT_BACKENDS.cline.hasSession(chatId)).toBe(true)
            // Past it, the armed teardown has fired.
            await waitForCondition(
                () => CHAT_BACKENDS.cline.hasSession(chatId) === false,
                5_000,
                'the grace teardown to fire after an abnormal close',
            )
            expect(CHAT_BACKENDS.cline.hasSession(chatId)).toBe(false)

            // Now reconnect TOO LATE with rebind=1. The open handler must say so explicitly rather than
            // silently starting fresh and leaving a mid-turn UI wedged forever.
            const ws2 = await openChatWs(wsBase, chatId, { rebind: true })
            const err = await ws2.waitFor(
                f => f.type === 'error',
                'the reconnect-too-late error frame',
            )
            expect(err.code).toBe('exit')
            expect(err.message).toContain('session ended while disconnected')
            await sleep(300) // settle before counting — see the rebind count's comment in the test above
            // And no synthetic `done` — there was nothing to rebind, so the rebind path never ran.
            expect(ws2.frames.filter(f => f.type === 'done').length).toBe(0)
            expect(ws2.frames.filter(f => f.type === 'error').length).toBe(1)
            await ws2.close(1000, 'done')
        }, 30_000)

        test("message verbs dispatch over the socket: {type:'set_model'} reaches the agent's wire method", async () => {
            // The message handler's job is parse-and-dispatch, and nothing above the driver level had ever
            // proven a verb makes it from a WS text frame to the agent. `set_model` is the cheapest verb
            // with a directly observable wire consequence: FAKE_ACP_ECHO_FILE records every JSON-RPC
            // request the fake agent receives, so this asserts the RIGHT method arrived with the RIGHT
            // payload — not merely that sending the frame threw nothing (which, since chatSetModel is
            // fire-and-forget with a swallowed catch, could not fail for any input, including a typo).
            process.env.BISMUTH_CHAT_GRACE_MS = '1000'
            echoDir = mkdtempSync(join(tmpdir(), 'bismuth-chatws-echo-'))
            const echoFile = join(echoDir, 'echo.jsonl')
            process.env.FAKE_ACP_ECHO_FILE = echoFile

            const { wsBase } = await boot()
            const chatId = `chat-ws-verbs-${Date.now()}`
            const ws = await openLiveChat(wsBase, chatId)

            // The session handshake itself is already on the wire — a baseline that proves the echo file
            // is genuinely being written, so a later "the file has no session/set_model line" failure
            // means the verb didn't dispatch, not that echoing was broken.
            await waitForCondition(
                () =>
                    readEchoLines(echoFile).some(
                        l => l.method === 'session/new',
                    ),
                10_000,
                'the session/new handshake in the echo file',
            )
            expect(
                readEchoLines(echoFile).some(
                    l => l.method === 'session/set_model',
                ),
            ).toBe(false)

            ws.send({ type: 'set_model', model: 'fake-model-b' })
            await waitForCondition(
                () =>
                    readEchoLines(echoFile).some(
                        l => l.method === 'session/set_model',
                    ),
                10_000,
                "a session/set_model echo line (the OLD model shape's dispatch target)",
            )
            // Settle before counting — the same defect the frame counts in the tests above have: reading
            // the echo file the instant the first matching line appears cannot see a SECOND dispatch
            // still in flight, so `toBe(1)` would report "exactly one" without knowing it. Found by
            // sabotage (sending set_model twice slipped past the bare snapshot).
            await sleep(600)
            const calls = readEchoLines(echoFile).filter(
                l => l.method === 'session/set_model',
            )
            expect(calls.length).toBe(1)
            expect((calls[0].params as { modelId?: string }).modelId).toBe(
                'fake-model-b',
            )
            // A belt on top of the two assertions above, which already prove the OLD shape's dispatch
            // target was reached with the right payload: the NEW shape's target must not ALSO have fired.
            // Kept because it costs nothing, but it is corroboration — the discriminating evidence for the
            // shape branch is the positive `session/set_model` assertion, not this absence.
            expect(
                readEchoLines(echoFile).some(
                    l => l.method === 'session/set_config_option',
                ),
            ).toBe(false)

            // And the `user` verb still round-trips after it.
            ws.send({
                type: 'user',
                text: 'hi',
                provider: 'cline',
                computerUse: false,
            })
            const assistant = await ws.waitFor(
                f => f.type === 'assistant-text',
                'the assistant-text after set_model',
            )
            expect(assistant.text).toBe(FAKE_TURN_TEXT)
            await ws.close(1000, 'done')
        }, 45_000)
    },
)
