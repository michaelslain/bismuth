import { tempDir } from '../helpers'
// core/test/chatProviders/acpPermissionFakeAgent.test.ts
// The ACP permission request→response ROUND TRIP, offline, through the real driver.
//
// WHY THIS FILE EXISTS. `session/request_permission` is the one path where Bismuth writes bytes back
// INTO an agent. Every other thing chatProviders/acp/driver.ts does is one-way translation (agent
// speaks, we render), which is why unit tests over ./protocol.ts's pure translators are adequate
// coverage there and are NOT adequate here: a defect on this path is not a cosmetic glitch, it is a
// turn that never completes, because the agent is blocked on a reply that never arrives or that it
// cannot parse. It affects 8 of the 9 chat backends, six of them through this one shared driver.
//
// WHAT EXISTED BEFORE THIS FILE — nothing offline:
//   - core/test/chat.test.ts's allow/deny permission tests are real, but live inside a
//     `describeOrSkip` gated on BISMUTH_LIVE_TESTS=1: they spend real account quota, and they cover
//     the CLAUDE backend's own canUseTool channel, not ACP's at all.
//   - app/src/chatProvider.test.ts asserts providerCan("cline","permissionPrompts") === true, which
//     reads the capability catalog and asserts the capability catalog. It is true of the catalog and
//     says nothing whatsoever about any driver.
//
// WHAT MAKES THIS TEST NON-VACUOUS, stated precisely because "a frame appeared" assertions are this
// project's recurring defect. The fake agent (../support/fakeAcpAgent.ts, held-prompt mode) does not
// answer `session/prompt` on its own. It streams a tool_call, asks `session/request_permission`, and
// then AWAITS a reply on its own stdin. Nothing else in the process can settle that prompt. So:
//   - a wrong rpc id in the reply    → the fake's pendingClientCalls lookup misses → never settles
//   - a missing pendingPermissions entry → the driver writes nothing at all      → never settles
//   - a malformed outcome            → parsed as "unrecognized" and reported as such in the text
//   - no reply at all                → never settles
// In the first, second and fourth cases no `result`/`done` frame is ever produced and the test fails
// on a timeout. There is deliberately NO escape hatch that lets it pass early — the assertions below
// are ordered against the permission frame's own index, never against mere presence, because the
// collector retains every frame ever seen and `frames.some(f => f.type === "permission")` would pass
// on a stray frame from any earlier point in the same chat.
//
// STUB-BINARY PATTERN: identical to acpFakeAgent.test.ts / clineAuthFakeAgent.test.ts (which cite
// relay/test/wrap.test.ts as the original precedent) — write an executable stub named "cline" into a
// throwaway temp dir, prepend it onto PATH so claudeWhich.ts's whichBinary("cline") resolves the
// stub, then drive the REAL, unmodified chatProviders/acp/driver.ts via CHAT_BACKENDS.cline exactly
// as production does. Zero network of any kind, zero CLI dependency, zero account contact.
//
// The three round-trip tests were written without touching any production file — only the
// test-support fake agent gained a new opt-in mode, verified inert with the mode's env var unset
// (see that file's header). The fourth test (TOOL NAMING, at the bottom) is the regression guard
// for a later change to acp/{driver,protocol}.ts; the fake was NOT touched for it.
//
// PID-VERIFIED TEARDOWN (task-F, test-isolation hardening): retrofitted onto the shared
// ../support/acpFakeAgentProcess.ts helper — the same module acpAbortFakeAgent.test.ts,
// acpQueueFakeAgent.test.ts and (as of this same task) acpFakeAgent.test.ts already consume —
// rather than this file's own former inline mkdtempSync/writeFileSync/chmodSync stub-writer.
// `closeChat()` only SENDS a signal; it never confirms the process actually exited. This file's own
// per-test temp dirs (`bismuth-acp-perm-stub-*`/`bismuth-acp-perm-echo-*`) were found leaked in
// tmpdir() with no live process attached. Teardown below now confirms every pid it captured is
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

// All six must match ../support/fakeAcpAgent.ts's own constants — same convention acpFakeAgent.test.ts
// already uses for FAKE_TURN_TEXT. Duplicated rather than imported because the fake is a standalone
// script executed as a subprocess, not a module this test links against.
const PERM_TOOL_CALL_ID = 'fake-tool-call-1'
const PERM_TOOL_TITLE = 'Write fake-permission-probe.txt'
const PERM_TOOL_KIND = 'edit'
const PERM_ALLOW_ONCE_ID = 'fake-opt-allow-once'
const PERM_REJECT_ONCE_ID = 'fake-opt-reject-once'
const FAKE_PERMISSION_REPLY_PREFIX = 'fake-acp permission reply: '

/**
 * Narrow a collected frame to a specific kind, FAILING if it is anything else.
 *
 * Why this exists rather than the obvious `if (f.type === "x") expect(...)`: that shape skips the
 * assertions instead of failing when the guard is false, which is this project's exact
 * signal-that-claims-more-than-it-knows defect wearing a type guard's clothes. Every such guard in
 * this file was provably true when written, so nothing was vacuous — but a later refactor that
 * changes which frame lands at a given index would silently turn four real assertions into no-ops,
 * with a green run and no failure anywhere. Failing here makes that refactor loud.
 */
function expectFrame<K extends ChatFrame['type']>(
    f: ChatFrame | undefined,
    kind: K,
): Extract<ChatFrame, { type: K }> {
    expect(f?.type).toBe(kind)
    return f as Extract<ChatFrame, { type: K }>
}

/** How long to sit still after the permission frame arrives, before asserting the turn has NOT
 *  settled. Without this the "the turn is genuinely parked" assertion would be indistinguishable
 *  from "we happened to check faster than the agent could reply" — 400ms is ~2 orders of magnitude
 *  more than the fake's own settle path costs once a reply lands (a synchronous readline callback
 *  writing one stdout line), so a fake that answered on its own would be caught here. */
const PARKED_OBSERVATION_MS = 400

interface EchoLine {
    /** Absent on the original inbound-request line kind; see fakeAcpAgent.ts's echo helpers. */
    dir?: 'out-request' | 'in-response'
    id?: number
    method?: string
    params?: unknown
    result?: unknown
    error?: unknown
}

/** Same tolerance contract as acpFakeAgent.test.ts's own copy: a missing file is an empty array (this
 *  is polled before the fake has written anything), and a torn last line — read while the fake is
 *  mid-appendFileSync — is dropped so the CURRENT poll fails and is retried 50ms later, rather than
 *  throwing a spurious JSON.parse error that would fail the whole test. */
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
    "the ACP driver's permission round-trip against a fake agent that holds the turn open (zero network, zero CLI dependency)",
    () => {
        // `| undefined` with an explicit reset each beforeEach, matching acpFakeAgent.test.ts's own shape:
        // if makeAcpFakeAgentStubDir()/mkdtempSync throws in the FIRST beforeEach, these stay undefined and
        // afterEach's rmSync would be handed `undefined` — which throws ERR_INVALID_ARG_TYPE and MASKS the
        // original failure (`force:true` swallows ENOENT, not an invalid argument type). This exact bug has
        // shipped in this harness before.
        let stubDir: string | undefined
        let echoDir: string | undefined
        let echoFile: string
        let pidDir: string | undefined
        // `| undefined`, reset at the top of every beforeEach (review finding, Minor 1) — see
        // acpFakeAgent.test.ts's identical comment on its own pidFile.
        let pidFile: string | undefined
        const savedEnv: Record<string, string | undefined> = {}
        const ENV_KEYS = [
            'PATH',
            'FAKE_ACP_PROMPT_HOLD',
            'FAKE_ACP_PERMISSION_OPTIONS',
            'FAKE_ACP_ECHO_FILE',
            'FAKE_ACP_MODEL_SHAPE',
            'FAKE_ACP_AUTH_GATE',
            'FAKE_ACP_CLINE_AUTHED',
        ] as const
        const chatIds: string[] = []
        // Pids this test itself caused to exist (via waitForPidFile, called once driveToParkedPermission
        // confirms the process is up), verified gone in afterEach — mirrors acpAbortFakeAgent.test.ts's/
        // acpQueueFakeAgent.test.ts's identical shape.
        const spawnedPids: number[] = []

        function restoreEnv(): void {
            for (const k of ENV_KEYS) {
                if (savedEnv[k] === undefined) delete process.env[k]
                else process.env[k] = savedEnv[k]
            }
        }

        beforeEach(() => {
            // Snapshot env BEFORE anything that can throw (the mkdtemp/write/chmod below), the same ordering
            // discipline the two sibling fake-agent files document: on a first-beforeEach throw, an
            // unsnapshotted key would be `delete`d rather than restored by afterEach, stripping PATH from the
            // shared `bun test` process for every later test that spawns a subprocess.
            for (const k of ENV_KEYS) savedEnv[k] = process.env[k]

            // Reset before the throwing calls below, so a failure partway through can never leave afterEach
            // pointed at the PREVIOUS test's already-removed directory.
            stubDir = undefined
            echoDir = undefined
            pidDir = undefined
            pidFile = undefined
            pidDir = tempDir('bismuth-acp-perm-pid-')
            pidFile = join(pidDir, 'agent.pid')
            stubDir = makeAcpFakeAgentStubDir(
                'bismuth-acp-perm-stub-',
                'cline',
                FAKE_AGENT_SCRIPT,
                pidFile,
            )
            echoDir = tempDir('bismuth-acp-perm-echo-')
            echoFile = join(echoDir, 'echo.jsonl')

            // Prepended, not appended: must win over any real `cline` installed elsewhere on PATH.
            process.env.PATH = `${stubDir}:${savedEnv.PATH ?? ''}`
            process.env.FAKE_ACP_ECHO_FILE = echoFile
            process.env.FAKE_ACP_PROMPT_HOLD = 'permission'
            // Hermetic against ambient env, the exact finding clineAuthFakeAgent.test.ts's beforeEach records:
            // a stray FAKE_ACP_AUTH_GATE exported in the shell running `bun test` would gate session/new and
            // turn every test here into an auth-refusal test instead. Model shape is pinned (rather than left
            // to the fake's default) so these tests never silently change meaning if that default ever moves.
            process.env.FAKE_ACP_MODEL_SHAPE = 'new'
            delete process.env.FAKE_ACP_AUTH_GATE
            delete process.env.FAKE_ACP_CLINE_AUTHED
            delete process.env.FAKE_ACP_PERMISSION_OPTIONS
        })

        afterEach(async () => {
            // Env restore FIRST: a throw from the closeChat loop must never skip restoration and leave a
            // later test in this file (or a later file in this same process) pointed at a stub PATH.
            restoreEnv()
            for (const id of chatIds.splice(0))
                CHAT_BACKENDS.cline.closeChat(id)

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
                    `acpPermissionFakeAgent.test: fake-agent pid(s) ${stillAlive.join(', ')} still alive after closeChat — a real leak.`,
                )
            }
        }, 15_000)

        afterAll(() => {
            // Belt-and-suspenders: a thrown assertion mid-test must never leave a LATER, unrelated test file
            // in this same `bun test` process pointed at a stub PATH or a stuck FAKE_ACP_* var. `delete` on
            // an originally-unset key, not merely "leave it alone" — the bug clineAuthFakeAgent.test.ts's own
            // afterAll documents having shipped and fixed.
            restoreEnv()
        })

        /**
         * Everything up to and including "the turn is parked on a permission prompt, and provably has not
         * settled". Returns the correlating id every downstream assertion hangs off — the driver derives
         * the `permission` frame's id from the fake's OWN outbound JSON-RPC request id (driver.ts's
         * `String(req.id)`), so this one value ties the ChatFrame, the echo-file request line, and the
         * echo-file reply line together. Correlating on it is what makes these assertions mean something;
         * asserting a permission frame merely exists would not.
         */
        async function driveToParkedPermission(chatId: string): Promise<{
            permissionId: string
            permissionIdx: number
            frames: ChatFrame[]
            waitFor: ReturnType<typeof makeChatFrameCollector>['waitFor']
        }> {
            chatIds.push(chatId)
            const { sink, frames, waitFor } = makeChatFrameCollector(12_000)

            CHAT_BACKENDS.cline.sendMessage({
                chatId,
                cwd: '/tmp',
                sink,
                computerUse: false,
                text: 'hello',
            })

            // Captured as early as possible, right after the process is spawned (review Minor 2: a pid
            // captured only after the permission frame arrives leaves the leak check vacuous for a test
            // that fails before that frame ever shows up, even though the process was already spawned by
            // sendMessage() above) — the stub writes its own pid before exec'ing, independent of ACP
            // protocol progress, so this never races anything below. Captured once here (the one entry
            // point every test in this file drives through) rather than per-test.
            const pid = await waitForPidFile(pidFile!)
            spawnedPids.push(pid)
            expect(pidAlive(pid)).toBe(true) // sanity: alive now, so "not alive after teardown" means something

            const permission = expectFrame(
                await waitFor(f => f.type === 'permission'),
                'permission',
            )

            // Exactly one, not "at least one": this turn contains exactly one tool call, so a second
            // permission frame would mean the driver re-emitted a parked request (double-prompting the user
            // for one approval) and would silently invalidate every id-correlated assertion below.
            expect(frames.filter(f => f.type === 'permission').length).toBe(1)
            expect(permission.id).toMatch(/^\d+$/) // the fake's outbound rpc id, stringified by driver.ts

            // The turn must still be IN FLIGHT. This is the "held" half of the round trip and it is asserted
            // against elapsed time, not against arrival order alone — see PARKED_OBSERVATION_MS.
            await new Promise(r => setTimeout(r, PARKED_OBSERVATION_MS))
            expect(frames.filter(f => f.type === 'result').length).toBe(0)
            expect(frames.filter(f => f.type === 'done').length).toBe(0)

            // The fake asked with the id the driver reported. Proves the correlation runs in BOTH directions
            // (frame id ← request id), so a driver that invented or mangled the id would be caught here
            // rather than downstream where it could be mistaken for a reply-format problem.
            const asks = readEchoLines(echoFile).filter(
                l =>
                    l.dir === 'out-request' &&
                    l.method === 'session/request_permission',
            )
            expect(asks.length).toBe(1)
            expect(String(asks[0].id)).toBe(permission.id)

            return {
                permissionId: permission.id,
                permissionIdx: frames.indexOf(permission),
                frames,
                waitFor,
            }
        }

        /** Poll the echo file for the client's reply to `permissionId`, then hand back its raw `result`. */
        async function awaitReplyResult(
            permissionId: string,
        ): Promise<unknown> {
            await waitForCondition(
                () =>
                    readEchoLines(echoFile).some(
                        l =>
                            l.dir === 'in-response' &&
                            String(l.id) === permissionId,
                    ),
                5_000,
                `a JSON-RPC response echoed for permission request id ${permissionId}`,
            )
            const replies = readEchoLines(echoFile).filter(
                l => l.dir === 'in-response' && String(l.id) === permissionId,
            )
            // One reply, exactly. A second would be a protocol desync: JSON-RPC allows one response per
            // request id, and a duplicate would resolve some LATER outbound call by mistake.
            expect(replies.length).toBe(1)
            expect(replies[0].error).toBeUndefined()
            return replies[0].result
        }

        test('allow: the driver replies {outcome:{outcome:"selected", optionId:<the allow_once option>}} on the correlating rpc id, and only then does the turn settle', async () => {
            const chatId = 'acp-perm-allow-' + Date.now()
            const { permissionId, permissionIdx, frames, waitFor } =
                await driveToParkedPermission(chatId)

            // The frame the user's UI would render. The fake sends the REAL ACP ToolCall shape — `title` +
            // `kind`, no `name` — so this pins what the driver actually does with it. (See this file's
            // trailing "TOOL NAMING" test: the tool chip one frame earlier now carries the SAME name.)
            const permission = expectFrame(frames[permissionIdx], 'permission')
            expect(permission.toolName).toBe(PERM_TOOL_TITLE)
            expect(permission.input).toEqual({
                description: PERM_TOOL_TITLE,
                kind: PERM_TOOL_KIND,
            })

            const respond = CHAT_BACKENDS.cline.respondPermission
            expect(typeof respond).toBe('function')
            respond!(chatId, permissionId, 'allow')

            // THE ASSERTION THIS FILE EXISTS FOR: the exact bytes Bismuth wrote back, read off the far end
            // of the pipe by the agent itself. `outcome` is NESTED under its own key — ACP's
            // RequestPermissionResponse is `{outcome: {outcome:"selected", optionId} | {outcome:"cancelled"}}`
            // — and toEqual (not a field spot-check) means an extra or renamed key fails too.
            expect(await awaitReplyResult(permissionId)).toEqual({
                outcome: { outcome: 'selected', optionId: PERM_ALLOW_ONCE_ID },
            })

            // Independent second proof, through a completely different channel (the driver's own frame
            // stream rather than the echo file): the fake parses the reply it received and reports the
            // outcome back as assistant text. This frame cannot exist unless the reply landed AND parsed.
            const replyText = expectFrame(
                await waitFor(
                    f =>
                        f.type === 'assistant-text' &&
                        f.text.startsWith(FAKE_PERMISSION_REPLY_PREFIX),
                ),
                'assistant-text',
            )
            expect(replyText.text).toContain(PERM_ALLOW_ONCE_ID)
            expect(frames.indexOf(replyText)).toBeGreaterThan(permissionIdx)

            await waitFor(f => f.type === 'done')
            const resultIdx = frames.findIndex(f => f.type === 'result')
            const doneIdx = frames.findIndex(f => f.type === 'done')
            // Ordering, not presence: both must come AFTER the permission frame (they did not exist at all
            // when it arrived — asserted in driveToParkedPermission), and result must precede done.
            expect(resultIdx).toBeGreaterThan(permissionIdx)
            expect(doneIdx).toBeGreaterThan(resultIdx)
            expect(expectFrame(frames[resultIdx], 'result').isError).toBe(false)
            expect(frames.some(f => f.type === 'error')).toBe(false)

            // Answering the same id twice must not put a second response on the wire. driver.ts deletes the
            // pendingPermissions entry before replying; this proves that guard holds, because a duplicate
            // JSON-RPC response would resolve some later outbound call by mistake.
            respond!(chatId, permissionId, 'deny')
            await new Promise(r => setTimeout(r, 200))
            expect(
                readEchoLines(echoFile).filter(
                    l =>
                        l.dir === 'in-response' &&
                        String(l.id) === permissionId,
                ).length,
            ).toBe(1)
        }, 20_000)

        test("deny: the driver replies with the agent's reject_once option on the correlating rpc id, and only then does the turn settle", async () => {
            const chatId = 'acp-perm-deny-' + Date.now()
            const { permissionId, permissionIdx, frames, waitFor } =
                await driveToParkedPermission(chatId)

            const respond = CHAT_BACKENDS.cline.respondPermission
            expect(typeof respond).toBe('function')
            respond!(chatId, permissionId, 'deny')

            // A denial is still a SELECTED outcome in ACP — the user chose the reject option. The optionId
            // is the discriminator, and it is deliberately not equal to its own kind string in the fake, so
            // this cannot pass on the driver having echoed "reject_once" from anywhere else.
            expect(await awaitReplyResult(permissionId)).toEqual({
                outcome: { outcome: 'selected', optionId: PERM_REJECT_ONCE_ID },
            })

            const replyText = expectFrame(
                await waitFor(
                    f =>
                        f.type === 'assistant-text' &&
                        f.text.startsWith(FAKE_PERMISSION_REPLY_PREFIX),
                ),
                'assistant-text',
            )
            expect(replyText.text).toContain(PERM_REJECT_ONCE_ID)
            expect(frames.indexOf(replyText)).toBeGreaterThan(permissionIdx)

            await waitFor(f => f.type === 'done')
            const resultIdx = frames.findIndex(f => f.type === 'result')
            const doneIdx = frames.findIndex(f => f.type === 'done')
            expect(resultIdx).toBeGreaterThan(permissionIdx)
            expect(doneIdx).toBeGreaterThan(resultIdx)
            // A denied tool is not a failed TURN — driver.ts flags isError only for stopReason "refusal".
            expect(expectFrame(frames[resultIdx], 'result').isError).toBe(false)
        }, 20_000)

        test('cancel: when the agent offers no selectable options, the driver replies {outcome:{outcome:"cancelled"}} — carrying no optionId — and the turn still settles', async () => {
            // The ONLY input for which choosePermissionOption (acp/protocol.ts) returns null, and therefore
            // the only way the driver's `{outcome:"cancelled"}` branch is reachable at all.
            process.env.FAKE_ACP_PERMISSION_OPTIONS = 'none'
            const chatId = 'acp-perm-cancel-' + Date.now()
            const { permissionId, permissionIdx, frames, waitFor } =
                await driveToParkedPermission(chatId)

            const respond = CHAT_BACKENDS.cline.respondPermission
            expect(typeof respond).toBe('function')
            // "allow" on purpose: even an APPROVAL degrades to `cancelled` when the agent offered nothing
            // selectable. That is the driver's real behavior, and stating it as an allow makes the claim
            // sharp — the outcome is decided by the agent's option list, not by the user's answer.
            respond!(chatId, permissionId, 'allow')

            const result = await awaitReplyResult(permissionId)
            // toEqual with no `optionId` key: a cancelled outcome that smuggled one along would be a
            // protocol violation an agent could misread as a selection.
            expect(result).toEqual({ outcome: { outcome: 'cancelled' } })

            const replyText = expectFrame(
                await waitFor(
                    f =>
                        f.type === 'assistant-text' &&
                        f.text.startsWith(FAKE_PERMISSION_REPLY_PREFIX),
                ),
                'assistant-text',
            )
            expect(replyText.text).toContain('cancelled')
            expect(replyText.text).not.toContain(PERM_ALLOW_ONCE_ID)
            expect(frames.indexOf(replyText)).toBeGreaterThan(permissionIdx)

            // The turn must still END. A cancelled permission is the case most likely to wedge a chat
            // forever, which is exactly why it is worth an offline test: the fake settles session/prompt
            // with stopReason:"cancelled", and driver.ts treats that as a clean, non-error turn end.
            await waitFor(f => f.type === 'done')
            const resultIdx = frames.findIndex(f => f.type === 'result')
            const doneIdx = frames.findIndex(f => f.type === 'done')
            expect(resultIdx).toBeGreaterThan(permissionIdx)
            expect(doneIdx).toBeGreaterThan(resultIdx)
            expect(expectFrame(frames[resultIdx], 'result').isError).toBe(false)
        }, 20_000)

        // ── TOOL NAMING: one ToolCall, ONE name ──────────────────────────────────────────────────────
        // This started life as a CHARACTERIZATION test pinning a divergence: three functions held three
        // different opinions about how to name the same ACP ToolCall —
        //   driver.ts    name || title || kind || "tool"   → resolved to `title` on real traffic
        //   protocol.ts  name || kind || "tool"            → resolved to `kind`  on real traffic
        //   toolCallInput()  reads {title, kind, rawInput}, no `name` at all — matching the real schema
        // A real ACP ToolCall has NO `name` field, so the first two disagreed on every tool that has a
        // title: within ONE turn the permission modal said "Write foo.txt" and the tool chip said "edit".
        // Both call sites now resolve `title` first, and the tool-use frame carries `kind` alongside so
        // the icon can key off the stable machine token instead of free-form prose. The test below is the
        // regression guard for that unification; it is deliberately driven from a SINGLE wire event, so
        // "the two surfaces agree" is a fact about one tool call rather than a coincidence of two.
        test('one ToolCall, ONE name: the tool chip and the permission prompt agree on `title`, and `kind` rides along for the icon', async () => {
            const chatId = 'acp-perm-naming-' + Date.now()
            const { permissionId, permissionIdx, frames } =
                await driveToParkedPermission(chatId)

            const permission = expectFrame(frames[permissionIdx], 'permission')

            // Correlated on the tool call's OWN id, not "the first tool-use frame in the transcript".
            // Matching by presence is exactly what this file's header disavows: it is not vacuous today
            // (this turn emits one tool_call), but it would silently latch onto the wrong frame the moment
            // a held-prompt mode streams a second one — which the turn-queue and abort modes this
            // mechanism was built for plausibly will. Exactly one, for the same reason as line 206.
            const toolUses = frames.filter(
                f => f.type === 'tool-use' && f.id === PERM_TOOL_CALL_ID,
            )
            expect(toolUses.length).toBe(1)
            const toolUse = expectFrame(toolUses[0], 'tool-use')

            // Same wire event, same tool, ONE name — the ACP `title`, the only human-readable field a real
            // ToolCall carries. Asserted against the literal on both surfaces AND against each other, so
            // neither a regression to `kind` on one side nor a drift to some third string on the other can
            // slip through.
            expect(toolUse.name).toBe(PERM_TOOL_TITLE)
            expect(permission.toolName).toBe(PERM_TOOL_TITLE)
            expect(toolUse.name).toBe(permission.toolName)
            // The three assertions above are only meaningful because these two differ: were the fake's
            // title equal to its kind, a driver that still resolved `kind` would satisfy all of them.
            expect(PERM_TOOL_TITLE).not.toBe(PERM_TOOL_KIND)

            // ...and `kind` is not discarded in the process — it rides along on the frame so ChatView's
            // icon can key off the stable machine token rather than the prose (app/src/chatToolIcon.ts).
            expect(toolUse.kind).toBe(PERM_TOOL_KIND)

            // Settle the turn rather than leaving the fake blocked on a reply through teardown.
            CHAT_BACKENDS.cline.respondPermission!(
                chatId,
                permissionId,
                'allow',
            )
            await awaitReplyResult(permissionId)
        }, 20_000)
    },
)
