// core/test/chatProviders/acpQueueFakeAgent.test.ts
// Task 10 of the agent-integration-completion plan: the turn queue — what happens when a user sends
// a second (and third) message while the first turn is still in flight, offline, through the REAL,
// unmodified chatProviders/acp/driver.ts.
//
// WHY THIS FILE EXISTS. `runOrQueue` (driver.ts) exists in three chat drivers with the identical
// shape (ACP here; also codex/driver.ts and chat.ts's own Claude session) and had NO offline test on
// any of them before this task: does a message sent while `turnActive` really get queued instead of
// dispatched immediately, and does the driver drain that queue in the order the user actually sent
// the messages — not merely "does everything eventually finish" (a broken queue that runs things in
// the wrong order, or that dispatches a queued turn too early, still produces the right FRAME COUNT
// if nothing asserts on order or on wire traffic while a turn is held open).
//
// THE MECHANISM: ../support/fakeAcpAgent.ts's "queue" hold mode (`FAKE_ACP_PROMPT_HOLD=queue`, added
// by this task — see that file's header, "QUEUE-HOLD MODE"). Every `session/prompt` this fake
// receives is held open for `FAKE_ACP_QUEUE_HOLD_MS` before it settles itself on a plain internal
// timer — no permission round-trip, no external release signal needed or possible. This is
// deliberately simpler than the existing "permission" hold mode
// (acpPermissionFakeAgent.test.ts/acpAbortFakeAgent.test.ts) because a turn-queue test's own subject
// is entirely on the CLIENT side (driver.ts's `s.queue`/`runOrQueue`), not anything the agent does. A
// held turn echoes the ORIGINAL prompt text it received back in its own settling
// `agent_message_chunk`, which — together with the echo file's own recording of every
// `session/prompt` request's raw params — gives TWO independent proof channels for both submission
// order (what the driver actually put ON THE WIRE, and when) and settle order (what the driver's OWN
// frame stream reports, and in what sequence).
//
// NON-VACUOUSNESS, stated precisely (this project's recurring defect is a check that stays green even
// when the thing it claims to prove never happened):
//   - The first test asserts, WHILE the first turn is still held (well within its hold window,
//     checked against real elapsed time, not against ordering of ChatFrames alone), that the echo
//     file holds EXACTLY ONE `session/prompt` line. A driver that bypassed `runOrQueue`'s
//     `s.turnActive` gate entirely (sent BOTH prompts immediately) would show TWO lines at that same
//     checkpoint — this is the assertion that actually proves the queue is doing something, not
//     merely that two messages eventually produce two `done` frames.
//   - The second test sends a THIRD message while the first is held (two turns end up queued
//     simultaneously) and asserts the three `session/prompt` requests' own `prompt` text landed on
//     the wire in EXACT submission order (alpha, beta, gamma) — not just that three `done` frames
//     arrived. A queue that dequeues LIFO (or otherwise reorders — e.g. `Array.prototype.pop()`
//     swapped in for `.shift()` in driver.ts's `runTurn`) is indistinguishable from a correct one
//     with only ONE item ever queued (the first test, with only a second message, has nothing to
//     reorder against), which is why this second test needs three messages, not two.
//   - Every `session/prompt`'s own `sessionId` is compared against an INDEPENDENTLY-obtained value —
//     the ACP session id read off the driver's own `"session"` ChatFrame (emitted once, at
//     `openSession` time, before either test sends a single message) — never against each OTHER.
//     `s.sessionId` (driver.ts:578) is assigned exactly once and never reassigned, so comparing the
//     wire values only to each other is a tautology once `prompts.length` is already pinned — it
//     would stay green even if driver.ts sent the chat id (`s.id`) instead of the real ACP session id
//     (`s.sessionId`) in `session/prompt`. Anchoring to the independently-read session id above
//     closes that gap.
//
// WHAT EACH ASSERTION PROTECTS, stated as a property rather than an audit trail (so this stays
// accurate as driver.ts changes, instead of narrating a one-time verification run):
//   1. The FIRST test's "exactly one `session/prompt` line while held" assertion protects
//      `runOrQueue`'s `s.turnActive` gate — if a queued turn were dispatched immediately instead of
//      waiting, this checkpoint would see two `session/prompt` lines instead of one.
//   2. The SECOND test's submission-order assertion protects `runTurn`'s queue drain order (FIFO via
//      `s.queue.shift()`) — if the drain became LIFO (or otherwise reordered), the three
//      `session/prompt` requests' `prompt` text would land on the wire out of submission order
//      (e.g. beta/gamma swapped), independent of frame counts, which stay correct either way.
//   3. The `sessionId` assertion in BOTH tests protects `runTurn` sending the real ACP session id
//      (`s.sessionId`) on every `session/prompt` call, not the chat id (`s.id`) — the two are never
//      equal in this test's setup, so a swap is caught directly rather than passing by coincidence.
//
// STUB-BINARY PATTERN: identical to every other fakeAcpAgent.ts-driven test file — write an
// executable stub named "cline" into a throwaway temp dir, prepend it onto PATH so
// core/src/claudeWhich.ts's whichBinary("cline") resolves the stub, then drive the REAL, unmodified
// chatProviders/acp/driver.ts via CHAT_BACKENDS.cline exactly as production does. Zero network of any
// kind, zero CLI dependency, zero account contact. Orphan-freedom is verified BY PID (never a
// `pgrep -f` pattern match) via ../support/acpFakeAgentProcess.ts's shared helper — see that file's
// own header for why this is a shared module rather than yet another inline copy.
//
// No production files were changed for this task — only the test-support fake agent gained the new
// "queue" hold mode (additive, opt-in via FAKE_ACP_PROMPT_HOLD=queue; every pre-existing consumer of
// that file leaves the var unset or set to "permission" and is byte-for-byte unaffected) — plus the
// pid-teardown helper extracted to ../support/acpFakeAgentProcess.ts, shared with (and retrofitted
// onto) acpAbortFakeAgent.test.ts.
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    test,
} from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatFrame } from '../../src/chat'
import { CHAT_BACKENDS } from '../../src/chatProviders/backends'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import {
    makeAcpFakeAgentStubDir,
    pidAlive,
    waitForPidFile,
    waitProcessesGone,
} from '../support/acpFakeAgentProcess'
import { shouldRunSlowTests } from '../slowGate'

const FAKE_AGENT_SCRIPT = join(
    import.meta.dir,
    '..',
    'support',
    'fakeAcpAgent.ts',
)

// Must match ../support/fakeAcpAgent.ts's own constant — duplicated rather than imported because the
// fake is a standalone script executed as a subprocess, not a module this test links against (the
// same convention every sibling fake-agent test file already uses).
const FAKE_QUEUE_TURN_PREFIX = 'fake-acp queued-turn echo: '

/** How long the fake holds each `session/prompt` open before auto-settling — see fakeAcpAgent.ts's
 *  own QUEUE_HOLD_MS doc comment. Pinned explicitly here (rather than relying on the fake's own
 *  default) so this file's timing assumptions never silently drift if that default ever changes.
 *  2000ms, not a smaller value: unlike the "permission" hold mode's tests (whose hold is UNBOUNDED —
 *  nothing settles it without an explicit reply, so their own PARKED_OBSERVATION_MS margin really is
 *  "however long we're willing to wait"), this hold is a FINITE timer that fires on its own. The
 *  window below (`HELD_OBSERVATION_MS`) must stay comfortably LESS than this value, not merely more
 *  than typical IPC latency — a smaller `QUEUE_HOLD_MS` (this file previously used 400ms) leaves too
 *  little slack for a scheduler overrun under full-suite load to flip "still held" into "already
 *  settled", which would fail `toBe(1)` for a reason that has nothing to do with the queue. */
const QUEUE_HOLD_MS = 2_000

/** How long after sending the second (and third) message to wait before asserting the first turn is
 *  still held. Comfortably less than QUEUE_HOLD_MS (leaves ~1700ms of slack — enough that a scheduler
 *  overrun under full-suite load can't flip this check) and comfortably more than a same-machine
 *  spawn→pipe→readline round trip (so "still held" is a real observation, not a coincidence of
 *  scheduling). See QUEUE_HOLD_MS's own doc comment for why this is NOT the same margin shape as the
 *  permission-mode tests' PARKED_OBSERVATION_MS. */
const HELD_OBSERVATION_MS = 300

interface EchoLine {
    method?: string
    params?: unknown
}

/** Same tolerance contract as every sibling fake-agent test file: a missing file is an empty array
 *  (polled before the fake has written anything), and a torn last line (read mid-appendFileSync) is
 *  dropped so the CURRENT poll fails and is retried, rather than throwing a spurious JSON.parse error
 *  that would fail the whole test. */
function readEchoLines(path: string): EchoLine[] {
    let text: string
    try {
        text = readFileSync(path, 'utf8')
    } catch {
        return []
    }
    const out: EchoLine[] = []
    for (const l of text
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)) {
        try {
            out.push(JSON.parse(l) as EchoLine)
        } catch {
            /* torn/partially-written line — see this function's doc comment */
        }
    }
    return out
}

/** Pull the plain text out of a `session/prompt` request's own `params.prompt` — the same shape
 *  driver.ts's `runTurn` builds (`[{type:"text", text}]`). Duplicated (not imported) from
 *  fakeAcpAgent.ts's own `extractPromptText` for the same reason as every other constant/helper this
 *  file mirrors: the fake is a standalone subprocess script, not a module this test links against. */
function promptText(params: unknown): string {
    const p =
        params && typeof params === 'object'
            ? (params as Record<string, unknown>)
            : {}
    const blocks = Array.isArray(p.prompt) ? p.prompt : []
    const first = blocks.find(
        b =>
            b &&
            typeof b === 'object' &&
            (b as Record<string, unknown>).type === 'text',
    ) as Record<string, unknown> | undefined
    return typeof first?.text === 'string' ? first.text : ''
}

/** Pull `sessionId` out of a `session/prompt` request's own params — the value under test in every
 *  sessionId assertion below. */
function promptSessionId(params: unknown): string | undefined {
    const p =
        params && typeof params === 'object'
            ? (params as Record<string, unknown>)
            : {}
    return typeof p.sessionId === 'string' ? p.sessionId : undefined
}

async function waitForCondition(
    check: () => boolean,
    timeoutMs: number,
    description: string,
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (check()) return
        await new Promise(r => setTimeout(r, 50))
    }
    throw new Error(`timeout waiting for: ${description}`)
}

// Spawns real processes/sockets, so it is gated as a SLOW suite (see slowGate.ts): the
// pre-commit gate skips it for latency; pre-push and CI still run it in full.
const describeOrSkipSlow = shouldRunSlowTests(process.env)
    ? describe
    : describe.skip

describeOrSkipSlow(
    "the ACP driver's turn queue: a message sent while the previous turn is in flight, against a fake agent that holds every turn open (zero network, zero CLI dependency)",
    () => {
        // `| undefined` with explicit resets in beforeEach, matching every sibling fake-agent test file's
        // documented shape: if a throwing call in the FIRST beforeEach fails partway, afterEach must not be
        // handed `undefined` where it expects a string (rmSync's `force:true` swallows ENOENT, not an
        // ERR_INVALID_ARG_TYPE from a wrong argument type) — a bug this harness has shipped before.
        let stubDir: string | undefined
        let echoDir: string | undefined
        let pidDir: string | undefined
        let echoFile: string
        let pidFile: string
        const savedEnv: Record<string, string | undefined> = {}
        const ENV_KEYS = [
            'PATH',
            'FAKE_ACP_PROMPT_HOLD',
            'FAKE_ACP_QUEUE_HOLD_MS',
            'FAKE_ACP_PERMISSION_OPTIONS',
            'FAKE_ACP_ECHO_FILE',
            'FAKE_ACP_MODEL_SHAPE',
            'FAKE_ACP_AUTH_GATE',
            'FAKE_ACP_CLINE_AUTHED',
        ] as const
        const chatIds: string[] = []
        // Pids this test itself caused to exist (captured via waitForPidFile once a session is confirmed
        // open), verified gone in afterEach — see ../support/acpFakeAgentProcess.ts's header for why a
        // synchronous afterEach that only calls closeChat() is not sufficient on its own.
        const spawnedPids: number[] = []

        function restoreEnv(): void {
            for (const k of ENV_KEYS) {
                if (savedEnv[k] === undefined) delete process.env[k]
                else process.env[k] = savedEnv[k]
            }
        }

        beforeEach(() => {
            // Snapshot env BEFORE anything that can throw — see every sibling fake-agent test file's
            // identical ordering discipline (a first-beforeEach throw must never leave a later test's PATH
            // stripped by afterEach's restore).
            for (const k of ENV_KEYS) savedEnv[k] = process.env[k]

            stubDir = undefined
            echoDir = undefined
            pidDir = undefined
            pidDir = mkdtempSync(join(tmpdir(), 'bismuth-acp-queue-pid-'))
            pidFile = join(pidDir, 'agent.pid')
            stubDir = makeAcpFakeAgentStubDir(
                'bismuth-acp-queue-stub-',
                'cline',
                FAKE_AGENT_SCRIPT,
                pidFile,
            )
            echoDir = mkdtempSync(join(tmpdir(), 'bismuth-acp-queue-echo-'))
            echoFile = join(echoDir, 'echo.jsonl')

            // Prepended, not appended: must win over any real `cline` installed elsewhere on PATH.
            process.env.PATH = `${stubDir}:${savedEnv.PATH ?? ''}`
            process.env.FAKE_ACP_ECHO_FILE = echoFile
            process.env.FAKE_ACP_PROMPT_HOLD = 'queue'
            process.env.FAKE_ACP_QUEUE_HOLD_MS = String(QUEUE_HOLD_MS)
            // Hermetic against ambient env — the same finding every sibling fake-agent test file's beforeEach
            // documents: a stray FAKE_ACP_AUTH_GATE (or a leftover permission-options var) exported in the
            // shell running `bun test` must not leak into this file's own tests.
            process.env.FAKE_ACP_MODEL_SHAPE = 'new'
            delete process.env.FAKE_ACP_AUTH_GATE
            delete process.env.FAKE_ACP_CLINE_AUTHED
            delete process.env.FAKE_ACP_PERMISSION_OPTIONS
        })

        afterEach(async () => {
            // Env restore FIRST: a throw below must never skip restoration and leave a later test (in this
            // file or a later file in this same process) pointed at a stub PATH.
            restoreEnv()

            // Temp-dir cleanup lives in `finally`, not merely "after" the close/poll calls: closeChat() and
            // waitProcessesGone() are both non-throwing as of this writing (closeChat's own
            // killWithEscalation wraps every proc.kill() in try/catch; waitProcessesGone never throws by its
            // own doc comment/contract), so this is defense-in-depth against a FUTURE regression in either —
            // not a currently-observed gap — but it costs nothing and closes the only ordering hole that is
            // even theoretically ours to close: a throw between "session close requested" and "temp dirs
            // removed" must never skip the removal. What this can NEVER cover: the whole process (this
            // `bun test` run) being killed with SIGKILL — no `finally` runs when there is no process left to
            // run it in; that half is categorically unfixable from inside this file.
            let stillAlive: number[] = []
            try {
                for (const id of chatIds.splice(0))
                    CHAT_BACKENDS.cline.closeChat(id)

                // closeChat() only SENDS a signal (SIGTERM, escalating to SIGKILL after driver.ts's
                // KILL_ESCALATION_GRACE_MS if ignored) — it does not wait for the process to exit. Poll by
                // OWNED pid (never a `pgrep -f` pattern match) via the shared helper — see
                // acpFakeAgentProcess.ts's own header.
                stillAlive = await waitProcessesGone(spawnedPids.splice(0))
            } finally {
                if (stubDir) rmSync(stubDir, { recursive: true, force: true })
                if (echoDir) rmSync(echoDir, { recursive: true, force: true })
                if (pidDir) rmSync(pidDir, { recursive: true, force: true })
            }

            if (stillAlive.length > 0) {
                throw new Error(
                    `acpQueueFakeAgent.test: fake-agent pid(s) ${stillAlive.join(', ')} still alive after closeChat — a real leak.`,
                )
            }
        }, 15_000)

        afterAll(() => {
            // Belt-and-suspenders: a thrown assertion mid-test must never leave a LATER, unrelated test file
            // in this same `bun test` process pointed at a stub PATH or a stuck FAKE_ACP_* var.
            restoreEnv()
        })

        /**
         * Pre-create the session and wait for the handshake+session/new round trip to finish (the
         * "session" frame) before this file's own turn-QUEUE scenario begins. Without this, the very
         * first `sendMessage` call on a brand-new chat races its OWN async session creation — a real gap
         * driver.ts's own "new session" branch documents itself (see its "PRE-EXISTING GAP" comment,
         * driver.ts:643) — which would make a bare
         * two-`sendMessage`-calls-back-to-back test flaky for a reason that has nothing to do with the
         * queue this task is testing. Pre-creating the session and waiting for confirmation that it is
         * open (turnActive: false, sessionId assigned) makes the FIRST `sendMessage` call below take the
         * "existing session" branch, whose own path to `runOrQueue` is fully synchronous up to and
         * including `session/prompt` hitting the wire — the property this file's assertions depend on.
         *
         * Also captures the fake agent's own pid (for teardown verification) and returns the ACP
         * `sessionId` the driver reports — the INDEPENDENTLY-obtained expected value every sessionId
         * assertion below compares against, rather than comparing wire values only to each other (a
         * tautology given `s.sessionId` is assigned exactly once — see this file's header).
         */
        async function openReadySession(
            chatId: string,
            sink: (f: ChatFrame) => void,
            waitFor: (
                match: (f: ChatFrame) => boolean,
                timeoutMs?: number,
            ) => Promise<ChatFrame>,
        ): Promise<string> {
            CHAT_BACKENDS.cline.openSession({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
            })
            const sessionFrame = await waitFor(f => f.type === 'session')
            if (sessionFrame.type !== 'session')
                throw new Error(
                    `expected a "session" frame, got ${sessionFrame.type}`,
                )

            const pid = await waitForPidFile(pidFile)
            spawnedPids.push(pid)
            expect(pidAlive(pid)).toBe(true) // sanity: alive now, so "not alive after teardown" means something

            return sessionFrame.sessionId
        }

        test('two sendMessage calls back to back: the second is queued (not dispatched) while the first turn is in flight, and runs after it settles — in submission order, on the same ACP session', async () => {
            const chatId = 'acp-queue-two-' + Date.now()
            chatIds.push(chatId)
            const { sink, frames, waitFor } = makeChatFrameCollector(20_000)

            const expectedSessionId = await openReadySession(
                chatId,
                sink,
                waitFor,
            )

            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'first message',
            })
            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'second message',
            })

            // THE assertion this test exists for (see this file's header): while turn 1 is still
            // genuinely held, the second message must NOT have reached the wire at all — it is sitting in
            // the driver's own queue. A driver that bypassed the turnActive gate would show 2 lines here.
            await new Promise(r => setTimeout(r, HELD_OBSERVATION_MS))
            expect(
                readEchoLines(echoFile).filter(
                    l => l.method === 'session/prompt',
                ).length,
            ).toBe(1)
            expect(frames.filter(f => f.type === 'done').length).toBe(0)

            await waitForCondition(
                () => frames.filter(f => f.type === 'done').length === 2,
                QUEUE_HOLD_MS * 2 + 8_000,
                '2 done frames (both turns settled)',
            )

            const prompts = readEchoLines(echoFile).filter(
                l => l.method === 'session/prompt',
            )
            expect(prompts.length).toBe(2)
            // Submission order, not mere presence — see this file's header.
            expect(prompts.map(p => promptText(p.params))).toEqual([
                'first message',
                'second message',
            ])
            // Compared against an INDEPENDENTLY obtained expected value (the driver's own "session" frame),
            // not against each other — see this file's header on why sessionIds[1] === sessionIds[0] alone
            // would be a tautology.
            expect(promptSessionId(prompts[0].params)).toBe(expectedSessionId)
            expect(promptSessionId(prompts[1].params)).toBe(expectedSessionId)

            // Independent second proof channel (the driver's own frame stream, not the echo file) — mirrors
            // acpPermissionFakeAgent.test.ts's identical dual-proof idiom.
            const queueTexts = frames
                .filter(
                    (f): f is Extract<ChatFrame, { type: 'assistant-text' }> =>
                        f.type === 'assistant-text',
                )
                .map(f => f.text)
            expect(queueTexts).toEqual([
                `${FAKE_QUEUE_TURN_PREFIX}first message`,
                `${FAKE_QUEUE_TURN_PREFIX}second message`,
            ])

            expect(frames.filter(f => f.type === 'done').length).toBe(2)
            const results = frames.filter(
                (f): f is Extract<ChatFrame, { type: 'result' }> =>
                    f.type === 'result',
            )
            expect(results.length).toBe(2)
            expect(results.every(r => r.isError === false)).toBe(true)
            expect(frames.some(f => f.type === 'error')).toBe(false)
        }, 25_000)

        test('three sendMessage calls while the first is in flight: the two QUEUED turns run in the order they were submitted, not reversed', async () => {
            const chatId = 'acp-queue-three-' + Date.now()
            chatIds.push(chatId)
            const { sink, frames, waitFor } = makeChatFrameCollector(25_000)

            const expectedSessionId = await openReadySession(
                chatId,
                sink,
                waitFor,
            )

            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'alpha',
            })
            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'beta',
            })
            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'gamma',
            })

            // Both "beta" and "gamma" are queued behind "alpha" at this instant — the two-simultaneously-
            // queued scenario a bare two-message test cannot exercise (see this file's header). Same
            // completeness checks as the two-message test above (0 done frames, exactly 1 wire request)
            // while held, not dropped just because this test's own focus is ordering.
            await new Promise(r => setTimeout(r, HELD_OBSERVATION_MS))
            expect(
                readEchoLines(echoFile).filter(
                    l => l.method === 'session/prompt',
                ).length,
            ).toBe(1)
            expect(frames.filter(f => f.type === 'done').length).toBe(0)

            await waitForCondition(
                () => frames.filter(f => f.type === 'done').length === 3,
                QUEUE_HOLD_MS * 3 + 10_000,
                '3 done frames',
            )

            const prompts = readEchoLines(echoFile).filter(
                l => l.method === 'session/prompt',
            )
            expect(prompts.length).toBe(3)
            // THE assertion this test exists for: submission order specifically. A LIFO (or otherwise
            // reordering) queue drain still produces 3 session/prompt calls and 3 done frames — passing
            // every count-based check in this file — while getting beta/gamma backwards here.
            expect(prompts.map(p => promptText(p.params))).toEqual([
                'alpha',
                'beta',
                'gamma',
            ])
            for (const p of prompts)
                expect(promptSessionId(p.params)).toBe(expectedSessionId)

            const queueTexts = frames
                .filter(
                    (f): f is Extract<ChatFrame, { type: 'assistant-text' }> =>
                        f.type === 'assistant-text',
                )
                .map(f => f.text)
            expect(queueTexts).toEqual([
                `${FAKE_QUEUE_TURN_PREFIX}alpha`,
                `${FAKE_QUEUE_TURN_PREFIX}beta`,
                `${FAKE_QUEUE_TURN_PREFIX}gamma`,
            ])

            expect(frames.filter(f => f.type === 'done').length).toBe(3)
            const results = frames.filter(
                (f): f is Extract<ChatFrame, { type: 'result' }> =>
                    f.type === 'result',
            )
            expect(results.length).toBe(3)
            expect(results.every(r => r.isError === false)).toBe(true)
            expect(frames.some(f => f.type === 'error')).toBe(false)
        }, 30_000)
    },
)
