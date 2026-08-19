import { tempDir } from '../helpers'
// core/test/chatProviders/acpFakeAgent.test.ts
// Task 4 of the offline-integration-testing plan: drive core/src/chatProviders/acp/driver.ts against
// a FAKE ACP agent (core/test/support/fakeAcpAgent.ts) rather than a real CLI, specifically to cover
// the model-shape version-skew branch (./protocol.ts's detectModelShape) that NO single real ACP
// agent installed on any one machine can exercise both sides of: an agent's `session/new` response
// either reports the OLD `models.availableModels`/`currentModelId` shape (still-shipping
// 0.14.1-pinned adapters, and cline's own bundled dispatch) or the NEW `configOptions` shape (SDKs
// ~0.20+) — never both from the same binary. This test controls which shape comes back via the fake
// agent's FAKE_ACP_MODEL_SHAPE env var, proving the driver's branch logic against BOTH, in one file,
// with zero dependency on any ACP CLI being installed and zero network access at all (the fake agent
// never makes an HTTP call of any kind — there is no model API on the other end of it, mock or
// real).
//
// STUB-BINARY PATTERN: mirrors relay/test/wrap.test.ts exactly — write an executable stub file
// NAMED like a real ACP agent binary ("cline", chosen
// because agents.ts's cline entry has the simplest args list, `["--acp"]`, no fallbackArgs retry to
// account for) into a throwaway temp dir, PREPEND that dir onto PATH so core/src/claudeWhich.ts's
// whichBinary("cline") resolves the stub instead of any real `cline` this machine might have
// installed elsewhere on PATH, then drive the REAL, unmodified chatProviders/acp/driver.ts (via
// CHAT_BACKENDS.cline from ../../src/chatProviders/backends — the same registry chat.ts's WS layer
// dispatches through) exactly as production does. The stub's OWN body just execs
// fakeAcpAgent.ts — the JSON-RPC protocol logic lives there, not in this file.
//
// No production files were changed for this task.
//
// PID-VERIFIED TEARDOWN (task-F, test-isolation hardening): retrofitted onto the shared
// ../support/acpFakeAgentProcess.ts helper — the same module acpAbortFakeAgent.test.ts and
// acpQueueFakeAgent.test.ts already consume — rather than this file's own former inline
// mkdtempSync/writeFileSync/chmodSync stub-writer. `closeChat()` only SENDS a signal
// (SIGTERM, escalating to SIGKILL after driver.ts's own grace window); it never confirms the
// process actually exited. Without a pid-backed poll, a survivor goes unnoticed — the same class of
// bug fixed for openclaw (F1) and for the sibling ACP fake-agent files earlier — and this file's own
// per-test temp dirs (`bismuth-acp-fake-stub-*`/`bismuth-acp-fake-echo-*`) were found leaked in
// tmpdir() with no live process attached (F2). Teardown below now confirms every pid it captured is
// actually gone BEFORE removing directories, and removes directories regardless of whether that
// confirmation succeeds.
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    test,
} from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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
const FAKE_TURN_TEXT = 'Hello from the fake ACP agent' // must match fakeAcpAgent.ts's own constant

/** One `{method, params}` line per inbound JSON-RPC request the fake agent received, in arrival
 *  order — see fakeAcpAgent.ts's `echo()`. Tolerant of the file not existing yet (an empty array,
 *  not a throw) since a test may poll this before the fake agent has written its first line, AND
 *  of a torn read (this is polled from inside waitForCondition's `check()` while the fake agent may
 *  be mid-`appendFileSync` on the last line) — a line that doesn't parse yet is dropped rather than
 *  thrown, so a read racing a write fails the CURRENT poll (retried 50ms later, once the write has
 *  landed) instead of failing the whole test on a spurious JSON.parse error. */
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
            /* a torn/partially-written line — see this function's doc comment */
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
    'the ACP driver against a fake agent (zero network access, zero CLI dependency)',
    () => {
        let stubDir: string | undefined
        let pidDir: string | undefined
        // `| undefined`, reset at the top of every beforeEach (review finding, Minor 1): without this, a
        // beforeEach that throws AFTER a previous test's own pidFile was assigned (e.g. mkdtempSync for
        // pidDir failing on a LATER test) would leave pidFile pointing at the PREVIOUS test's already-
        // removed path — stale state surviving a throw, the same class of bug stubDir/pidDir already
        // guard against.
        let pidFile: string | undefined
        let savedPath: string | undefined
        let savedShape: string | undefined
        let savedEchoFile: string | undefined
        // Set only by the setModel test (below), which is the one test that needs an echo file — cleaned
        // up here unconditionally (a code-review finding: it was previously created with mkdtempSync and
        // never removed, leaving a `bismuth-acp-fake-echo-*` dir in $TMPDIR after every run).
        let echoDir: string | undefined
        const chatIds: string[] = []
        // Pids this test itself caused to exist (via waitForPidFile, called once each test's own process is
        // confirmed up), verified gone in afterEach — mirrors acpAbortFakeAgent.test.ts's/
        // acpQueueFakeAgent.test.ts's identical shape.
        const spawnedPids: number[] = []

        beforeEach(() => {
            // Snapshot env BEFORE anything that can throw (makeAcpFakeAgentStubDir: mkdtempSync/
            // writeFileSync/chmodSync) — a final-review finding, the same env-save-ordering class of bug
            // fixed elsewhere on this branch: on a first-beforeEach throw here, `savedPath` would stay
            // `undefined`, and afterEach's restore (`if (savedPath === undefined) delete process.env.PATH`)
            // would then strip PATH from the shared `bun test` process for every LATER test that spawns a
            // subprocess.
            savedPath = process.env.PATH
            savedShape = process.env.FAKE_ACP_MODEL_SHAPE
            savedEchoFile = process.env.FAKE_ACP_ECHO_FILE
            echoDir = undefined
            stubDir = undefined
            pidDir = undefined
            pidFile = undefined
            pidDir = tempDir('bismuth-acp-fake-pid-')
            pidFile = join(pidDir, 'agent.pid')
            stubDir = makeAcpFakeAgentStubDir(
                'bismuth-acp-fake-stub-',
                'cline',
                FAKE_AGENT_SCRIPT,
                pidFile,
            )
            // Prepended, not appended: must win over any real `cline` this machine happens to have
            // installed elsewhere on PATH.
            process.env.PATH = `${stubDir}:${savedPath ?? ''}`
        })

        afterEach(async () => {
            for (const id of chatIds.splice(0))
                CHAT_BACKENDS.cline.closeChat(id)
            if (savedPath === undefined) delete process.env.PATH
            else process.env.PATH = savedPath
            if (savedShape === undefined)
                delete process.env.FAKE_ACP_MODEL_SHAPE
            else process.env.FAKE_ACP_MODEL_SHAPE = savedShape
            if (savedEchoFile === undefined)
                delete process.env.FAKE_ACP_ECHO_FILE
            else process.env.FAKE_ACP_ECHO_FILE = savedEchoFile

            // closeChat() only SENDS a signal (SIGTERM, escalating to SIGKILL after driver.ts's own grace
            // window) — it does not wait for the process to exit. Poll by OWNED pid (never a `pgrep -f`
            // pattern match) via the shared helper; do the temp-dir cleanup regardless of the outcome, THEN
            // throw if anything survived — see acpFakeAgentProcess.ts's own header for why cleanup must not
            // be skippable by this check's own failure.
            const stillAlive = await waitProcessesGone(spawnedPids.splice(0))

            if (stubDir) rmSync(stubDir, { recursive: true, force: true })
            if (echoDir) rmSync(echoDir, { recursive: true, force: true })
            if (pidDir) rmSync(pidDir, { recursive: true, force: true })

            if (stillAlive.length > 0) {
                throw new Error(
                    `acpFakeAgent.test: fake-agent pid(s) ${stillAlive.join(', ')} still alive after closeChat — a real leak.`,
                )
            }
        }, 15_000)

        afterAll(() => {
            // Belt-and-suspenders: afterEach already restores these, but a thrown assertion mid-test must
            // never leave a later, unrelated test file in this same process pointed at a stub PATH.
            if (savedPath !== undefined) process.env.PATH = savedPath
            if (savedShape !== undefined)
                process.env.FAKE_ACP_MODEL_SHAPE = savedShape
            if (savedEchoFile !== undefined)
                process.env.FAKE_ACP_ECHO_FILE = savedEchoFile
        })

        test('OLD model shape (models.availableModels/currentModelId): driver reports it faithfully and a turn completes', async () => {
            process.env.FAKE_ACP_MODEL_SHAPE = 'old'
            const chatId = 'acp-fake-old-' + Date.now()
            chatIds.push(chatId)
            // Below the test's own 15_000ms Bun timeout (below, third arg to `test(...)`) — a code-review
            // finding: these matched exactly, so on a hang the collector's own diagnostic rejection
            // ("timeout waiting for frame; saw: [...]") could never fire before Bun's generic timeout cut
            // it off first, losing the frame-type trace that's the whole point of that message.
            const { sink, frames, waitFor } = makeChatFrameCollector(12_000)

            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'hello',
            })

            // Captured as early as possible (review Minor 2: a pid captured only after later frame waits
            // leaves the leak check vacuous for this test if it fails BEFORE reaching that point, even
            // though the process was already spawned) — the stub writes its own pid before exec'ing into
            // the fake agent, independent of ACP protocol progress, so this never races the frames below.
            const pid = await waitForPidFile(pidFile!)
            spawnedPids.push(pid)
            expect(pidAlive(pid)).toBe(true) // sanity: alive now, so "not alive after teardown" means something

            const modelsFrame = await waitFor(f => f.type === 'models')
            expect(modelsFrame.type).toBe('models')
            if (modelsFrame.type === 'models') {
                expect(modelsFrame.models.map(m => m.value).sort()).toEqual([
                    'fake-model-a',
                    'fake-model-b',
                ])
                // Old-shape signature per protocol.ts's detectModelShape: description comes from the
                // availableModels entry's own `description` field, and effortLevels is ALWAYS [] (the old
                // shape carries no thought_level-equivalent sibling at all).
                const a = modelsFrame.models.find(
                    m => m.value === 'fake-model-a',
                )!
                expect(a.description).toBe('old-shape model a')
                expect(a.effortLevels).toEqual([])
            }

            const sessionFrame = await waitFor(f => f.type === 'session')
            expect(sessionFrame.type).toBe('session')
            if (sessionFrame.type === 'session')
                expect(sessionFrame.sessionId).toStartWith('fake-session-old-')

            const assistantText = await waitFor(
                f => f.type === 'assistant-text',
            )
            if (assistantText.type === 'assistant-text')
                expect(assistantText.text).toBe(FAKE_TURN_TEXT)

            const done = await waitFor(f => f.type === 'done')
            expect(done.type).toBe('done')
            const resultIdx = frames.findIndex(f => f.type === 'result')
            const doneIdx = frames.findIndex(f => f.type === 'done')
            expect(resultIdx).toBeGreaterThanOrEqual(0)
            expect(doneIdx).toBeGreaterThan(resultIdx)
            if (frames[resultIdx].type === 'result')
                expect(frames[resultIdx].isError).toBe(false)
        }, 15_000)

        test('NEW model shape (configOptions, category "model" + sibling "thought_level"): driver reports it faithfully, effortLevels populated, and a turn completes', async () => {
            process.env.FAKE_ACP_MODEL_SHAPE = 'new'
            const chatId = 'acp-fake-new-' + Date.now()
            chatIds.push(chatId)
            const { sink, waitFor } = makeChatFrameCollector(12_000) // below the 15_000ms Bun timeout below — see the OLD-shape test's identical comment

            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'hello',
            })

            // Captured as early as possible — see the OLD-shape test's identical comment (review Minor 2).
            const pid = await waitForPidFile(pidFile!)
            spawnedPids.push(pid)
            expect(pidAlive(pid)).toBe(true) // sanity: alive now, so "not alive after teardown" means something

            const modelsFrame = await waitFor(f => f.type === 'models')
            expect(modelsFrame.type).toBe('models')
            if (modelsFrame.type === 'models') {
                expect(modelsFrame.models.map(m => m.value).sort()).toEqual([
                    'fake-model-x',
                    'fake-model-y',
                ])
                // New-shape signature: description is always "" (protocol.ts never populates it from
                // configOptions — there is no per-model description field in that shape), and effortLevels
                // rides the SIBLING "thought_level" configOptions entry's own option names, applied to
                // EVERY model entry alike (ACP has no per-model effort granularity — see protocol.ts's
                // detectModelShape doc comment).
                const x = modelsFrame.models.find(
                    m => m.value === 'fake-model-x',
                )!
                expect(x.description).toBe('')
                expect(x.effortLevels).toEqual(['Low', 'High'])
                const y = modelsFrame.models.find(
                    m => m.value === 'fake-model-y',
                )!
                expect(y.effortLevels).toEqual(['Low', 'High'])
            }

            const sessionFrame = await waitFor(f => f.type === 'session')
            if (sessionFrame.type === 'session')
                expect(sessionFrame.sessionId).toStartWith('fake-session-new-')

            const assistantText = await waitFor(
                f => f.type === 'assistant-text',
            )
            if (assistantText.type === 'assistant-text')
                expect(assistantText.text).toBe(FAKE_TURN_TEXT)

            await waitFor(f => f.type === 'done')
        }, 15_000)

        test("setModel dispatches the NEW shape's session/set_config_option with the new value on the wire, and a turn started right after still completes", async () => {
            // Code-review finding on this task's first pass: the old version of this test never observed
            // WHICH wire method setModel actually sent (driver.ts's setModel is fire-and-forget with a
            // swallowed `.catch()`, so `expect(...).not.toThrow()` could not fail for any input, including
            // a typo'd chatId), and it called setModel LAST, so its title's "a turn started right after
            // still completes" claim was untested. Fixed: FAKE_ACP_ECHO_FILE makes the fake agent record
            // every inbound {method, params} to a file this test reads directly (see fakeAcpAgent.ts's
            // `echo()`), and a SECOND real turn is sent and awaited after setModel.
            process.env.FAKE_ACP_MODEL_SHAPE = 'new'
            echoDir = tempDir('bismuth-acp-fake-echo-')
            const echoFile = join(echoDir, 'echo.jsonl')
            process.env.FAKE_ACP_ECHO_FILE = echoFile

            const chatId = 'acp-fake-setmodel-' + Date.now()
            chatIds.push(chatId)
            const { sink, frames, waitFor } = makeChatFrameCollector(15_000)

            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'hello',
            })

            // Captured as early as possible — see the OLD-shape test's identical comment (review Minor 2).
            const pid = await waitForPidFile(pidFile!)
            spawnedPids.push(pid)
            expect(pidAlive(pid)).toBe(true) // sanity: alive now, so "not alive after teardown" means something

            await waitFor(f => f.type === 'models')
            await waitFor(f => f.type === 'done') // first turn settled

            const doneCountBeforeSecondTurn = frames.filter(
                f => f.type === 'done',
            ).length

            CHAT_BACKENDS.cline.setModel(chatId, 'fake-model-y')

            // The actual dispatch assertion: wait for the fake agent to have logged a
            // session/set_config_option call carrying the new value — not just "setModel didn't throw"
            // (which proves nothing; see the finding above), but that the RIGHT wire method fired with
            // the RIGHT payload.
            await waitForCondition(
                () =>
                    readEchoLines(echoFile).some(
                        l =>
                            l.method === 'session/set_config_option' &&
                            (l.params as { value?: string })?.value ===
                                'fake-model-y',
                    ),
                5_000,
                'a session/set_config_option echo line with value:"fake-model-y"',
            )
            const setModelCalls = readEchoLines(echoFile).filter(
                l => l.method === 'session/set_config_option',
            )
            expect(setModelCalls.length).toBeGreaterThanOrEqual(1)
            expect(
                (setModelCalls[0].params as { configId?: string }).configId,
            ).toBe('model-config')
            // And NOT the old shape's method — proves the driver's shape-branch actually picked the NEW
            // dispatch target for a NEW-shape session, not just "some" method.
            expect(
                readEchoLines(echoFile).some(
                    l => l.method === 'session/set_model',
                ),
            ).toBe(false)

            // The second clause of this test's title: a turn started right after setModel must still
            // complete. Waiting for a NEW "done" (by count, not by predicate-match) — makeChatFrameCollector's
            // waitFor would otherwise resolve immediately off the FIRST turn's already-collected "done"
            // frame, proving nothing about this second turn.
            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'hello again',
            })
            await waitForCondition(
                () =>
                    frames.filter(f => f.type === 'done').length >
                    doneCountBeforeSecondTurn,
                10_000,
                'a second "done" frame after setModel',
            )
        }, 20_000)

        test("sendMessage()'s reopen branch (reattachSessionSink) flushes a buffered turn to the NEW sink without an extra synthetic done", async () => {
            // Regression coverage for core/src/chatProviders/acp/driver.ts's sendMessage() "existing
            // session" branch, which must call sessionSink.ts's reattachSessionSink (flush, no synthetic
            // `done`) rather than rebindSessionSink (flush, THEN push a synthetic `done` whenever no turn
            // is active — which it always is right here, since turn 1 finishes before turn 2 is sent).
            // Swapping the two is a one-word change no prior test in this file catches — and this is the
            // ONE driver of the four whose coverage needs no real CLI binary at all (the fake agent),
            // guaranteed to run on every machine regardless of what's installed.
            process.env.FAKE_ACP_MODEL_SHAPE = 'old'
            const chatId = 'acp-fake-reopen-' + Date.now()
            chatIds.push(chatId)
            const {
                sink: sink1,
                frames: frames1,
                waitFor: waitFor1,
            } = makeChatFrameCollector(12_000)

            // Pre-create the session and wait for the handshake to finish (openSession/sendMessage both
            // spawn+register the session ASYNCHRONOUSLY — detaching before the "session" frame arrives
            // would find no session yet and silently no-op).
            CHAT_BACKENDS.cline.openSession({
                chatId,
                cwd: '/tmp',
                sink: sink1,
                computerUse: false,
            })

            // Captured as early as possible, before even the "session" frame wait below (review Minor 2:
            // a pid captured only after a later frame arrives leaves the leak check vacuous for a test
            // that fails before reaching that point, even though the process was already spawned by
            // openSession() above) — the stub writes its own pid before exec'ing, independent of protocol
            // progress.
            const pid = await waitForPidFile(pidFile!)
            spawnedPids.push(pid)
            expect(pidAlive(pid)).toBe(true) // sanity: alive now, so "not alive after teardown" means something

            await waitFor1(f => f.type === 'session')

            // Queue turn 1 (kicks off session/prompt), then detach IMMEDIATELY (synchronously, same tick)
            // — runOrQueue's own turn work is asynchronous past its first await, so this reliably wins the
            // race: nothing from THIS turn's prompt response has been emitted to sink1 yet.
            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink: sink1,
                computerUse: false,
                text: 'hello',
            })
            // Assert the return value itself, not just its side effect: nothing else in this suite pins
            // that a driver's detachSink actually reports success/rejection (all four call sites were bare
            // expression statements) — a driver rewritten to `detachSessionSink(s, sink); return true;`
            // would re-arm the identity-guard bug for that backend with the whole suite green. This is the
            // one CLI-free file among the four, so it's the one guaranteed to run and catch it everywhere.
            expect(CHAT_BACKENDS.cline.detachSink(chatId, sink1)).toBe(true)
            // The guard's negative case, exercised live (not just at the sessionSink.ts unit level): a
            // mismatched sink must be rejected — false, no state change — even against a real session.
            expect(CHAT_BACKENDS.cline.detachSink(chatId, () => {})).toBe(false)

            // Give the whole first turn (assistant-text, result, done) time to complete while detached.
            await new Promise(r => setTimeout(r, 2000))
            expect(frames1.some(f => f.type === 'assistant-text')).toBe(false)
            expect(frames1.some(f => f.type === 'done')).toBe(false)

            // Reopen with a FRESH sink — the driver's sendMessage() "existing session" branch.
            const {
                sink: sink2,
                frames: frames2,
                waitFor: waitFor2,
            } = makeChatFrameCollector(12_000)
            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink: sink2,
                computerUse: false,
                text: 'hello',
            })

            // Wait for the FULL picture to settle — 2 done frames total (turn 1's buffered done, then
            // turn 2's own done) — BEFORE checking anything about order. Checking order right after the
            // first assistant-text (before turn 1's own result/done have necessarily landed yet) is a race;
            // waiting for both dones first makes every ordering check below run against a stable array.
            await waitFor2(
                _f => frames2.filter(x => x.type === 'done').length >= 2,
                12_000,
            )

            // Turn 1's buffered tail must have arrived on sink2 (the flush) — assistant-text then done, in
            // order — as the FIRST content, ahead of turn 2's own.
            const firstAssistantIdx = frames2.findIndex(
                f => f.type === 'assistant-text',
            )
            expect(firstAssistantIdx).toBeGreaterThanOrEqual(0)
            const firstAssistant = frames2[firstAssistantIdx]
            if (firstAssistant.type === 'assistant-text')
                expect(firstAssistant.text).toBe(FAKE_TURN_TEXT)
            const firstDoneIdx = frames2.findIndex(f => f.type === 'done')
            expect(firstDoneIdx).toBeGreaterThan(firstAssistantIdx)

            // THE discriminating assertion. Under the reattach→rebind sabotage, rebindSessionSink's
            // synthetic `done` fires SYNCHRONOUSLY inside sendMessage's "existing session" branch
            // whenever turnActive is false at that moment — true both for the FIRST sendMessage call
            // above (the session already exists via openSession, caught by the earlier
            // frames1.some(done) assertion) and for THIS reopen call (turn 1 already finished), so
            // frames2 already holds 2 done frames before turn 2's OWN text has even been requested —
            // done.length === 2 PASSES even under the sabotage, since the wait above resolves off that
            // already-collected count without ever waiting for turn 2 to run. It's assistant-text.length
            // that actually catches it here.
            expect(frames2.filter(f => f.type === 'done').length).toBe(2)
            expect(
                frames2.filter(f => f.type === 'assistant-text').length,
            ).toBe(2)
        }, 20_000)
    },
)
