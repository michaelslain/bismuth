import { tempDir } from '../helpers'
// core/test/chatProviders/acpToolUseFakeAgent.test.ts
// Task 12 (step 1 of 2): live tool-use, the fake-agent half — a real `tool_call` + `tool_call_update`
// session/update pair, driven through the REAL, unmodified chatProviders/acp/driver.ts, proving the
// ordered ChatFrame sequence it must produce: `tool-use{id,name,kind}` -> `tool-result{id,isError}`
// with EQUAL ids, `tool-result` strictly after `tool-use`, exactly one `tool-result` per id, and
// `result` after both. Task 2 (two waves ago) gave the `tool-use` frame a `kind` field (ACP's
// ToolCall.kind, carried alongside `name` so the UI can pick an icon from a stable machine token
// instead of the free-form `title`/`name` string) — every assertion below expects it.
//
// WHY THE FAKE AGENT (not only a real-CLI test): a real ACP agent's tool call is driven by whatever
// its OWN model backend decides to call, and — as this task's OTHER half (acpToolUseFixture...
// see gooseMocked.test.ts) discovered by actually running one — a real agent's tool_call payload
// carries agent-specific extras (goose's own `_meta.goose.toolCall`, a real `rawInput`) and can be
// slow/flaky/host-state-dependent (goose's tool call here is backed by a REAL Bismuth MCP server
// subprocess). This file proves the DRIVER's own translation logic — id/name/kind/ordering/count —
// deterministically and with zero CLI dependency, mirroring every other fake-agent test's role in
// this suite (acpFakeAgent.test.ts's own header makes the identical argument for model-shape
// coverage).
//
// STUB-BINARY PATTERN + PID-VERIFIED TEARDOWN: identical to every sibling fakeAcpAgent.ts-driven
// test file — stub "cline" on PATH (the simplest ACP_AGENTS entry, args ["--acp"], no fallbackArgs
// retry to account for), drive the real driver via CHAT_BACKENDS.cline, verify the fake agent's own
// pid is gone (not just "closeChat didn't throw") via ../support/acpFakeAgentProcess.ts. Zero
// network, zero real CLI dependency.
//
// TOOL-CALL MODE: opt-in via FAKE_ACP_TOOL_CALL (see ../support/fakeAcpAgent.ts's own header) —
// every test below sets it explicitly; the SECOND test below proves the mode is genuinely inert when
// unset (not merely "every OTHER test still passes"), the same behavioural-inertness bar every
// sibling opt-in mode's own test file holds itself to (see acpResumeFakeAgent.test.ts's identical
// second test for the precedent this mirrors).
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    test,
} from 'bun:test'
import { rmSync } from 'node:fs'
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

// Must match ../support/fakeAcpAgent.ts's own constants — duplicated rather than imported because
// the fake is a standalone script executed as a subprocess, not a module this test links against
// (the same convention every sibling fake-agent test file already uses).
const FAKE_TURN_TEXT = 'Hello from the fake ACP agent'
const TOOLUSE_TOOL_CALL_ID = 'fake-tool-use-call-1'
const TOOLUSE_TOOL_TITLE = 'Read fake-tool-use-probe.txt'
const TOOLUSE_TOOL_KIND = 'read'
const TOOLUSE_RESULT_TEXT = 'fake tool result: 3 lines read'

// Spawns real processes/sockets, so it is gated as a SLOW suite (see slowGate.ts): the
// pre-commit gate skips it for latency; pre-push and CI still run it in full.
const describeOrSkipSlow = shouldRunSlowTests(process.env)
    ? describe
    : describe.skip

describeOrSkipSlow(
    'live tool-use (tool_call -> tool_call_update), driven through the ACP driver against a fake agent (zero network, zero CLI dependency)',
    () => {
        let stubDir: string | undefined
        let pidDir: string | undefined
        let pidFile: string | undefined
        const savedEnv: Record<string, string | undefined> = {}
        // Every FAKE_ACP_* var any sibling fake-agent file has ever introduced, PLUS this task's own new
        // one — hermetic against a stray var leaking in from the ambient shell OR from an earlier test
        // file sharing this `bun test` process (mirrors acpResumeFakeAgent.test.ts's identical list).
        const ENV_KEYS = [
            'PATH',
            'FAKE_ACP_TOOL_CALL',
            'FAKE_ACP_MODEL_SHAPE',
            'FAKE_ACP_AUTH_GATE',
            'FAKE_ACP_CLINE_AUTHED',
            'FAKE_ACP_PROMPT_HOLD',
            'FAKE_ACP_QUEUE_HOLD_MS',
            'FAKE_ACP_PERMISSION_OPTIONS',
            'FAKE_ACP_ECHO_FILE',
            'FAKE_ACP_REJECT_SESSION_LOAD',
            'FAKE_ACP_REJECT_SESSION_LOAD_CODE',
            'FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE',
        ] as const
        const chatIds: string[] = []
        // Pids this test itself caused to exist (captured via waitForPidFile IMMEDIATELY after each
        // sendMessage call, never later — a capture placed after frame waits leaves this check vacuous
        // for a test that fails before reaching that point, even though the process already exists).
        const spawnedPids: number[] = []

        function restoreEnv(): void {
            for (const k of ENV_KEYS) {
                if (savedEnv[k] === undefined) delete process.env[k]
                else process.env[k] = savedEnv[k]
            }
        }

        beforeEach(() => {
            // Snapshot BEFORE anything that can throw (makeAcpFakeAgentStubDir) — see every sibling
            // fake-agent test file's identical ordering discipline.
            for (const k of ENV_KEYS) savedEnv[k] = process.env[k]

            stubDir = undefined
            pidDir = undefined
            pidFile = undefined
            pidDir = tempDir('bismuth-acp-tooluse-pid-')
            pidFile = join(pidDir, 'agent.pid')
            stubDir = makeAcpFakeAgentStubDir(
                'bismuth-acp-tooluse-stub-',
                'cline',
                FAKE_AGENT_SCRIPT,
                pidFile,
            )

            // Prepended, not appended: must win over any real `cline` installed elsewhere on PATH.
            process.env.PATH = `${stubDir}:${savedEnv.PATH ?? ''}`
            // Hermetic against ambient env — a stray FAKE_ACP_* var exported in the shell running
            // `bun test` (or left behind by another test file in the same process) must not leak in here.
            delete process.env.FAKE_ACP_TOOL_CALL
            delete process.env.FAKE_ACP_AUTH_GATE
            delete process.env.FAKE_ACP_CLINE_AUTHED
            delete process.env.FAKE_ACP_PROMPT_HOLD
            delete process.env.FAKE_ACP_QUEUE_HOLD_MS
            delete process.env.FAKE_ACP_PERMISSION_OPTIONS
            delete process.env.FAKE_ACP_ECHO_FILE
            delete process.env.FAKE_ACP_REJECT_SESSION_LOAD
            delete process.env.FAKE_ACP_REJECT_SESSION_LOAD_CODE
            delete process.env.FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE
            process.env.FAKE_ACP_MODEL_SHAPE = 'new'
        })

        afterEach(async () => {
            // Env restore FIRST: a throw below must never skip restoration and leave a later test (in this
            // file or a later file in this same process) pointed at a stub PATH.
            restoreEnv()
            for (const id of chatIds.splice(0))
                CHAT_BACKENDS.cline.closeChat(id)

            // closeChat() only SENDS a signal (SIGTERM, escalating to SIGKILL after driver.ts's own grace
            // window) — it does not wait for the process to exit. Poll by OWNED pid via the shared helper,
            // do the temp-dir cleanup regardless of the outcome, THEN throw if anything survived.
            const stillAlive = await waitProcessesGone(spawnedPids.splice(0))

            if (stubDir) rmSync(stubDir, { recursive: true, force: true })
            if (pidDir) rmSync(pidDir, { recursive: true, force: true })

            if (stillAlive.length > 0) {
                throw new Error(
                    `acpToolUseFakeAgent.test: fake-agent pid(s) ${stillAlive.join(', ')} still alive after closeChat — a real leak.`,
                )
            }
        }, 15_000)

        afterAll(() => {
            // Belt-and-suspenders: a thrown assertion mid-test must never leave a LATER, unrelated test file
            // in this same `bun test` process pointed at a stub PATH or a stuck FAKE_ACP_* var.
            restoreEnv()
        })

        test('tool_call -> tool_call_update yields tool-use{id,name,kind} then tool-result{id,isError:false} with equal ids, tool-result strictly after tool-use, exactly one tool-result for that id, and result after both', async () => {
            process.env.FAKE_ACP_TOOL_CALL = '1'

            const chatId = 'acp-tooluse-' + Date.now()
            chatIds.push(chatId)
            const { sink, frames, waitFor } = makeChatFrameCollector(15_000)

            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'hello',
            })

            // Captured immediately after the send, not after any frame wait below — the stub writes its
            // own pid before exec'ing into the fake agent, independent of ACP protocol progress, so a
            // failure anywhere below still leaves a meaningful (non-vacuous) leak check in afterEach.
            const pid = await waitForPidFile(pidFile!)
            spawnedPids.push(pid)
            expect(pidAlive(pid)).toBe(true) // sanity: alive now, so "not alive after teardown" means something

            await waitFor(f => f.type === 'done')

            // Exactly one of each — never "at least one" (a duplicate-emission regression must fail this).
            const toolUseFrames = frames.filter(
                (f): f is Extract<ChatFrame, { type: 'tool-use' }> =>
                    f.type === 'tool-use',
            )
            const toolResultFrames = frames.filter(
                (f): f is Extract<ChatFrame, { type: 'tool-result' }> =>
                    f.type === 'tool-result',
            )
            expect(toolUseFrames.length).toBe(1)
            expect(toolResultFrames.length).toBe(1)

            const toolUse = toolUseFrames[0]
            const toolResult = toolResultFrames[0]

            // Identity: independently-chosen literals from ../support/fakeAcpAgent.ts, never compared
            // against each other's OWN fields (a mutation that scrambled both identically would otherwise
            // slip through an id===id-style comparison).
            expect(toolUse.id).toBe(TOOLUSE_TOOL_CALL_ID)
            expect(toolResult.id).toBe(TOOLUSE_TOOL_CALL_ID)
            // THE equal-ids assertion, checked directly (not merely implied by both matching the same
            // literal above).
            expect(toolResult.id).toBe(toolUse.id)

            // name: the real ACP ToolCall has no `name` field — only `title` (required) and `kind`
            // (optional) — so toolCallName's title-first resolution must land on TITLE, never on kind or
            // on the synthesized "tool" fallback.
            expect(toolUse.name).toBe(TOOLUSE_TOOL_TITLE)
            // kind: THE Task-2 field this test exists to cover — carried alongside name, not blended into
            // it, and equal to the ACP ToolCall.kind the fake sent (never the title, never absent).
            expect(toolUse.kind).toBe(TOOLUSE_TOOL_KIND)

            expect(toolResult.isError).toBe(false)
            expect(toolResult.content).toBe(TOOLUSE_RESULT_TEXT)

            // Ordering: tool-result strictly after tool-use (by frame-array position, not merely "both
            // present").
            const toolUseIdx = frames.indexOf(toolUse)
            const toolResultIdx = frames.indexOf(toolResult)
            expect(toolResultIdx).toBeGreaterThan(toolUseIdx)

            // result after BOTH tool-use and tool-result (checking against tool-result alone suffices,
            // since tool-result is already proven after tool-use above).
            const resultIdx = frames.findIndex(f => f.type === 'result')
            expect(resultIdx).toBeGreaterThan(toolResultIdx)
            const resultFrame = frames[resultIdx]
            if (resultFrame.type === 'result')
                expect(resultFrame.isError).toBe(false)

            // done after result — same convention every sibling fake-agent test file checks.
            const doneIdx = frames.findIndex(f => f.type === 'done')
            expect(doneIdx).toBeGreaterThan(resultIdx)

            // The turn's own prose still arrived — proves tool-call mode ADDS to the normal turn rather
            // than replacing it.
            const assistantTexts = frames
                .filter(
                    (f): f is Extract<ChatFrame, { type: 'assistant-text' }> =>
                        f.type === 'assistant-text',
                )
                .map(f => f.text)
            expect(assistantTexts).toEqual([FAKE_TURN_TEXT])
        }, 20_000)

        test("tool-call mode unset (the fake's default, unchanged): an ordinary turn produces NO tool-use/tool-result frames at all", async () => {
            // Deliberately NOT set — proves the inertness claim behaviourally, not merely "the other test
            // in this file still passes" — mirrors acpResumeFakeAgent.test.ts's identical-shaped test for
            // its own opt-in mode.
            expect(process.env.FAKE_ACP_TOOL_CALL).toBeUndefined()

            const chatId = 'acp-tooluse-inert-' + Date.now()
            chatIds.push(chatId)
            const { sink, frames, waitFor } = makeChatFrameCollector(15_000)

            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'hello',
            })

            const pid = await waitForPidFile(pidFile!)
            spawnedPids.push(pid)
            expect(pidAlive(pid)).toBe(true)

            await waitFor(f => f.type === 'done')

            expect(frames.some(f => f.type === 'tool-use')).toBe(false)
            expect(frames.some(f => f.type === 'tool-result')).toBe(false)
            const assistantTexts = frames
                .filter(
                    (f): f is Extract<ChatFrame, { type: 'assistant-text' }> =>
                        f.type === 'assistant-text',
                )
                .map(f => f.text)
            expect(assistantTexts).toEqual([FAKE_TURN_TEXT])
        }, 20_000)
    },
)
