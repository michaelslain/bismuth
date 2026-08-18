#!/usr/bin/env bun
// core/test/support/fakeAcpAgent.ts
// A FAKE Agent Client Protocol agent: a standalone script speaking newline-delimited JSON-RPC 2.0
// over its own stdio, exactly the wire shape core/src/chatProviders/acp/driver.ts drives every real
// ACP CLI (cline/gemini/goose/openclaw/claude-code-acp/codex-acp) through. Spawned as a stub binary
// (writeFileSync + chmodSync 0o755, prepended onto PATH under a real agent binary name — mirrors
// relay/test/wrap.test.ts's own "write and chmod a stub binary" pattern) by every
// fakeAcpAgent.ts-driven test file alongside this one.
//
// Tolerant by construction, like every other piece of this harness: a malformed/unrecognized method
// gets a generic empty result rather than crashing the process — a fake agent that dies mid-test
// would just look like a flaky test, not a useful failure signal.
//
// MODES: this file grew one opt-in, env-var-gated mode per coverage gap that no single real,
// installed ACP CLI could prove on its own, each fully decoupled from the others — with none of
// their env vars set, every handler below (in particular handleSessionPrompt's plain branch)
// behaves byte-for-byte as this file's ORIGINAL, mode-free version did. Each mode's own
// rationale/citations/wire details live as a doc comment immediately above that mode's own
// const(s)/section header further down, not here — search this file for its env var to find it:
// FAKE_ACP_MODEL_SHAPE (default mode) / FAKE_ACP_AUTH_GATE / FAKE_ACP_PROMPT_HOLD /
// FAKE_ACP_REJECT_SESSION_LOAD / FAKE_ACP_TOOL_CALL / FAKE_ACP_CRASH_AFTER / FAKE_ACP_NOISE /
// FAKE_ACP_CHUNK_SPLIT.
import { appendFileSync, writeSync } from 'node:fs'
import { createInterface } from 'node:readline'

type JsonRpcMsg = {
    jsonrpc: '2.0'
    id?: number | string
    method?: string
    params?: unknown
    result?: unknown
    error?: unknown
}

/**
 * Optional echo file (a code-review addition — see acpFakeAgent.test.ts's setModel test): when
 * `FAKE_ACP_ECHO_FILE` is set, every inbound JSON-RPC REQUEST (never a notification we send
 * ourselves) is appended to it as one `{method, params}` JSON line, so a test can observe WHICH wire
 * method the driver actually sent — driver.ts's setModel is fire-and-forget with a swallowed
 * `.catch()`, so nothing about its own success/failure is otherwise observable from outside the
 * driver; this file is the only way a test can distinguish "the driver sent
 * session/set_config_option" from "the driver silently sent nothing at all". Best-effort: a write
 * failure (missing dir, permissions) is swallowed rather than crashing the fake agent over what is
 * purely a test-observability channel, not part of the ACP protocol itself.
 */
function echo(method: string, params: unknown): void {
    const path = process.env.FAKE_ACP_ECHO_FILE
    if (!path) return
    try {
        appendFileSync(path, JSON.stringify({ method, params }) + '\n')
    } catch {
        /* best-effort observability only */
    }
}

/**
 * The two echo-file line kinds added by held-prompt mode, for the OTHER two directions the echo file
 * could not previously see: a request THIS fake sent to the client, and the client's response to it.
 *
 * Why they carry a `dir` discriminator while the original inbound-request line does NOT: the
 * original line shape (`{method, params}`, no extra keys) is what acpFakeAgent.test.ts's setModel
 * test already reads, and this task's own contract is that with FAKE_ACP_PROMPT_HOLD unset the fake
 * is byte-identical — so the pre-existing shape is left exactly alone and the new kinds are additive.
 * Both are unreachable unless a mode calls callClient(), which only held-prompt mode does.
 *
 * A response is echoed VERBATIM (whole `result`/`error`, not a summary) because the assertion this
 * exists for is precisely "what bytes did Bismuth write back" — summarizing here would move the
 * interpretation into the fake, where a test could no longer catch it being wrong.
 */
function echoOutRequest(id: number, method: string, params: unknown): void {
    const path = process.env.FAKE_ACP_ECHO_FILE
    if (!path) return
    try {
        appendFileSync(
            path,
            JSON.stringify({ dir: 'out-request', id, method, params }) + '\n',
        )
    } catch {
        /* best-effort observability only */
    }
}

function echoInResponse(msg: JsonRpcMsg): void {
    const path = process.env.FAKE_ACP_ECHO_FILE
    if (!path) return
    try {
        appendFileSync(
            path,
            JSON.stringify({
                dir: 'in-response',
                id: msg.id,
                result: msg.result,
                error: msg.error,
            }) + '\n',
        )
    } catch {
        /* best-effort observability only */
    }
}

function writeLine(obj: unknown): void {
    process.stdout.write(JSON.stringify(obj) + '\n')
}

function respond(id: number | string, result: unknown): void {
    writeLine({ jsonrpc: '2.0', id, result })
}

/** A JSON-RPC error response — the shape cline's own ACP SDK helper (`RequestError.authRequired`)
 *  produces for the auth gate, and the general shape any rejected outbound call takes on the wire
 *  (see ./protocol.ts's AcpRpcError, which driver.ts constructs from exactly these two fields). */
function respondError(
    id: number | string,
    code: number,
    message: string,
): void {
    writeLine({ jsonrpc: '2.0', id, error: { code, message } })
}

function notify(method: string, params: unknown): void {
    writeLine({ jsonrpc: '2.0', method, params })
}

/**
 * DEFAULT MODE (FAKE_ACP_MODEL_SHAPE): "old" (models.availableModels/currentModelId — still-shipping
 * 0.14.1-pinned adapters + cline's own bundled dispatch, and confirmed live against a real `gemini`
 * 0.53.0 in the task that built this) or "new" (configOptions with a "model"-category entry — SDKs
 * ~0.20+). Defaults to "new" so a caller that forgets to set the env var still gets a valid,
 * well-formed session/new rather than silently falling back to neither shape. Has no dedicated
 * section header (unlike every mode below) since it's this file's ORIGINAL, always-on behavior —
 * every mode below is layered on top of it, not an alternative to it.
 *
 * WHY A FAKE AGENT AT ALL (not just another real-CLI mocked test): the driver's model-shape
 * version-skew branch (./protocol.ts's detectModelShape — SDKs ~0.20+ report `configOptions` with a
 * "model"-category entry; older/still-shipping adapters instead report the OLD
 * `models.availableModels`/`currentModelId` shape) can only be exercised by controlling BOTH shapes
 * from ONE place. No single real CLI ships both — a real agent is pinned to whichever SDK generation
 * it happens to bundle — so a real-CLI test can only ever prove ONE branch. This script proves both,
 * selected per-process via this env var, because the driver spawns a FRESH child per chat session
 * and reads process.env at spawn time (chatProviders/acp/driver.ts's spawnAcpProcess ->
 * claudeSpawnEnv(process.env, "chat") — a plain spread, verified in claudeMocked.test.ts's own
 * finding for the sibling Claude driver).
 *
 * SCOPE: the original version of this file covered exactly these driver verbs —
 * initialize, session/new (both model shapes), session/prompt (a streamed
 * session/update + a settling response), plus enough of session/set_config_option +
 * session/set_model to prove setModel/setEffort dispatch to the RIGHT wire method for each shape.
 * Every mode below is additive on top of that base.
 */
const modelShape = process.env.FAKE_ACP_MODEL_SHAPE === 'old' ? 'old' : 'new'

/** Text used to prove a real turn round-tripped through THIS fake, distinguishable from any real
 *  aimock fixture text (see core/test/fixtures/llm/basic-turn.json's "Hello!") so a test asserting on
 *  it can never be fooled by a stray real mock server accidentally still running. */
const FAKE_TURN_TEXT = 'Hello from the fake ACP agent'

/**
 * CLINE AUTH-GATE MODE (added for the "close the cline coverage gap" task — see
 * clineAuthFakeAgent.test.ts): opt-in via FAKE_ACP_AUTH_GATE=cline, decoupled from the model-shape
 * logic above so acpFakeAgent.test.ts's existing three tests (which never set this var) are
 * unaffected byte-for-byte. Unset (the default, what those three pre-existing tests get) reproduces
 * this fake's ORIGINAL behavior byte-for-byte: no gate, empty authMethods. "cline" reproduces cline
 * 3.0.47's REAL ACP auth surface, read from its own compiled binary (`npm install cline@3.0.47`,
 * `strings`'d the bundled Bun executable at bin/.cline — same technique agents.ts's own header
 * already used for this binary):
 *   - `initialize`'s authMethods, verified verbatim from the minified source's own
 *     `var B=[{id:"cline",name:"Sign in with Cline"},{id:"openai-codex",name:"Sign in with ChatGPT
 *     Subscription"}]` (this array is BOTH the authMethods list AND the only valid `authenticate`
 *     methodId allowlist in the real binary).
 *   - `session/new`'s gate, verified verbatim from: `async newSession(z){if(!this.authResult&&
 *     !process.env.CLINE_API_KEY){if(this.authResult=this.tryRestoreAuth(),!this.authResult)throw
 *     $.authRequired(void 0,"Call authenticate before creating a session")}...}` — an ACP SDK
 *     `RequestError.authRequired(data, detail)` helper that renders as JSON-RPC code -32000, message
 *     `"Authentication required: Call authenticate before creating a session"` (confirmed from the
 *     SDK's own `static authRequired(X,Z){return new D(-32000,\`Authentication required${Z?
 *     `: ${Z}`:""}\`,X)}`).
 *   - The REAL bypass this task discovered and live-verified (a real cline 3.0.47 binary, driven
 *     through Bismuth's own unmodified production driver, completed a full ACP turn against a local
 *     mock LLM this way — see backendEnv.ts's `cline` case + clineMocked.test.ts's own "real E2E"
 *     block): `process.env.CLINE_API_KEY`, read at newSession() time, unconditionally skips the
 *     throw above. Bismuth's driver (chatProviders/acp/driver.ts) never calls the ACP `authenticate`
 *     method at all (grep confirms no `call(s, "authenticate", ...)` anywhere in that file) — so the
 *     only faithful way for THIS fake to model "the gate is satisfied" is the exact same shape the
 *     real binary itself offers: an env var read fresh at THIS process's own spawn time,
 *     FAKE_ACP_CLINE_AUTHED, standing in for CLINE_API_KEY. This is not invented — it mirrors a real,
 *     cited mechanism 1:1, chosen because it is the only bypass that exists at all.
 *
 * SCOPE LIMIT of this mode (a code-review finding, recorded explicitly so nobody mistakes this for
 * broader coverage than it is): this mode reproduces cline's AUTH surface only. Once the gate is
 * open, `handleSessionNew` below falls through to the SAME generic old/new-model-shape logic
 * FAKE_ACP_MODEL_SHAPE already drives (this file's own hand-built, single-selector configOptions) —
 * NOT cline's real, quirkier `provider`-then-`model` `configOptions` ordering, in which a "provider"
 * selector precedes the true "model" selector under the SAME `category:"model"`. That ordering bug
 * was fixed on 2026-08-01 (protocol.ts's `pickModelOption`) and is now covered directly, from the
 * captured cline payload, by acpProtocol.test.ts — so this fake still does not reproduce it, and
 * still does not need to.
 * (Historical note, because it is the reason this file was wrong for so long: the earlier version
 * of this comment asserted cline's provider options were `{value, name}` while its MODEL options
 * were `{id, name}`, and this fake's own fixtures were built to match. Driving the real binaries
 * showed BOTH are `{value, name}` — no ACP agent has ever emitted `id` on a select option — so the
 * fixtures below were green against a shape that does not exist. They now use `{value, name}`.)
 */
const authGate = process.env.FAKE_ACP_AUTH_GATE === 'cline' ? 'cline' : 'none'

/** Mirrors real cline's `process.env.CLINE_API_KEY` bypass — see authGate's own doc comment above.
 *  Only consulted when authGate is "cline"; irrelevant (and expected unset) otherwise. */
const clineAuthed = authGate === 'cline' && !!process.env.FAKE_ACP_CLINE_AUTHED

/** Verbatim from cline 3.0.47's own `var B=[...]` — see authGate's own doc comment above for the
 *  citation. Real cline uses this SAME array as both `initialize`'s authMethods AND
 *  `authenticate`'s methodId allowlist; this fake only needs the authMethods half (the driver never
 *  calls `authenticate` — see authGate's doc comment). */
const CLINE_AUTH_METHODS = [
    { id: 'cline', name: 'Sign in with Cline' },
    { id: 'openai-codex', name: 'Sign in with ChatGPT Subscription' },
]

// ── Held-prompt mode ─────────────────────────────────────────────────────────────────────────────

/**
 * HELD-PROMPT MODE (added for the "cover the permission request→response round-trip" task — see
 * acpPermissionFakeAgent.test.ts): opt-in via FAKE_ACP_PROMPT_HOLD, the same shape as the two modes
 * above, and likewise fully decoupled — with the var unset, every line below behaves byte-for-byte
 * as it did before (verified by replaying an identical stdin script through the pre-change and
 * post-change files and diffing stdout).
 *
 * The capability it adds is deliberately GENERIC, not permission-specific, because four separate
 * coverage gaps all need the same one thing and none of them can be built without it: a
 * `session/prompt` that does NOT settle synchronously. Before this, `handleSessionPrompt` streamed
 * one update and immediately responded, so the prompt's request/response window was ~0ms wide —
 * there was no interval during which a test could observe a turn in flight, queue behind it, cancel
 * it, or answer a question inside it. Three pieces make that window openable:
 *   1. `callClient()` — the fake can now make JSON-RPC REQUESTS of its own into the client and await
 *      the reply. Previously this file was reply-only (it answered the driver's requests and pushed
 *      notifications; it never spoke first), so the entire agent→client request direction of ACP —
 *      session/request_permission, fs/*, terminal/*, elicitation/* — was unreachable from here.
 *   2. Inbound RESPONSE routing in `handleLine` — the counterpart to (1). The old parser dropped any
 *      line without a `method` field on the floor, which is exactly what a JSON-RPC response is.
 *   3. `heldPrompts` + `settlePrompt()` — a registry of prompts whose `session/prompt` response has
 *      been withheld, settled exactly once, by whatever event a given mode says settles it.
 * A future turn-queue / abort / resume / never-terminating-turn test needs only a new `promptHold`
 * value plus its own async runner; none of them should have to touch (1)-(3) again.
 *
 * "none" (unset — the default every pre-existing test gets, byte-identical to this file's original
 * behavior), "permission", or "queue" (see QUEUE_HOLD_MS's own doc comment below, "QUEUE-HOLD
 * MODE"). A future resume/never-settling-variant test adds its own value here and its own runner
 * below; nothing else in this file needs to change for it.
 *
 * The one mode implemented here, FAKE_ACP_PROMPT_HOLD=permission, models the real ACP permission
 * handshake (agent-client-protocol's `session/request_permission`, whose response type is
 * `RequestPermissionResponse { outcome: {outcome:"cancelled"} | {outcome:"selected", optionId} }` —
 * note the field is NESTED under its own name, which is what driver.ts's respondPermission builds):
 *   tool_call update → session/request_permission → (WAIT) → agent_message_chunk naming the received
 *   outcome → settle session/prompt.
 * Nothing settles that prompt except a real, parseable reply landing on this process's stdin, which
 * is the property that makes the test non-vacuous: a wrong rpc id, a malformed outcome, or no reply
 * at all all produce the same observable result — no `done`, and a test timeout.
 */
const promptHold =
    process.env.FAKE_ACP_PROMPT_HOLD === 'permission'
        ? 'permission'
        : process.env.FAKE_ACP_PROMPT_HOLD === 'queue'
          ? 'queue'
          : 'none'

/**
 * SESSION-RESUME MODE (see acpResumeFakeAgent.test.ts): opt-in via FAKE_ACP_REJECT_SESSION_LOAD
 * (any truthy value) — makes `session/load` reject instead of falling through to the `default:`
 * case's plain `respond(id, {})`, which is exactly what it still gets when this var is unset.
 * Forces driver.ts's `session/load` -> `session/resume` fallback (protocol.ts's
 * `isMethodNotFoundError`) to actually run.
 *
 * The rejection's JSON-RPC code and message are independently overridable
 * (FAKE_ACP_REJECT_SESSION_LOAD_CODE / _MESSAGE, default -32601 / "Method not found:
 * session/load"): `isMethodNotFoundError` is an OR of a numeric-code check and a message regex, so
 * a fixed pairing only proves "at least one arm fired". Varying each independently lets a test pin
 * the code arm (right code, non-matching message) and the message arm (wrong code, matching
 * message) separately.
 *
 * `session/resume` gets no dedicated handler: a rejected `session/load` falls through to the same
 * `default:` case it always did, and gets the same plain `{}` — all driver.ts needs from it (it
 * sets `s.sessionId` from the caller's own id either way, never from either response).
 *
 * Unset (default): `session/load` is unhandled, falls to `default:`'s plain `respond(id, {})`.
 * Truthy: rejects with `rejectSessionLoadCode`/`rejectSessionLoadMessage` below, each independently
 * overridable so a test can pin either arm of `isMethodNotFoundError` on its own.
 */
const rejectSessionLoad = !!process.env.FAKE_ACP_REJECT_SESSION_LOAD
const rejectSessionLoadCode =
    process.env.FAKE_ACP_REJECT_SESSION_LOAD_CODE !== undefined
        ? Number(process.env.FAKE_ACP_REJECT_SESSION_LOAD_CODE)
        : -32601
const rejectSessionLoadMessage =
    process.env.FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE ??
    'Method not found: session/load'

// ── Tool-call mode ───────────────────────────────────────────────────────────────────────────────

/**
 * TOOL-CALL MODE (task 12, "live tool-use, both halves" — see acpToolUseFakeAgent.test.ts): opt-in
 * via FAKE_ACP_TOOL_CALL (any truthy value), decoupled from every mode above the same way each of
 * those is decoupled from the others — with the var unset, `handleSessionPrompt`'s plain branch
 * (promptHold === "none") is completely unchanged, byte-for-byte.
 *
 * Reproduces the plain (non-permission, non-queue) shape of a real ACP tool call round trip: one
 * `tool_call` notification (status "in_progress"), then one `tool_call_update` (status
 * "completed", carrying a `{type:"content", content:{type:"text", text}}` entry — the same
 * AcpToolCallContentEntry shape ./protocol.ts's toolCallContentText already expects), THEN the
 * turn's own `agent_message_chunk` + `session/prompt` response — mirroring the real order a live
 * agent uses (announce the call, resolve it, THEN keep talking), confirmed against a real `goose`
 * acp session driven through an actual Bismuth MCP tool call (`bismuth__bismuth_docs_list`, goose's
 * own MCP-namespaced tool name): the real wire capture showed `tool_call`, then `tool_call_update`, then
 * the `session/prompt` response, in that literal order on stdout, with no `kind` field at all (goose
 * never sends one — unlike this fake, which does, so together the two are the exercised case for
 * both `kind` present and absent). Deliberately NOT reusing HELD-PROMPT MODE's `runHeldPermissionPrompt`/
 * `runHeldQueueTurn` machinery: this mode never withholds the `session/prompt` response and never
 * calls INTO the client (no session/request_permission, no callClient) — a plain, synchronous
 * two-notification-then-respond sequence is all Task 12's ordering assertions
 * (tool-use → tool-result, equal ids, tool-result strictly after tool-use, exactly one
 * tool-result per id, result after both) need, and folding in the held-prompt registry would only
 * add unrelated async machinery this mode doesn't use.
 */
const toolCallMode = !!process.env.FAKE_ACP_TOOL_CALL

/** Fixed id/title/kind/result text for tool-call mode's one synthetic call. `title`+`kind`-only
 *  (no `name`) is deliberately the real ACP ToolCall shape — see PERM_TOOL_TITLE's own comment for
 *  why that fidelity is what lets a consuming test observe the driver's real naming behavior
 *  (toolCallName: title first, kind last resort, never a `name` field no real ToolCall has).
 *  Distinct id/title/kind/text from every other mode's own constants (PERM_TOOL_*, FAKE_TURN_TEXT,
 *  FAKE_QUEUE_TURN_PREFIX) so a test can never mistake one mode's output for another's. */
const TOOLUSE_TOOL_CALL_ID = 'fake-tool-use-call-1'
const TOOLUSE_TOOL_TITLE = 'Read fake-tool-use-probe.txt'
const TOOLUSE_TOOL_KIND = 'read'
const TOOLUSE_RESULT_TEXT = 'fake tool result: 3 lines read'

/**
 * QUEUE-HOLD MODE (added for the "second message while the first turn is in flight" turn-queue task
 * — see acpQueueFakeAgent.test.ts): opt-in via FAKE_ACP_PROMPT_HOLD=queue, decoupled from every mode
 * above the same way "permission" is decoupled from the base behavior — with the var unset (or set to
 * "permission"), nothing in this section ever runs.
 *
 * Deliberately NOT the permission round-trip reused as-is, even though that mode COULD technically
 * hold a turn open long enough for a queue test too (this file's own reasoning about `runOrQueue`
 * applies regardless of which mode holds a turn): a turn-queue test's whole point is the DRIVER's own
 * client-side queue (core/src/chatProviders/acp/driver.ts's `runOrQueue`/`s.queue`) — nothing about
 * tool calls, permission options, or an agent-initiated request into the client. Folding permission
 * semantics in here would (a) add unrelated `tool_call`/`session/request_permission` lines to the
 * echo file a queue test would just have to filter back out, and (b) require the TEST to answer a
 * permission prompt via `respondPermission` to release EVERY held turn, when the actual thing under
 * test is "does the driver even send a queued turn's `session/prompt` before the prior one settled",
 * not "can a user answer a permission prompt". So this mode settles itself, on a plain internal timer
 * (`QUEUE_HOLD_MS`) — no external signal is needed OR wanted: from this fake's own point of view there
 * is nothing to coordinate with the test beyond "don't reply immediately", because the interesting
 * behavior being proven is entirely on the CLIENT side (whether a second/third `sendMessage` gets
 * queued instead of dispatched while a turn is active, and whether the driver dispatches them
 * afterward IN THE ORDER THEY WERE SUBMITTED). A held turn embeds the ORIGINAL prompt text it
 * received into its own settling `agent_message_chunk` (`FAKE_QUEUE_TURN_PREFIX` below), giving a
 * turn-queue test a SECOND, independent proof channel beyond the echo file — mirrors permission mode's
 * own `FAKE_PERMISSION_REPLY_PREFIX` chunk, which exists for the identical reason (prove the round
 * trip through the driver's OWN frame stream, not only through file-based instrumentation).
 *
 * How long "queue" mode holds each `session/prompt` open before auto-settling. Configurable via
 * `FAKE_ACP_QUEUE_HOLD_MS` purely so a consuming test can tune the window without editing this
 * file; falls back to a value comfortably larger than any local round trip (spawn→write→readline
 * →respond, all on one machine) so "still held" is never a coincidence of scheduling. Irrelevant
 * (and never read) unless promptHold === "queue".
 */
const QUEUE_HOLD_MS = (() => {
    const raw = Number(process.env.FAKE_ACP_QUEUE_HOLD_MS)
    // 2000 matches acpQueueFakeAgent.test.ts's own pinned value (that test always sets the env var
    // explicitly, so this fallback only matters if a future consumer forgets to) — kept in sync so the
    // two numbers don't drift apart for no reason.
    return Number.isFinite(raw) && raw > 0 ? raw : 2_000
})()

/** Prefix of the `agent_message_chunk` "queue" mode emits when a held turn settles, carrying the
 *  ORIGINAL prompt text it received — see QUEUE_HOLD_MS's own doc comment above for why (a second,
 *  independent proof channel of ordering/content beyond the echo file). Distinct from every other
 *  mode's own marker text (`FAKE_TURN_TEXT`, `FAKE_PERMISSION_REPLY_PREFIX`) so a test can never
 *  mistake one for another. */
const FAKE_QUEUE_TURN_PREFIX = 'fake-acp queued-turn echo: '

/** Which option list this fake offers on `session/request_permission`. "full" (the default) offers
 *  all four real PermissionOptionKind values. "none" offers an EMPTY array — not an arbitrary edge
 *  case but the ONLY input for which the driver's choosePermissionOption (acp/protocol.ts) returns
 *  null, and therefore the only way to reach its `{outcome:"cancelled"}` reply branch at all. */
const permissionOptionSet =
    process.env.FAKE_ACP_PERMISSION_OPTIONS === 'none' ? 'none' : 'full'

/** The tool this fake asks permission for. Deliberately carries `title` + `kind` and NO `name`,
 *  which is the real ACP `ToolCall` shape (agent-client-protocol's ToolCall has no `name` field at
 *  all — see acp/protocol.ts's own `toolCallInput(u: {title, kind})`, which encodes that same
 *  understanding). Keeping the fake honest here is what lets acpPermissionFakeAgent.test.ts observe
 *  the driver's real naming behavior rather than a shape no agent would ever send. */
const PERM_TOOL_CALL_ID = 'fake-tool-call-1'
const PERM_TOOL_TITLE = 'Write fake-permission-probe.txt'
const PERM_TOOL_KIND = 'edit'

/** Verbatim the four `PermissionOptionKind` values from the ACP schema. The optionIds are
 *  deliberately NOT equal to their kinds, so a test asserting an optionId came back cannot be
 *  satisfied by the driver having echoed the kind (or any other field) by accident. */
const PERM_OPTIONS = [
    { optionId: 'fake-opt-allow-once', name: 'Allow once', kind: 'allow_once' },
    {
        optionId: 'fake-opt-allow-always',
        name: 'Always allow',
        kind: 'allow_always',
    },
    { optionId: 'fake-opt-reject-once', name: 'Reject', kind: 'reject_once' },
    {
        optionId: 'fake-opt-reject-always',
        name: 'Always reject',
        kind: 'reject_always',
    },
]

/** Prefix of the agent_message_chunk this fake emits AFTER a permission reply lands, carrying the
 *  outcome it actually parsed out of that reply. Distinct from FAKE_TURN_TEXT so a test can never
 *  mistake one for the other, and emitted only post-reply so its mere presence is itself ordering
 *  evidence. */
const FAKE_PERMISSION_REPLY_PREFIX = 'fake-acp permission reply: '

/** Outbound request ids for calls THIS fake makes into the client. JSON-RPC gives each direction
 *  its own id space (the driver's own minter starts at 0 — see protocol.ts's createIdMinter), so
 *  starting at 1000 is not required for correctness; it just makes an echo-file transcript
 *  unambiguous to read at a glance. */
let nextOutboundId = 1000

/** Resolvers for in-flight outbound calls, keyed by the id we sent. */
const pendingClientCalls = new Map<number, (msg: JsonRpcMsg) => void>()

/**
 * Send a JSON-RPC REQUEST to the client and resolve with its RAW response envelope (never rejects —
 * a fake agent that throws mid-turn would surface as an unexplained flake rather than a useful
 * failure). Resolves with the whole message, not just `result`, so a caller can distinguish a
 * result from an error reply, and so the echo file and the caller see exactly the same bytes.
 *
 * If the client never replies, this promise simply never settles — which is the intended failure
 * mode: whatever prompt is held behind it stays held, no `done` frame is ever produced, and the
 * test times out. That is the property that makes the round-trip assertion non-vacuous.
 */
function callClient(method: string, params: unknown): Promise<JsonRpcMsg> {
    const id = nextOutboundId++
    return new Promise<JsonRpcMsg>(resolve => {
        pendingClientCalls.set(id, resolve)
        echoOutRequest(id, method, params)
        writeLine({ jsonrpc: '2.0', id, method, params })
    })
}

/** `session/prompt` requests whose response has been deliberately withheld, keyed by their JSON-RPC
 *  id. The registry is what makes "a turn is in flight right now" an observable, controllable state
 *  instead of a ~0ms window. */
const heldPrompts = new Map<number | string, { sessionId: string }>()

/** Settle a held prompt exactly once. Idempotent by construction (the map delete IS the guard), so
 *  two racing settle paths — e.g. a permission reply landing at the same moment as a session/cancel
 *  — can never produce two JSON-RPC responses for one request id, which would desync the driver's
 *  pendingCalls map for the rest of the session. */
function settlePrompt(id: number | string, stopReason: string): void {
    if (!heldPrompts.delete(id)) return
    respond(id, { stopReason })
}

/**
 * The permission round-trip, start to finish. Emits a tool_call update first (a real agent announces
 * the tool before asking to run it), then asks, then WAITS — the awaited reply is the only thing
 * that can advance this function — then reports back what it received and settles the turn.
 *
 * The post-reply agent_message_chunk names the outcome the fake actually parsed, so a test gets a
 * second, independent proof of the round-trip through a completely different channel than the echo
 * file: the driver's own ChatFrame stream.
 */
async function runHeldPermissionPrompt(
    promptId: number | string,
    sessionId: string,
): Promise<void> {
    heldPrompts.set(promptId, { sessionId })
    notify('session/update', {
        sessionId,
        update: {
            sessionUpdate: 'tool_call',
            toolCallId: PERM_TOOL_CALL_ID,
            title: PERM_TOOL_TITLE,
            kind: PERM_TOOL_KIND,
            status: 'pending',
        },
    })

    const reply = await callClient('session/request_permission', {
        sessionId,
        toolCall: {
            toolCallId: PERM_TOOL_CALL_ID,
            title: PERM_TOOL_TITLE,
            kind: PERM_TOOL_KIND,
        },
        options: permissionOptionSet === 'none' ? [] : PERM_OPTIONS,
    })

    // THE ABORT-GAP FIX (see session/cancel's own comment below for the other half): if this promptId
    // is no longer in heldPrompts, it was already force-settled elsewhere WHILE this function was
    // parked on the await above — the only such path today is session/cancel's own
    // `settlePrompt(heldId, "cancelled")` loop. That means the turn already ended (its `result`+`done`
    // are already emitted) and there is nothing left to report: emitting the agent_message_chunk below
    // would be exactly the stray chunk on an already-cancelled turn this fix exists to prevent, whether
    // `reply` came from session/cancel's own synthetic drain (immediate) or a genuinely late real
    // reply landing after the cancel (delayed) — both resolve THIS SAME await, and both must be
    // treated identically: silently unwind, nothing more. `heldPrompts` (not a separate "settled"
    // flag) is the single source of truth here because settlePrompt's own delete already IS that
    // truth — see its idempotency comment.
    if (!heldPrompts.has(promptId)) return

    // Read the real ACP RequestPermissionResponse shape: the tagged union lives NESTED under its own
    // `outcome` key (`{outcome:{outcome:"selected", optionId}}`), which is exactly what driver.ts's
    // respondPermission writes. Read tolerantly — a malformed reply must show up as "the fake reported
    // an unrecognized outcome", never as a crash that looks like a flake.
    const result =
        reply.result && typeof reply.result === 'object'
            ? (reply.result as Record<string, unknown>)
            : {}
    const outer =
        result.outcome && typeof result.outcome === 'object'
            ? (result.outcome as Record<string, unknown>)
            : {}
    const outcome =
        typeof outer.outcome === 'string' ? outer.outcome : 'unrecognized'
    const optionId = typeof outer.optionId === 'string' ? outer.optionId : ''

    notify('session/update', {
        sessionId,
        update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
                type: 'text',
                text: `${FAKE_PERMISSION_REPLY_PREFIX}${JSON.stringify({ outcome, optionId })}`,
            },
        },
    })

    // A "selected" outcome means the user answered (allow OR deny — both are a selection); the turn
    // then ends normally. "cancelled" means no option could be selected at all, which a real agent
    // reports as a cancelled turn — and which exercises driver.ts's own stopReason:"cancelled" branch
    // (that branch treats it as a clean, non-error turn end).
    settlePrompt(promptId, outcome === 'selected' ? 'end_turn' : 'cancelled')
}

/** Pull the plain text out of a `session/prompt` request's own `params.prompt` content-block array —
 *  the same shape driver.ts's `runTurn` builds (`[{type:"text", text}, ...]`, plus any images this
 *  fake doesn't need to read). Used only by "queue" hold mode to echo back what it actually received.
 *  Tolerant: an unrecognized shape yields `""` rather than throwing — a fake agent that crashes over
 *  its OWN instrumentation would look like an unrelated flake, never a useful signal. */
function extractPromptText(params: unknown): string {
    const p =
        params && typeof params === 'object'
            ? (params as Record<string, unknown>)
            : {}
    const blocks = Array.isArray(p.prompt) ? p.prompt : []
    const firstText = blocks.find(
        b =>
            b &&
            typeof b === 'object' &&
            (b as Record<string, unknown>).type === 'text',
    ) as Record<string, unknown> | undefined
    return typeof firstText?.text === 'string' ? firstText.text : ''
}

/**
 * "queue" hold mode's own async runner (see QUEUE_HOLD_MS's own doc comment above, "QUEUE-HOLD
 * MODE", for why it is deliberately simpler than `runHeldPermissionPrompt`: no tool call, no client
 * round trip, just a turn that doesn't settle immediately). `promptText` is captured in THIS call's
 * own closure at request time, not re-read from any shared/mutable state later — the only way to
 * guarantee a turn settling after its own delay reports back the text it was actually asked to
 * handle, not whatever happens to be "current" by the time its timer fires.
 */
async function runHeldQueueTurn(
    promptId: number | string,
    sessionId: string,
    promptText: string,
): Promise<void> {
    heldPrompts.set(promptId, { sessionId })
    await new Promise(r => setTimeout(r, QUEUE_HOLD_MS))
    // Settled elsewhere while we waited (e.g. a session/cancel drained every held prompt) — nothing
    // left to report, same guard shape as runHeldPermissionPrompt's own post-await check.
    if (!heldPrompts.has(promptId)) return
    notify('session/update', {
        sessionId,
        update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
                type: 'text',
                text: `${FAKE_QUEUE_TURN_PREFIX}${promptText}`,
            },
        },
    })
    settlePrompt(promptId, 'end_turn')
}

// ── Crash / noise / chunk-split modes ───────────────────────────────────────────────────────────
// Task 13, "crash mid-turn, malformed output, chunk-boundary framing" — see
// acpFramingFakeAgent.test.ts. Three independent opt-in modes sharing this file's one
// stdout-writing seam, each documented individually below (right above its own const) the same way
// every mode above documents itself. Each is inert exactly like every mode above — with none of
// their three env vars set, `handleSessionPrompt`'s plain branch is byte-for-byte unchanged.

/**
 * CRASH MODE: FAKE_ACP_CRASH_AFTER=prompt makes the fake emit ONE session/update, then
 * process.exit(1) — never responding to that session/prompt request at all. Proves driver.ts's
 * watchExit reports the turn as a single result{isError:true}+done+error{code:"exit"}, and that
 * runTurn's own identity guard (`sessions.get(s.id) !== s`) stops a second, duplicate result/done
 * once its now-rejected session/prompt call settles after watchExit already tore the session down.
 */
const crashAfter =
    process.env.FAKE_ACP_CRASH_AFTER === 'prompt' ? 'prompt' : 'none'

/**
 * NOISE MODE: FAKE_ACP_NOISE interleaves plain-text and near-JSON-RPC noise (valid JSON, but
 * missing "jsonrpc":"2.0") around two real session/update notifications, all before this request's
 * own response. Proves protocol.ts's parseJsonRpcLine tolerates both — a real CLI's own startup
 * banner must never kill a turn — while the two real frames and the turn's own `done` still arrive.
 */
const noiseMode = !!process.env.FAKE_ACP_NOISE

/**
 * CHUNK-SPLIT MODE: FAKE_ACP_CHUNK_SPLIT writes ONE large session/update's JSON-RPC line as raw
 * bytes across several fs.writeSync() calls (see runChunkSplitUpdate below), paced with a real
 * delay so the driver's read loop sees them as separate stream chunks, with one split point landing
 * INSIDE the 4-byte UTF-8 encoding of an emoji — an ASCII-only split proves nothing here (any
 * decoder survives that). `{stream:true}` is required to carry a partial multibyte sequence across
 * a chunk boundary; without it, each `decode()` call treats its own chunk as complete and the
 * dangling/orphaned bytes each decode to their own replacement character — which is what a
 * mid-multibyte split can catch and an ASCII-only split cannot.
 */
const chunkSplitMode = !!process.env.FAKE_ACP_CHUNK_SPLIT

/** Distinct from every other mode's own marker text (FAKE_TURN_TEXT, FAKE_QUEUE_TURN_PREFIX, …) so
 *  a test can never mistake one mode's output for another's. */
const NOISE_TEXT_A = 'fake-acp noise-mode message A'
const NOISE_TEXT_B = 'fake-acp noise-mode message B'
/** Embedded in a near-JSON-RPC noise line that is missing "jsonrpc":"2.0". Must never surface as
 *  its own assistant-text frame — if it does, the driver's shape guard (parseJsonRpcLine's own
 *  `jsonrpc !== "2.0"` check) has been lost. */
const NOISE_LEAK_MARKER = 'NOISE-LEAK-SHOULD-NEVER-APPEAR-AS-A-FRAME'

/** A real 4-byte UTF-8 character (F0 9F 98 80) — the one boundary an ASCII-only chunk split can
 *  never exercise. */
const CHUNK_EMOJI = '\u{1F600}'
/** Large enough to comfortably fit several fs.writeSync() fragments either side of the emoji. */
const CHUNK_PAYLOAD_TEXT = `chunk-split-payload-start-${'x'.repeat(64)}-${CHUNK_EMOJI}-${'y'.repeat(64)}-chunk-split-payload-end`
/** Real delay between CHUNK-SPLIT MODE's fragments — long enough that the OS/runtime reliably
 *  delivers each fs.writeSync() as its own read on the driver's side rather than coalescing them,
 *  short enough not to slow the test. Configurable purely so a consuming test can tune it without
 *  editing this file. */
const CHUNK_SPLIT_DELAY_MS = (() => {
    const raw = Number(process.env.FAKE_ACP_CHUNK_SPLIT_DELAY_MS)
    return Number.isFinite(raw) && raw > 0 ? raw : 25
})()

/** A single JSON-RPC line, written synchronously to fd 1 — used only by CRASH MODE, where the
 *  process dies immediately after, so the usual buffered `process.stdout.write` (this file's
 *  `writeLine`) is not safe to rely on. */
function writeSyncLine(obj: unknown): void {
    writeSync(1, JSON.stringify(obj) + '\n')
}

/** A raw, non-JSON-RPC line — used only by NOISE MODE to simulate a real CLI's own stray stdout
 *  output (a startup banner, a stray log line) interleaved with real protocol traffic. */
function writeRawLine(text: string): void {
    process.stdout.write(text + '\n')
}

/**
 * CHUNK-SPLIT MODE's own runner (see chunkSplitMode's own doc comment above). Builds the one
 * session/update line this mode ever emits, then writes it to fd 1 in byte fragments — two
 * ASCII-range cuts (both of which land BEFORE the emoji for this payload — see the cuts comment
 * below) plus one cut strictly INSIDE the emoji's own 4 bytes — each fragment separated by a real
 * delay so the reading side sees them as distinct stream chunks, not one write() call's worth of
 * data arriving all at once.
 */
async function runChunkSplitUpdate(
    id: number | string,
    sessionId: string,
): Promise<void> {
    const payload =
        JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
                sessionId,
                update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: CHUNK_PAYLOAD_TEXT },
                },
            },
        }) + '\n'
    const bytes = Buffer.from(payload, 'utf8')
    const emojiBytes = Buffer.from(CHUNK_EMOJI, 'utf8') // 4 bytes: F0 9F 98 80
    const emojiStart = bytes.indexOf(emojiBytes)
    if (emojiStart < 0) {
        // A bug in THIS file's own payload construction, not the driver — fail loudly rather than
        // silently sending an unsplit line that would prove nothing.
        throw new Error(
            "fakeAcpAgent: CHUNK_EMOJI bytes not found in CHUNK_PAYLOAD_TEXT's own encoding",
        )
    }
    // Cuts at 0.3 and 0.7 of the line's total byte length, plus emojiStart+2. For THIS payload both
    // fractional cuts land BEFORE the emoji (it sits fairly late in the JSON envelope, after the
    // method/params/sessionId scaffolding), so the actual split is: two ASCII cuts, then one cut
    // strictly INSIDE the emoji's own 4 bytes (after its first 2 of 4) — the split this mode exists
    // for. Nothing splits the tail AFTER the emoji separately; its last 2 bytes and the trailing
    // "y"s/closing text ride in the one final remainder fragment along with everything else past
    // that cut. De-duplicated + sorted so a pathological length can't collapse two cuts into a
    // zero-length fragment.
    const cuts = Array.from(
        new Set([
            Math.floor(bytes.length * 0.3),
            emojiStart + 2,
            Math.floor(bytes.length * 0.7),
        ]),
    ).sort((a, b) => a - b)
    let prev = 0
    for (const cut of cuts) {
        writeSync(1, bytes.subarray(prev, cut))
        prev = cut
        await new Promise(r => setTimeout(r, CHUNK_SPLIT_DELAY_MS))
    }
    writeSync(1, bytes.subarray(prev))
    respond(id, { stopReason: 'end_turn' })
}

let sessionCounter = 0

function handleInitialize(id: number | string): void {
    respond(id, {
        protocolVersion: 1,
        agentCapabilities: {
            loadSession: true,
            promptCapabilities: {
                image: false,
                audio: false,
                embeddedContext: false,
            },
        },
        agentInfo: { name: 'fake-acp-agent', version: '0.0.1' },
        // Empty by default: this fake's session/new never demands an authenticate() first UNLESS
        // FAKE_ACP_AUTH_GATE=cline is set (see authGate's own doc comment above) — the driver itself
        // never calls authenticate() either way (core/src/chatProviders/acp/driver.ts has no
        // authenticate() call at all), so an empty array here is simply honest about what this fake
        // offers by default, not a workaround for anything. In "cline" gate mode, this is cline's own
        // real authMethods verbatim.
        authMethods: authGate === 'cline' ? CLINE_AUTH_METHODS : [],
    })
}

function handleSessionNew(id: number | string): void {
    if (authGate === 'cline' && !clineAuthed) {
        // Verbatim shape of cline 3.0.47's real refusal — see authGate's own doc comment above for both
        // the triggering source line and the SDK helper that renders it as this exact {code, message}.
        respondError(
            id,
            -32000,
            'Authentication required: Call authenticate before creating a session',
        )
        return
    }
    sessionCounter += 1
    const sessionId = `fake-session-${modelShape}-${sessionCounter}`
    if (modelShape === 'old') {
        respond(id, {
            sessionId,
            models: {
                availableModels: [
                    {
                        modelId: 'fake-model-a',
                        name: 'Fake Model A',
                        description: 'old-shape model a',
                    },
                    {
                        modelId: 'fake-model-b',
                        name: 'Fake Model B',
                        description: 'old-shape model b',
                    },
                ],
                currentModelId: 'fake-model-a',
            },
        })
    } else {
        respond(id, {
            sessionId,
            // Select OPTIONS are `{value, name}` — the spec's `SessionConfigSelectOption`, and what every
            // real agent driven against a local mock emits: verbatim captures off cline 3.0.48, `goose acp`,
            // and `openclaw acp` each showed every select option shaped `{value, name}`, never `{id, name}`.
            // These were
            // `{id, name}` until 2026-08-01: a shape NO shipping ACP agent has ever emitted, which made
            // this fake certify a fiction — detectModelShape's `configOptions` branch filtered on `.id`,
            // so it passed here while returning an empty model list for every real binary. `id` on the
            // enclosing SELECTOR is correct and unchanged (that is what session/set_config_option
            // addresses); only the option elements were wrong.
            configOptions: [
                {
                    id: 'model-config',
                    name: 'Model',
                    category: 'model',
                    type: 'select',
                    options: [
                        { value: 'fake-model-x', name: 'Fake Model X' },
                        { value: 'fake-model-y', name: 'Fake Model Y' },
                    ],
                    currentValue: 'fake-model-x',
                },
                {
                    id: 'effort-config',
                    name: 'Thinking',
                    category: 'thought_level',
                    type: 'select',
                    options: [
                        { value: 'low', name: 'Low' },
                        { value: 'high', name: 'High' },
                    ],
                    currentValue: 'low',
                },
            ],
        })
    }
}

function handleSessionPrompt(id: number | string, params: unknown): void {
    const rawSessionId =
        (params &&
            typeof params === 'object' &&
            'sessionId' in params &&
            typeof (params as { sessionId: unknown }).sessionId === 'string' &&
            (params as { sessionId: string }).sessionId) ||
        'unknown'
    // Every branch of the expression above yields a string at runtime (a failed guard short-circuits
    // to `false`, which the `|| "unknown"` then replaces), but TS widens the leading `params &&` to
    // `{}` because `params` is `unknown` — so its STATIC type is `string | {}`. The original code never
    // noticed: it only passed the value to `notify(…: unknown)`. Narrow once here, explicitly, rather
    // than casting at the one new call site that does want a string.
    const sessionId: string =
        typeof rawSessionId === 'string' ? rawSessionId : 'unknown'
    if (promptHold === 'permission') {
        // Hand off to the async runner and return — the JSON-RPC response for THIS request is withheld
        // until something settles it. The `void` is deliberate: handleLine is a sync readline callback,
        // and the runner already cannot reject (callClient never rejects).
        void runHeldPermissionPrompt(id, sessionId)
        return
    }
    if (promptHold === 'queue') {
        // Same deliberate `void` as the permission branch above — handleLine is a sync readline callback,
        // and this runner's own timer-based settle path cannot reject.
        void runHeldQueueTurn(id, sessionId, extractPromptText(params))
        return
    }
    if (crashAfter === 'prompt') {
        // See crashAfter's own doc comment above ("CRASH MODE"). Emit exactly one update, then die —
        // this session/prompt request never gets a response at all.
        writeSyncLine({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
                sessionId,
                update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: FAKE_TURN_TEXT },
                },
            },
        })
        process.exit(1)
    }
    if (noiseMode) {
        // See noiseMode's own doc comment above ("NOISE MODE"). Plain-text noise (pins
        // parseJsonRpcLine's JSON.parse tolerance), a real frame, near-JSON-RPC noise missing
        // "jsonrpc":"2.0" (pins its shape guard), then the second real frame — all before this
        // request's own response.
        writeRawLine(
            'Fake ACP CLI v0.9.3 starting up, connecting to upstream...',
        )
        notify('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: NOISE_TEXT_A },
            },
        })
        writeRawLine(
            JSON.stringify({
                method: 'session/update',
                params: {
                    sessionId,
                    update: {
                        sessionUpdate: 'agent_message_chunk',
                        content: { type: 'text', text: NOISE_LEAK_MARKER },
                    },
                },
            }),
        )
        notify('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: NOISE_TEXT_B },
            },
        })
        respond(id, { stopReason: 'end_turn' })
        return
    }
    if (chunkSplitMode) {
        // See chunkSplitMode's own doc comment above ("CHUNK-SPLIT MODE"). Async (real delays between
        // fragments) — the JSON-RPC response for THIS request is sent by the runner itself once every
        // fragment is out.
        void runChunkSplitUpdate(id, sessionId)
        return
    }
    if (toolCallMode) {
        // See toolCallMode's own doc comment above ("TOOL-CALL MODE"). Synchronous — nothing is
        // withheld, unlike held-prompt mode's runners: announce the call, resolve it, THEN keep
        // talking, all before this request's own response — the same order confirmed live against a
        // real goose ACP tool call.
        notify('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'tool_call',
                toolCallId: TOOLUSE_TOOL_CALL_ID,
                title: TOOLUSE_TOOL_TITLE,
                kind: TOOLUSE_TOOL_KIND,
                status: 'in_progress',
            },
        })
        notify('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: TOOLUSE_TOOL_CALL_ID,
                status: 'completed',
                content: [
                    {
                        type: 'content',
                        content: { type: 'text', text: TOOLUSE_RESULT_TEXT },
                    },
                ],
            },
        })
    }
    notify('session/update', {
        sessionId,
        update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: FAKE_TURN_TEXT },
        },
    })
    respond(id, { stopReason: 'end_turn' })
}

/** Acks BOTH setModel dispatch targets driver.ts can send (session/set_config_option for the "new"
 *  shape, session/set_model for the "old" one) — see driver.ts's setModel, which branches on
 *  s.modelShape.shape to pick exactly one of these per session. Which one actually arrived (and
 *  with what params) is observable via the FAKE_ACP_ECHO_FILE mechanism above, not tracked here. */
function handleSetConfigOption(id: number | string): void {
    respond(id, {})
}

function handleSetModelOld(id: number | string): void {
    respond(id, {})
}

function handleLine(raw: string): void {
    const trimmed = raw.trim()
    if (!trimmed) return
    let msg: JsonRpcMsg
    try {
        msg = JSON.parse(trimmed)
    } catch {
        return // non-JSON noise — never crash the fake over a stray line
    }
    if (!msg || msg.jsonrpc !== '2.0') return
    // A RESPONSE to a request THIS fake sent (no `method`, has an `id` and a result/error). The
    // original parser dropped these at the `typeof msg.method !== "string"` guard below, which was
    // correct while the fake never spoke first — see promptHold's own doc comment above ("HELD-PROMPT
    // MODE"), piece (2). Unreachable unless a mode called callClient(), so with FAKE_ACP_PROMPT_HOLD
    // unset this branch never runs and the echo file's contents are unchanged.
    if (
        msg.method === undefined &&
        msg.id !== undefined &&
        ('result' in msg || 'error' in msg)
    ) {
        echoInResponse(msg)
        const waiter = pendingClientCalls.get(Number(msg.id))
        if (waiter) {
            pendingClientCalls.delete(Number(msg.id))
            waiter(msg)
        }
        return
    }
    if (typeof msg.method !== 'string') return // neither a request nor a notification — stay defensive
    const { method, params, id } = msg
    echo(method, params)

    switch (method) {
        case 'initialize':
            if (id !== undefined) handleInitialize(id)
            return
        case 'session/new':
            if (id !== undefined) handleSessionNew(id)
            return
        case 'session/prompt':
            if (id !== undefined) handleSessionPrompt(id, params)
            return
        case 'session/set_config_option':
            if (id !== undefined) handleSetConfigOption(id)
            return
        case 'session/set_model':
            if (id !== undefined) handleSetModelOld(id)
            return
        case 'session/cancel':
            // A notification — there is nothing to reply to for the cancel itself. But any prompt this
            // fake is HOLDING open must now settle, or the driver's abortTurn would wait forever on a
            // session/prompt response that nothing else can produce (a real agent settles the in-flight
            // prompt with stopReason:"cancelled"; driver.ts's runTurn reads exactly that). No held
            // prompts (every pre-held-prompt-mode caller) makes this an empty loop, so the byte-for-byte
            // behavior with FAKE_ACP_PROMPT_HOLD unset is unchanged.
            for (const heldId of Array.from(heldPrompts.keys()))
                settlePrompt(heldId, 'cancelled')
            // THE ABORT-GAP FIX (see acpAbortFakeAgent.test.ts): settling the held session/prompt above
            // does NOT unwind whatever runner was still parked on its OWN outbound call into the client
            // (e.g. runHeldPermissionPrompt's `await callClient("session/request_permission", ...)`) — that
            // resolver just sits in pendingClientCalls, and previously a LATE reply landing on it (a stale
            // UI still answering after abort) would resume the runner and emit a stray agent_message_chunk
            // on a turn that already ended. Draining every outstanding outbound call here, with a synthetic
            // cancelled envelope, makes every such runner resume PROMPTLY instead of depending on whether a
            // real reply ever shows up — and runHeldPermissionPrompt's own
            // `if (!heldPrompts.has(promptId)) return;` guard (added alongside this) is what makes that
            // resumption silent: by the time it runs, the settlePrompt loop above has already deleted this
            // promptId from heldPrompts, so the runner unwinds without emitting anything, whether it woke
            // up from THIS synthetic drain or from a genuinely late real reply arriving afterward (the
            // guard covers both; the drain just makes the common case deterministic rather than a leak).
            // No pendingClientCalls entries (every pre-held-prompt-mode caller, and permission mode outside
            // an active cancel) makes this an empty loop too — byte-for-byte unchanged otherwise.
            for (const [outboundId, waiter] of Array.from(
                pendingClientCalls.entries(),
            )) {
                pendingClientCalls.delete(outboundId)
                waiter({
                    jsonrpc: '2.0',
                    id: outboundId,
                    result: { outcome: { outcome: 'cancelled' } },
                })
            }
            return
        case 'session/load':
            // See rejectSessionLoad's own doc comment above ("SESSION-RESUME MODE") — inert unless
            // FAKE_ACP_REJECT_SESSION_LOAD is set, in which case the code/message are independently
            // overridable.
            if (id !== undefined) {
                if (rejectSessionLoad)
                    respondError(
                        id,
                        rejectSessionLoadCode,
                        rejectSessionLoadMessage,
                    )
                else respond(id, {})
            }
            return
        default:
            // Unknown/unimplemented verb the real driver might still call (session/resume, …): reply
            // with an empty result rather than a method-not-found error so a test exercising those paths
            // degrades gracefully instead of crashing the fake.
            if (id !== undefined) respond(id, {})
    }
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', handleLine)
process.stdin.resume()
