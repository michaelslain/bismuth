// core/src/chatProviders/acp/driver.ts
// The effectful half of the ACP chat backend: spawns ONE long-lived agent subprocess per chat
// (Bun.spawn, stdin/stdout pipes), speaks newline-delimited JSON-RPC over its stdio, and adapts it
// to the same ChatBackend interface every other provider implements (see ../backends.ts). The pure
// half — JSON-RPC envelope helpers, the session/update -> ChatFrame translator, version-skew model
// detection, permission-option mapping — lives in ./protocol.ts and is unit-tested there
// (core/test/chatProviders/acpProtocol.test.ts); nothing here is unit-tested directly, matching
// ../opencode.ts (only its pure ../opencodeTranslate.ts has a test file) — no ACP agent binary is
// installed in this sandbox, so there is nothing real to spawn against.
//
// SDK-vs-hand-roll: HAND-ROLLED, deliberately not `@agentclientprotocol/sdk`. The wire slice this
// driver needs (JSON-RPC request/notification/response framing, a small handful of methods) is
// small — ./protocol.ts's envelope helpers are ~120 lines — and the SDK's own major version is
// visibly churning (1.3.0 today; the still-current claude-code-acp adapter pins 0.14.1 with
// materially different NewSessionResponse fields), which this driver already has to branch around
// via detectModelShape regardless of which JSON-RPC transport sends the bytes. Adding the
// dependency would not remove that branching, and would add a second generated-schema surface (Zod
// validators + `.gen.d.ts` types) to keep in sync with that same version skew — hand-rolling keeps
// the whole wire contract in one small, readable, tolerant-by-construction file instead. Revisit if
// a future task wants request/response types generated from the SDK's schema directly.
//
// Lifecycle (mirrors ../opencode.ts's session registry conventions — Map<chatId, session>, emit /
// rebindSessionSink / scheduleSessionClose from ../sessionSink, a turn queue, process.on("exit")
// teardown, tolerant parsing that never throws into a user's chat):
//   1. openSession/sendMessage/resumeSession spawn the agent (if not already running for this
//      chat), `initialize`, then `session/new` (or `session/load`, falling back to `session/resume`
//      on a method-not-found error — the version-skew fallback for agents that don't implement
//      `session/load`).
//   2. Each user turn is one `session/prompt` call; its `session/update` notifications stream
//      ChatFrames via ./protocol.ts's translateSessionUpdate as they arrive; its `stopReason`
//      response ends the turn (`result` + `done`) — `"cancelled"` is NOT treated as an error,
//      mirroring opencode.ts's `aborting` flag.
//   3. The agent can call INTO us (client-side JSON-RPC requests): the only one implemented is
//      `session/request_permission` (parked as a `permission` ChatFrame, answered by
//      respondPermission); anything else (fs/*, terminal/*, elicitation/*) gets a method-not-found
//      reply — `initialize`'s clientCapabilities honestly declares neither fs nor terminal support,
//      so a well-behaved agent falls back to its own tools instead of calling them.
//   4. The subprocess is killed on closeChat/abort-timeout/an unexpected exit, and on process
//      "exit" (shutdownAll below) — never left running past its chat.
import { chatInstructions } from '../../chatInstructions'
import { claudeRetryEnv } from '../claudeBudget'
import { sizeGooseChat } from './gooseSizing'
import { chatLineRefNoteFor } from '../../chatLineRefNote'
import { existsSync } from 'node:fs'
import { ensureClineMcp } from '../../agentBackends/mcpRegistrars'
import { bismuthHome } from '../../bismuthHome'
import type { ChatFrame, ChatImage, ChatSink } from '../../chat'
import {
    detachSessionSink,
    emit,
    reattachSessionSink,
    rebindSessionSink,
    scheduleSessionClose,
} from '../sessionSink'
import { claudeSpawnEnv, whichBinary } from '../../claudeWhich'
import type { ChatBackend, ChatTurnContext } from '../backends'
import type { BackendId } from '../../agentBackends/catalog'
import {
    localUnreachableMessage,
    resolveLocalSpawn,
    type ResolvedLocal,
} from '../../agentBackends/localModelProbe'
import {
    ACP_AGENTS,
    OPENCLAW_KEY_PREFIX,
    openclawSessionKey,
    type AcpAgentSpec,
} from './agents'
import {
    listAgentModels,
    modelEntries,
    thoughtLevels,
} from './openclawModels'
import type { FileSink } from 'bun'
import { titleFromPrompt } from '../titleFromPrompt'
import { PRIVATE_ERASERS } from '../privateErase'
import {
    AcpRpcError,
    choosePermissionOption,
    createIdMinter,
    detectModelShape,
    encodeJsonRpcError,
    encodeJsonRpcNotification,
    encodeJsonRpcRequest,
    encodeJsonRpcResult,
    isJsonRpcNotification,
    isJsonRpcRequest,
    isJsonRpcResponse,
    isMethodNotFoundError,
    newAcpTranslateState,
    parseJsonRpcLine,
    toolCallInput,
    toolCallName,
    translateSessionUpdate,
    type AcpManifestBaseline,
    type AcpMcpServerStdio,
    type AcpModelEntry,
    type AcpModelShapeInfo,
    type AcpNewSessionResult,
    type AcpOutboundContentBlock,
    type AcpPermissionOption,
    type AcpTranslateState,
    type JsonRpcInbound,
    type JsonRpcRequest,
} from './protocol'

// ── Bismuth's own MCP binary (Surface 5 — the biggest ACP win: per-session injection, zero global
// config file) ──────────────────────────────────────────────────────────────────────────────────

/**
 * The installed `bismuth-mcp` binary, or null when the app never installed the machine-wide tools.
 * A deliberate literal duplicate of daemon/src/lib/bismuthPaths.ts's `mcpBin()` (same convention:
 * "the daemon is a separate workspace + separately-bundled binary, so it must not import across
 * into @bismuth/core") rather than importing core/src/bismuthInstall.ts's BIN_DIR/MCP_DEST — those
 * consts are private (not exported by that file). existsSync-gated so a machine where the app never
 * installed the tools degrades to an empty mcpServers array, never a crash.
 */
function bismuthMcpBin(): string | null {
    const p = bismuthHome('bin', 'bismuth-mcp')
    return existsSync(p) ? p : null
}

/** Build `session/new`'s `mcpServers` array: Bismuth's own MCP server, with `BISMUTH_VAULT` always
 *  set and `BISMUTH_MEMORY_DIR` added only when this chat's vault has the daemon enabled (mirrors
 *  terminal.ts's PTY injection gate). Empty array when the binary isn't installed.
 *
 *  Also stamps `BISMUTH_MCP_CHANNEL`/`BISMUTH_AGENT_CHANNEL` = "chat": this config object is a
 *  REPLACEMENT env (no `...process.env` spread), so nothing here inherits either var from the
 *  parent unless set explicitly — and mcp/src/cli.ts's `runCli()` passes `process.env` straight
 *  through when it spawns the `bismuth` binary, so whatever channel this MCP server's own process
 *  sees is exactly what a `bismuth_cli` call (or a direct CLI invocation shelled out from this MCP
 *  server's own process, however unlikely) will be gated as. */
/** The leading blocks of an ACP prompt: on a session's first prompt from this process, the chat
 *  instructions (chatInstructions.ts) in a `<bismuth-chat-instructions>` block, since ACP has no
 *  system-prompt field; on every later prompt, none. */
export function acpInstructionBlocks(
    cwd: string,
    first: boolean,
    lineRefNote = '',
): AcpOutboundContentBlock[] {
    if (!first) return []
    return [
        {
            type: 'text',
            text: `<bismuth-chat-instructions>\n${chatInstructions(cwd, lineRefNote)}\n</bismuth-chat-instructions>`,
        },
    ]
}

export function buildMcpServers(
    vaultRoot: string,
    memoryDir?: string,
    bin: string | null = bismuthMcpBin(),
): AcpMcpServerStdio[] {
    if (!bin) return []
    const env: { name: string; value: string }[] = [
        { name: 'BISMUTH_VAULT', value: vaultRoot },
        { name: 'BISMUTH_MCP_CHANNEL', value: 'chat' },
        { name: 'BISMUTH_AGENT_CHANNEL', value: 'chat' },
        // The installed server runs the installed CLI through BISMUTH_CLI, and reads docs from
        // BISMUTH_DOCS_DIR, as every other registration sets them (bismuthInstall.ts's
        // installedMcpLaunch). Without BISMUTH_CLI it falls back to `bun run <repo>/cli/src/index.ts`,
        // a path only a dev checkout has, and every bismuth_cli call fails with "Module not found".
        { name: 'BISMUTH_CLI', value: bismuthHome('bin', 'bismuth') },
        { name: 'BISMUTH_DOCS_DIR', value: bismuthHome('docs') },
    ]
    if (memoryDir) env.push({ name: 'BISMUTH_MEMORY_DIR', value: memoryDir })
    return [{ name: 'bismuth', command: bin, args: [], env }]
}

// ── initialize handshake params ────────────────────────────────────────────────────────────────

// GUESS: initialize's TOP-LEVEL shape is confirmed
// ({protocolVersion, clientCapabilities, clientInfo} in, {protocolVersion, agentCapabilities,
// authMethods, agentInfo} out), but clientCapabilities' own field names are not, beyond one
// bundle-strings artifact ("an fs.readTextFile: z.boolean() capability flag" seen in cline's
// compiled binary). `protocolVersion: 1` mirrors the integer-version convention most JSON-RPC
// dev-tool protocols use (LSP et al) — untested against a real agent. clientCapabilities below
// declares NO fs/terminal support: never claim a capability with no backing client-method
// implementation.
const INITIALIZE_PARAMS = {
    protocolVersion: 1,
    clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
    },
    clientInfo: { name: 'Bismuth', version: '0.1.0' },
}

const ABORT_GRACE_MS = 8000

/** How long a plain `proc.kill()` (SIGTERM) is given before this driver escalates to SIGKILL — used
 *  at BOTH places this driver ever kills an agent process: closeChat() (below) and abortTurn()'s own
 *  grace-timeout fallback (`ABORT_GRACE_MS` above; see its call site). REQUIRED, not
 *  defense-in-depth — confirmed live (offline-testing openclaw task) that a real `openclaw acp`
 *  process does NOT exit on SIGTERM alone: its own `serveAcpGateway`'s SIGTERM handler
 *  (`dist/acp-cli-BQ740PFm.js`) gracefully stops its internal Gateway WebSocket connection but never
 *  calls `process.exit()` itself, relying on the event loop draining naturally — which never happens
 *  while this process still holds the child's stdin pipe open (the same pipe writeToProc() writes
 *  JSON-RPC requests to), so the child survives indefinitely, not just briefly, after a plain
 *  `proc.kill()`. Reproduced directly: `proc.exited` on a real openclaw ACP bridge child did not
 *  resolve within 120s of a bare SIGTERM. Mirrors the SAME grace-then-SIGKILL shape
 *  core/test/support/openclawGateway.ts's own `stopProcess` already uses for the Gateway process it
 *  spawns (`mockLlm.ts`'s own `stopProcess` does NOT escalate — a bare kill()+await, correctly cited
 *  here as the one that does NOT, after an earlier version of this comment miscited it as if it did)
 *  — this is that same escalation pattern landing in the two places it was still missing in
 *  PRODUCTION code: real chat-close and real turn-abort, not just a test's own teardown.
 *
 *  See killWithEscalation's own doc comment below for a CONFIRMED GAP in this escalation: it does
 *  not reach every process it targets. */
const KILL_ESCALATION_GRACE_MS = 3000

/** How long a private chat waits on `session/delete` before stopping the agent anyway. */
const PRIVATE_DELETE_TIMEOUT_MS = 3000

/** Send SIGTERM (`proc.kill()`), then SIGKILL after `graceMs` if `proc.exited` hasn't resolved by
 *  then — see KILL_ESCALATION_GRACE_MS's own doc comment for why this is required, not
 *  defense-in-depth, for at least one real agent (openclaw). Fire-and-forget: returns immediately,
 *  callers (closeChat, abortTurn's grace-timeout) stay synchronous exactly as before this existed.
 *  `proc` is the caller's own local/captured reference (never re-read from mutable session state
 *  inside this function), so a session that respawns its process in the meantime can't redirect
 *  which process this escalation ultimately signals — it always targets the exact process handle it
 *  was given. `.catch(() => {})` on the race itself (not only inside `.then`) matches this file's
 *  own convention for a `proc.exited` consumer that must never become an unhandled rejection (see
 *  watchExit's identical `.catch(() => {})` and raceExit's `.catch(() => finish(...))` above).
 *
 *  CONFIRMED GAP (task-15): `npx`-spawned adapters (claude-code-acp, codex-acp, agents.ts's two
 *  `adapter: true` entries) put an `npx` WRAPPER process, not the real agent, as the direct child
 *  this module's `proc` handle names, and SIGKILL to that wrapper alone does NOT propagate to the
 *  real agent process underneath — it survives, orphaned. Verified directly against BOTH real
 *  published adapters (`npx -y @zed-industries/claude-code-acp` and `npx -y
 *  @agentclientprotocol/codex-acp`, the exact binary+args agents.ts's own entries use, not a stub):
 *  in both cases `npx` forks a genuine CHILD process (confirmed via `pgrep -P` against the
 *  `Bun.spawn`-returned pid — a real `node .../claude-code-acp` / `node .../codex-acp` process, ppid
 *  matching the npx wrapper, never the same pid — so `npx` does not exec-replace itself), and
 *  `proc.kill(9)` against ONLY the wrapper pid leaves that real child alive and running 3+ seconds
 *  later, every time. This function only ever signals the single `proc` handle it's given, never a
 *  process group, so BOTH closeChat() and abortTurn()'s grace-timeout fallback leak the real
 *  claude-code-acp/codex-acp process today, exactly the same shape as the openclaw SIGTERM finding
 *  above but deeper in the process tree and NOT fixed by this escalation as it currently exists.
 *  `codex-acp` specifically is FOUR processes deep, not two, confirmed by walking its own `pgrep -P`
 *  chain: `npx` → `node .../codex-acp` → `node @openai/codex/bin/codex.js app-server` → the real
 *  native `codex` binary (`app-server`) — three levels of descendant below the wrapper this driver's
 *  `proc` handle names, and that chain is itself an implementation detail of a package this driver
 *  doesn't control, not a fixed depth to hardcode. That rules out "track+kill the resolved
 *  grandchild pid" as a complete fix on its own — a single extra hop still orphans whatever is one
 *  level further down, and a future adapter version could add or remove a hop without this driver
 *  knowing. The ONLY remediation that is actually complete regardless of how deep a given adapter's
 *  own wrapper chain goes is spawning adapter agents into their own process group (e.g. `setsid`,
 *  then a negative-pid kill to signal the whole group at once) — a real behavior change to
 *  spawnAcpProcess/this function worth its own task, not a comment update, and not attempted here.
 *  Only cline/gemini/goose/openclaw (the four NATIVE, non-adapter agents, each a DIRECT child with
 *  no wrapper in between) are actually confirmed fully covered by this escalation as written. */
function killWithEscalation(
    proc: ReturnType<typeof Bun.spawn>,
    graceMs: number,
): void {
    try {
        proc.kill()
    } catch {
        /* already exited */
    }
    void Promise.race([
        proc.exited.then(() => false),
        new Promise<boolean>(resolve =>
            setTimeout(() => resolve(true), graceMs),
        ),
    ])
        .then(timedOut => {
            if (!timedOut) return
            try {
                proc.kill(9)
            } catch {
                /* already exited between the timeout firing and this call */
            }
        })
        .catch(() => {})
}

/** Whether `setModel` takes `model`. While the vault's local model resolved for this session the chat
 *  is PINNED to the local server's ids — the app re-applies the last pick on a fresh chat, and a
 *  remembered cloud id would be forwarded to goose and fail the turn. */
export function acceptsModelPick(
    local: ResolvedLocal | null,
    model: string,
): boolean {
    return !local || local.models.includes(model.replace(/^local\//, ''))
}

/** The models frame while the vault's local model pins the chat: the local server's ids, not the
 *  agent's own catalog (goose lists its whole cloud catalog and would drop every pick but the local
 *  ones). Each entry carries the effort levels the agent reported for the current model; the rest
 *  are filled in when a switch to them reports its own. */
export function localModelEntries(
    local: ResolvedLocal,
    shape: AcpModelShapeInfo,
): AcpModelEntry[] {
    const levels =
        shape.models.find(m => m.value === shape.currentModelId)
            ?.effortLevels ??
        shape.models[0]?.effortLevels ??
        []
    return local.models.map(id => ({
        value: id,
        label: id,
        description: '',
        effortLevels: id === shape.currentModelId ? levels : [],
    }))
}

/** The env an ACP agent is spawned with: the base, with the vault's local-model env (goose's
 *  `GOOSE_PROVIDER`/`OPENAI_HOST`/… from `localSpawnFor`) laid over it when the setting resolved
 *  for this agent. Pure — `null` (setting off, or an agent with no local mechanism) is `base`. */
export function acpSpawnEnv(
    base: Record<string, string>,
    local: ResolvedLocal | null,
): Record<string, string> {
    return local ? { ...base, ...local.env } : base
}

/** How long a prompted ACP turn may go without a single message from the agent before it is ended
 *  with an error. Every update and permission ask resets it, so a slow but working turn never trips
 *  it. The window exists for an agent stuck retrying a failing model server inside the turn (gemini
 *  retries a 500 ten times over minutes and sends nothing meanwhile) or wedged, not to meet a
 *  deadline: real cloud turns stay silent for a long while (hermes streams no tool-call arguments,
 *  gemini sends a call's arguments whole, codex-acp sends reasoning summaries at the end, a large
 *  prompt on a slow provider waits close to a minute for its first token). */
export const ACP_NO_PROGRESS_MS = 120_000
/** The same window while the vault's local model pins the chat: the server may be loading the model
 *  into memory before it answers, which takes minutes for a large one. */
export const ACP_NO_PROGRESS_LOCAL_MS = 600_000

/** The no-progress window for a turn; `BISMUTH_ACP_NO_PROGRESS_MS` overrides it. */
export function acpNoProgressMs(local: boolean): number {
    const override = Number(process.env.BISMUTH_ACP_NO_PROGRESS_MS)
    if (Number.isFinite(override) && override > 0) return override
    return local ? ACP_NO_PROGRESS_LOCAL_MS : ACP_NO_PROGRESS_MS
}

/** The error a silent agent ends its turn with. */
export function acpSilentMessage(label: string, ms: number): string {
    const secs = Math.round(ms / 1000)
    return `${label} sent nothing for ${secs} s, so the turn was stopped. Its model server may be failing or still loading.`
}

// ── Session state ───────────────────────────────────────────────────────────────────────────────

interface AcpPendingCall {
    resolve: (result: unknown) => void
    reject: (err: unknown) => void
}

interface AcpPendingPermission {
    /** The JSON-RPC request id to reply to (echoed back verbatim in encodeJsonRpcResult). */
    rpcId: number | string
    options: AcpPermissionOption[]
}

interface AcpSession {
    id: string // the chat id
    cwd: string
    sink: ChatSink
    proc: ReturnType<typeof Bun.spawn> | null
    nextId: () => number
    pendingCalls: Map<number, AcpPendingCall>
    pendingPermissions: Map<string, AcpPendingPermission>
    /** The ACP session id (learned from session/new, or supplied on resume). */
    sessionId: string | null
    modelShape: AcpModelShapeInfo
    translateState: AcpTranslateState
    turnActive: boolean
    /** Whether this process already sent the chat instructions (chatInstructions.ts) into the
     *  session. ACP has no system-prompt field, so they lead the first prompt it sends. */
    instructed?: boolean
    /** Set by abortTurn right before session/cancel — cleared once session/prompt settles (its
     *  stopReason:"cancelled" is then NOT reported as an error), mirroring opencode.ts's `aborting`. */
    aborting: boolean
    queue: { text: string; images?: ChatImage[] }[]
    detached: boolean
    buffer: ChatFrame[]
    closeTimer?: ReturnType<typeof setTimeout>
    titleSent: boolean
    lastActivityAt: number
    /** ms epoch the session was created; a private chat's eraser matches files written since. */
    startedAt: number
    /** The chat's private toggle (setPrivate): erase the session from the agent's store on close. */
    private?: boolean
    /** Undecoded tail of the stdout stream (a JSON-RPC line can arrive split across chunks). */
    stdoutPending: string
    /** True once the fallbackArgs respawn has been tried (retried ONCE, never looped). */
    usedFallbackArgs: boolean
    /** The local-model resolution this session was created under (null = the setting is off for it),
     *  kept so the fallbackArgs respawn gets the same env as the first spawn. */
    local: ResolvedLocal | null
    /** Settles once session setup ends (true) or the chat closes first (false): a turn sent while a
     *  resume is still loading waits on it, so its `session/prompt` never carries a null session id. */
    ready: Promise<boolean>
    settleReady: (ok: boolean) => void
    /** Config calls (set model, effort, mode) run one after another; a prompt waits for the tail. */
    configChain: Promise<void>
    /** The effort the user chose, re-sent after a model switch (goose resets it to the new model's). */
    effort: string | null
    /** Mode ids the agent advertised (`modes.availableModes`), so only a real one is set. */
    modeIds: string[]
    /** True for a session opened by session/load or session/resume: its reply may omit `modes`. */
    resumed: boolean
    /** Set when an adapter gave up retrying the model server during the current turn. */
    turnError?: string
    /** What the current turn has shown so far: the reply text and how many tool calls. */
    turnText: string
    turnTools: number
    /** Tool calls the agent has started this turn and not yet resolved: a running tool is not silence. */
    openTools: Set<string>
    /** The no-progress timer of the current turn, and the settle hook that ends it. */
    silence?: ReturnType<typeof setTimeout>
    silentStop?: (message: string) => void
    /** The agent's own session key for this chat (openclaw's gateway key), when it has one. */
    sessionKey?: string
    /** The chat id the agent's store is keyed on: this chat's id, or on resume the first chat's. */
    storeChatId: string
}

function blankManifest(
    mcpServers: { name: string; status: string }[],
): AcpManifestBaseline {
    return {
        model: '',
        permissionMode: 'default',
        tools: [],
        mcpServers,
        slashCommands: [],
        commandDetails: {},
    }
}

// ── One ChatBackend per ACP agent (cline/gemini/goose/openclaw/claude-code-acp/codex-acp) ────────
// Each gets its OWN session Map + closes over its OWN AcpAgentSpec, so e.g. a "cline" chat id and a
// "gemini" chat id (however unlikely to collide) can never see each other's session state.

/** Every ACP backend's own "close every session I know about" — populated by createAcpBackend
 *  below (each closure's `sessions` map is private to it), drained by shutdownAll() so a backend
 *  restart never leaves an ACP agent subprocess running past it. */
const shutdownHooks: (() => void)[] = []

function createAcpBackend(agentId: BackendId): ChatBackend {
    const found = ACP_AGENTS.find(a => a.id === agentId)
    if (!found) throw new Error(`no ACP agent spec for backend id "${agentId}"`)
    // A plain typed const (not a narrowed reference) so every nested `function` declaration below —
    // TS doesn't carry a closure-captured variable's narrowing into hoisted function declarations,
    // only into arrow/expression closures defined after the guard — sees AcpAgentSpec, never
    // `AcpAgentSpec | undefined`.
    const agent: AcpAgentSpec = found

    const sessions = new Map<string, AcpSession>()

    function spawnAcpProcess(
        bin: string,
        args: string[],
        cwd: string,
        local: ResolvedLocal | null,
    ): ReturnType<typeof Bun.spawn> | null {
        let spawnEnv = acpSpawnEnv(
            claudeSpawnEnv(process.env, 'chat') as Record<string, string>,
            local,
        )
        // claude-code-acp runs the Claude Code CLI, whose own model-call retries default to 10 with
        // exponential backoff (minutes on a 500). The native claude path caps them (chat.ts); the
        // adapter's child gets the same cap. The user's own value wins.
        if (agent.id === 'claude-code-acp')
            spawnEnv = { ...claudeRetryEnv(!!local, spawnEnv), ...spawnEnv }
        // The user's own value wins over the agent's default.
        if (agent.spawnEnv) spawnEnv = { ...agent.spawnEnv, ...spawnEnv }
        try {
            return Bun.spawn([bin, ...args], {
                cwd,
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe',
                // "chat": every ACP agent here is a chat backend. Stamps BISMUTH_AGENT_CHANNEL so a
                // `bismuth` invocation from THIS process's own shell/tool-use (not just through the MCP
                // server above) is gated by core/src/visibilityCliGate.ts.
                env: spawnEnv,
            })
        } catch {
            return null
        }
    }

    function writeToProc(s: AcpSession, text: string): void {
        if (!s.proc) return
        try {
            // `ReturnType<typeof Bun.spawn>` collapses stdin's type to the general `FileSink | number |
            // undefined` union (the generic overload resolution loses the concrete `{stdin:"pipe"}` we
            // always pass to spawnAcpProcess) — cast to the FileSink shape that option actually produces.
            const stdin = s.proc.stdin as FileSink
            stdin.write(text)
            stdin.flush()
        } catch {
            /* pipe closed — watchExit reports the teardown */
        }
    }

    function call(
        s: AcpSession,
        method: string,
        params?: unknown,
    ): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!s.proc) {
                reject(new Error(`${agent.label} is not running`))
                return
            }
            const id = s.nextId()
            s.pendingCalls.set(id, { resolve, reject })
            writeToProc(s, encodeJsonRpcRequest(id, method, params))
        })
    }

    /** Answer the agent's `session/request_permission` call by parking it as a `permission` frame;
     *  anything else we don't implement gets a method-not-found reply (see the top-of-file note). */
    function handleAgentRequest(s: AcpSession, req: JsonRpcRequest): void {
        if (req.method === 'session/request_permission') {
            const params =
                req.params && typeof req.params === 'object'
                    ? (req.params as Record<string, unknown>)
                    : {}
            const toolCall =
                params.toolCall && typeof params.toolCall === 'object'
                    ? (params.toolCall as Record<string, unknown>)
                    : {}
            const options = Array.isArray(params.options)
                ? (params.options as AcpPermissionOption[])
                : []
            const id = String(req.id)
            s.pendingPermissions.set(id, { rpcId: req.id, options })
            // Shared with the tool-chip name in protocol.ts — these two were separate inline expressions
            // that disagreed, so the modal and the chip named the same ToolCall two different ways within
            // one turn. One function, one answer.
            const toolName = toolCallName(toolCall)
            emit(s, {
                type: 'permission',
                id,
                toolName,
                input: toolCallInput(toolCall) ?? {},
            })
            return
        }
        writeToProc(
            s,
            encodeJsonRpcError(
                req.id,
                -32601,
                `Bismuth's ACP client does not implement ${req.method}`,
            ),
        )
    }

    /** (Re)start the turn's no-progress timer. While a permission card is open or a tool runs the
     *  turn waits on the user or the tool, not on the model, so the timer just starts over. */
    function armSilence(s: AcpSession): void {
        if (s.silence) clearTimeout(s.silence)
        const ms = acpNoProgressMs(!!s.local)
        s.silence = setTimeout(() => {
            s.silence = undefined
            if (!s.turnActive || s.aborting) return
            if (s.pendingPermissions.size > 0 || s.openTools.size > 0) {
                armSilence(s)
                return
            }
            s.silentStop?.(acpSilentMessage(agent.label, ms))
        }, ms)
    }

    function handleInbound(s: AcpSession, msg: JsonRpcInbound): void {
        if (isJsonRpcResponse(msg)) {
            const id = typeof msg.id === 'number' ? msg.id : Number(msg.id)
            const pending = s.pendingCalls.get(id)
            if (!pending) return
            s.pendingCalls.delete(id)
            if ('error' in msg) {
                // openclaw flattens every thrown error to -32603 "Internal error"; the reason survives
                // only in `error.data.details`.
                const details = (msg.error.data as { details?: unknown } | null)?.details
                pending.reject(
                    new AcpRpcError(
                        msg.error.code,
                        typeof details === 'string' && details
                            ? `${msg.error.message}: ${details}`
                            : msg.error.message,
                    ),
                )
            }
            else pending.resolve(msg.result)
            return
        }
        if (s.silence && (isJsonRpcNotification(msg) || isJsonRpcRequest(msg)))
            armSilence(s)
        if (isJsonRpcNotification(msg)) {
            if (msg.method === 'session/update') {
                const params =
                    msg.params && typeof msg.params === 'object'
                        ? (msg.params as Record<string, unknown>)
                        : {}
                noteRetryExhausted(s, params.update)
                const upd = params.update as
                    | { sessionUpdate?: unknown; currentModeId?: unknown }
                    | undefined
                if (
                    upd?.sessionUpdate === 'current_mode_update' &&
                    typeof upd.currentModeId === 'string' &&
                    !s.modeIds.includes(upd.currentModeId)
                )
                    s.modeIds.push(upd.currentModeId)
                for (const frame of translateSessionUpdate(
                    params.update,
                    s.translateState,
                )) {
                    if (frame.type === 'assistant-text') s.turnText += frame.text
                    else if (frame.type === 'tool-use') {
                        s.turnTools++
                        s.openTools.add(frame.id)
                    } else if (frame.type === 'tool-result')
                        s.openTools.delete(frame.id)
                    emit(s, frame)
                }
            }
            return
        }
        if (isJsonRpcRequest(msg)) handleAgentRequest(s, msg)
    }

    /** An adapter that retries a failing model server (codex-acp: `_meta.codex.error`, "Reconnecting...
     *  n/m") ends the turn with a normal stop once the retries run out. The last attempt is the
     *  failure the user needs to see, so it is kept for the turn's end. */
    function noteRetryExhausted(s: AcpSession, update: unknown): void {
        const meta = (update as { _meta?: Record<string, unknown> } | null)?._meta
        if (!meta || typeof meta !== 'object') return
        for (const v of Object.values(meta)) {
            const err = (v as { error?: Record<string, unknown> } | null)?.error
            if (!err || typeof err !== 'object') continue
            const m = /(\d+)\/(\d+)/.exec(String(err.message ?? ''))
            if (!m || m[1] !== m[2]) continue
            const detail = err.additionalDetails
            s.turnError =
                typeof detail === 'string' && detail.trim()
                    ? detail.trim()
                    : `${agent.label} could not reach the model after ${m[2]} tries.`
        }
    }

    function startReadLoop(
        s: AcpSession,
        proc: ReturnType<typeof Bun.spawn>,
    ): void {
        const stdout = proc.stdout as ReadableStream<Uint8Array>
        const decoder = new TextDecoder()
        ;(async () => {
            try {
                for await (const chunk of stdout) {
                    if (s.proc !== proc) return // superseded by a fallbackArgs respawn
                    s.stdoutPending += decoder.decode(chunk, { stream: true })
                    let nl: number
                    while ((nl = s.stdoutPending.indexOf('\n')) >= 0) {
                        const raw = s.stdoutPending.slice(0, nl)
                        s.stdoutPending = s.stdoutPending.slice(nl + 1)
                        const msg = parseJsonRpcLine(raw)
                        if (msg) handleInbound(s, msg)
                    }
                }
            } catch {
                /* stream torn down (kill/exit) — watchExit reports the outcome */
            }
        })()
    }

    /** The child died (crash, or a deliberate abort-timeout kill). A respawn superseding this proc
     *  (fallbackArgs retry) is NOT a teardown — guarded by identity, not just session lookup. */
    function watchExit(
        s: AcpSession,
        proc: ReturnType<typeof Bun.spawn>,
    ): void {
        proc.exited
            .then(() => {
                if (s.proc !== proc) return // superseded — the fallbackArgs respawn owns teardown now
                if (sessions.get(s.id) !== s) return // already closed deliberately via closeChat
                sessions.delete(s.id)
                const message = `${agent.label} exited unexpectedly.`
                for (const [, p] of s.pendingCalls) p.reject(new Error(message))
                s.pendingCalls.clear()
                s.pendingPermissions.clear() // the pipe is gone — nothing left to reply to
                if (s.turnActive) {
                    s.turnActive = false
                    emit(s, {
                        type: 'result',
                        isError: true,
                        numTurns: 1,
                        costUsd: s.translateState.costUsd,
                    })
                    emit(s, { type: 'done' })
                }
                emit(s, { type: 'error', code: 'exit', message })
            })
            .catch(() => {})
    }

    function attachProc(
        s: AcpSession,
        proc: ReturnType<typeof Bun.spawn>,
    ): void {
        s.proc = proc
        s.stdoutPending = ''
        s.nextId = createIdMinter()
        startReadLoop(s, proc)
        watchExit(s, proc)
    }

    /** Await `promise`, but resolve early (exited:true) if the process exits first — the signal
     *  handshake()'s fallbackArgs retry watches for: the process exiting before initialize responds.
     *  Untested against a real agent binary (none installed here). */
    function raceExit(
        s: AcpSession,
        promise: Promise<unknown>,
    ): Promise<{ ok: boolean; exited: boolean }> {
        return new Promise(resolve => {
            let settled = false
            const finish = (r: { ok: boolean; exited: boolean }) => {
                if (settled) return
                settled = true
                resolve(r)
            }
            const proc = s.proc
            if (proc)
                proc.exited
                    .then(() => finish({ ok: false, exited: true }))
                    .catch(() => finish({ ok: false, exited: true }))
            promise
                .then(() => finish({ ok: true, exited: false }))
                .catch(() => finish({ ok: false, exited: false }))
        })
    }

    /** `initialize`, retried ONCE with agents.ts's fallbackArgs if the process exits before it
     *  responds — the version-uncertain flag spelling (e.g. Gemini CLI's --experimental-acp vs
     *  --acp) is tolerated by trying the documented spelling first and only reaching for the guess
     *  if the CLI's own exit tells us the flag didn't parse. */
    async function handshake(s: AcpSession): Promise<boolean> {
        const first = await raceExit(
            s,
            call(s, 'initialize', INITIALIZE_PARAMS),
        )
        if (first.ok) return true
        if (!first.exited || !agent.fallbackArgs || s.usedFallbackArgs)
            return false
        s.usedFallbackArgs = true
        const bin = whichBinary(agent.binary)
        if (!bin) return false
        // Same per-chat argv extension as createSession's primary spawn (s.id is the chat id — see
        // AcpSession's own `id` field doc comment) — currently dead for every agent that HAS
        // fallbackArgs (only gemini, which has no sessionKeyArgs), kept consistent in case a future
        // agent ever needs both.
        const fallbackSpawnArgs = [
            ...agent.fallbackArgs,
            ...(agent.sessionKeyArgs?.(s.id, s.sessionKey) ?? []),
        ]
        const proc = spawnAcpProcess(bin, fallbackSpawnArgs, s.cwd, s.local)
        if (!proc) return false
        attachProc(s, proc)
        const second = await raceExit(
            s,
            call(s, 'initialize', INITIALIZE_PARAMS),
        )
        return second.ok
    }

    async function createSession(
        chatId: string,
        cwd: string,
        sink: ChatSink,
        memoryDir: string | undefined,
        resumeId?: string,
    ): Promise<AcpSession | null> {
        const bin = whichBinary(agent.binary)
        if (!bin) {
            sink({
                type: 'error',
                code: 'no-binary',
                binary: agent.binary,
                message: `The \`${agent.binary}\` CLI was not found. Install ${agent.label} to use this provider.`,
            })
            return null
        }
        // agent.sessionKeyArgs (currently only openclaw): a per-CHAT argv extension, computed from THIS
        // call's own chatId (already a parameter above — nothing new needed to reach it here). See
        // agents.ts's openclaw entry for why a per-chat session key is required, not optional: a fixed
        // constant here was shipped once and reverted after review found it leaks one chat's content
        // into another's upstream request (the openclaw isolation test in openclawMocked.test.ts proves
        // this stays closed). Every other agent leaves this undefined and gets byte-identical argv to
        // before this field existed.
        // The vault's localModel setting (goose only — every other agent resolves 'off'). Resolved
        // after the binary check and before any spawn: an enabled-but-down server is surfaced as an
        // error frame here rather than letting goose fail mid-turn with a connection error that never
        // names the setting, or fall back to its configured cloud provider.
        const resolution = await resolveLocalSpawn(agentId, cwd)
        if (resolution.kind === 'unreachable') {
            sink({
                type: 'error',
                code: 'local-model-unreachable',
                message: localUnreachableMessage(resolution.url),
            })
            return null
        }
        let local = resolution.kind === 'ready' ? resolution.local : null
        // goose on a local model: fit its opening request to the loaded window (gooseSizing.ts).
        if (agentId === 'goose' && local) {
            const sized = await sizeGooseChat({
                bin,
                local,
                baseEnv: claudeSpawnEnv(process.env, 'chat') as Record<string, string>,
                instructions: chatInstructions(cwd, await chatLineRefNoteFor(cwd)),
                mcpBin: bismuthMcpBin(),
            })
            if (sized.kind === 'too-small') {
                sink({ type: 'error', code: 'error', message: sized.message })
                return null
            }
            local = sized.local
        }
        if (agentId === 'cline') {
            // cline ignores session/new's mcpServers, so its Bismuth tool goes in its own settings. Only
            // a dir Bismuth owns (CLINE_DIR: the bench, tests) is written: with it unset cline runs
            // against the user's real ~/.cline, which a spawn never touches. The product's Bismuth tool
            // for cline comes from the opt-in registrar (createClineRegistrar).
            const clineDir = process.env.CLINE_DIR
            const server = buildMcpServers(cwd, memoryDir)[0]
            try {
                if (clineDir && server) ensureClineMcp(clineDir, server)
            } catch {
                /* an unreadable settings file stays untouched; cline runs without the tool */
            }
        }
        // openclaw's gateway session is chosen by the spawn argv: a resumed chat binds the key its
        // first chat was given (what the session frame reported), not one built from this chat id.
        const sessionKey = agent.sessionKeyArgs
            ? resumeId?.startsWith(OPENCLAW_KEY_PREFIX)
                ? resumeId
                : openclawSessionKey(chatId)
            : undefined
        const spawnArgs = [
            ...agent.args,
            ...(agent.sessionKeyArgs?.(chatId, sessionKey) ?? []),
        ]
        const proc = spawnAcpProcess(bin, spawnArgs, cwd, local)
        if (!proc) {
            sink({
                type: 'error',
                code: 'spawn',
                message: `Failed to start ${agent.label}.`,
            })
            return null
        }
        // agent.supportsSessionMcpServers === false (currently only openclaw — see its own agents.ts
        // comment for the live-confirmed citation): that agent's session/new REJECTS a non-empty
        // mcpServers array outright rather than ignoring/merging it, so sending [] here is required for
        // EVERY turn to succeed at all, not an optional degrade.
        const mcpServers =
            agent.supportsSessionMcpServers === false
                ? []
                : buildMcpServers(cwd, memoryDir)
        let settleReady: (ok: boolean) => void = () => {}
        const ready = new Promise<boolean>(r => (settleReady = r))
        const s: AcpSession = {
            id: chatId,
            cwd,
            sink,
            proc: null,
            nextId: createIdMinter(),
            pendingCalls: new Map(),
            pendingPermissions: new Map(),
            openTools: new Set(),
            sessionId: null,
            modelShape: {
                shape: 'none',
                models: [],
                currentModelId: null,
                modelConfigId: null,
                effortConfigId: null,
            },
            translateState: newAcpTranslateState(
                blankManifest(
                    mcpServers.map(m => ({
                        name: m.name,
                        status: 'connected',
                    })),
                ),
            ),
            turnActive: false,
            aborting: false,
            queue: [],
            detached: false,
            buffer: [],
            titleSent: false,
            lastActivityAt: Date.now(),
            startedAt: Date.now(),
            stdoutPending: '',
            usedFallbackArgs: false,
            local,
            ready,
            settleReady,
            configChain: Promise.resolve(),
            effort: null,
            modeIds: [],
            resumed: !!resumeId,
            turnText: '',
            turnTools: 0,
            sessionKey,
            storeChatId: sessionKey?.startsWith(OPENCLAW_KEY_PREFIX)
                ? sessionKey.slice(OPENCLAW_KEY_PREFIX.length)
                : chatId,
        }
        sessions.set(chatId, s)
        attachProc(s, proc)
        // An agent whose session lists no models: its own command lists them, started now so it runs
        // beside the handshake.
        const listed = agent.modelListCommand
            ? listAgentModels(
                  bin,
                  agent.modelListCommand,
                  acpSpawnEnv(
                      claudeSpawnEnv(process.env, 'chat') as Record<string, string>,
                      local,
                  ),
                  cwd,
              )
            : null

        const handshakeOk = await handshake(s)
        if (sessions.get(chatId) !== s) return null // closed while we awaited
        if (!handshakeOk) {
            emit(s, {
                type: 'error',
                code: 'spawn',
                message: `${agent.label} did not complete the ACP handshake.`,
            })
            closeChat(chatId)
            return null
        }

        try {
            let result: unknown
            if (resumeId) {
                try {
                    result = await call(s, 'session/load', {
                        sessionId: resumeId,
                        cwd,
                        mcpServers,
                        ...(sessionKey && { _meta: { sessionKey } }),
                    })
                } catch (e) {
                    if (!isMethodNotFoundError(e)) throw e
                    result = await call(s, 'session/resume', {
                        sessionId: resumeId,
                        cwd,
                        mcpServers,
                        ...(sessionKey && { _meta: { sessionKey } }),
                    })
                }
                s.sessionId = resumeId
            } else {
                const created = (await call(s, 'session/new', {
                    cwd,
                    mcpServers,
                })) as AcpNewSessionResult
                result = created
                s.sessionId =
                    typeof created?.sessionId === 'string' && created.sessionId
                        ? created.sessionId
                        : null
            }
            if (sessions.get(chatId) !== s) return null // closed while we awaited
            s.modelShape = detectModelShape(result)
            if (listed) {
                // openclaw: models from its own command, effort from the bridge's thought_level.
                const list = await listed
                const thought = thoughtLevels(result)
                if (list.models.length)
                    s.modelShape = {
                        ...s.modelShape,
                        models: modelEntries(list, thought.levels),
                        currentModelId: list.current,
                    }
                if (thought.id && !s.modelShape.effortConfigId)
                    s.modelShape = { ...s.modelShape, effortConfigId: thought.id }
                if (sessions.get(chatId) !== s) return null // closed while we awaited
            }
            if (s.local)
                s.modelShape = {
                    ...s.modelShape,
                    models: localModelEntries(s.local, s.modelShape),
                }
            s.translateState.manifest.model = s.modelShape.currentModelId ?? ''
            s.modeIds = modeIdsOf(result)
            applyMode(s)
        } catch (e) {
            emit(s, {
                type: 'error',
                code: 'error',
                message: `${agent.label} could not start a session: ${e instanceof Error ? e.message : String(e)}`,
            })
            closeChat(chatId)
            return null
        }

        emit(s, {
            type: 'manifest',
            manifest: { ...s.translateState.manifest },
        })
        if (s.modelShape.models.length)
            emit(s, { type: 'models', models: s.modelShape.models })
        // origin "user", always: the daemon runs on the Claude Code SDK and records ITS session ids in
        // <vault>/.daemon/session-ids — an ACP session id comes from a per-agent id namespace that can
        // never be the daemon's (mirrors opencode.ts's emitOpenFrames reasoning).
        // openclaw reports its gateway key, which a resume binds (see sessionKey above).
        const reported = s.sessionKey ?? s.sessionId
        if (reported)
            emit(s, { type: 'session', sessionId: reported, origin: 'user' })
        s.settleReady(true)
        return s
    }

    /** Append a config call to the session's chain: calls run in order, never overlap, and a failed
     *  one does not stop the next. */
    function queueConfig(s: AcpSession, job: () => Promise<void>): void {
        s.configChain = s.configChain.then(job).catch(() => {})
    }

    function modeIdsOf(result: unknown): string[] {
        const modes = (result as { modes?: { availableModes?: unknown } } | null)
            ?.modes
        if (!Array.isArray(modes?.availableModes)) return []
        return modes.availableModes
            .map(m => (m as { id?: unknown })?.id)
            .filter((id): id is string => typeof id === 'string')
    }

    /** For an agent whose approval is a session mode (goose): put the session in the mode its chat's
     *  permission mode names. bypassPermissions is the agent's auto mode, acceptEdits its editsMode when
     *  it has one; every other mode asks. */
    function applyMode(s: AcpSession): void {
        const mode = s.translateState.manifest.permissionMode
        const modeId = agent.passModeNames
            ? mode
            : mode === 'bypassPermissions'
              ? agent.autoMode
              : mode === 'acceptEdits'
                ? (agent.editsMode ?? agent.askMode)
                : agent.askMode
        if (!modeId || !s.sessionId) return
        // A resumed session's load reply may carry no `modes`: send the mode anyway (a failure is
        // swallowed by queueConfig), since an agent that has it would otherwise never get it.
        if (!s.modeIds.includes(modeId) && !(s.resumed && !s.modeIds.length))
            return
        const sessionId = s.sessionId
        queueConfig(s, async () => {
            await call(s, 'session/set_mode', { sessionId, modeId })
        })
    }

    /** Take the effort config id a model switch's reply names, since a model can change its options,
     *  and the levels it reports for `model`: each model has its own, and the frame lists them. */
    function refreshEffort(s: AcpSession, model: string, result: unknown): void {
        const r = result as { configOptions?: unknown } | null
        if (!Array.isArray(r?.configOptions)) return
        const shape = detectModelShape(result)
        const id = shape.effortConfigId
        if (id) s.modelShape = { ...s.modelShape, effortConfigId: id }
        if (shape.shape !== 'new') return
        const levels = shape.models[0]?.effortLevels ?? []
        const entry = s.modelShape.models.find(m => m.value === model)
        if (!entry || entry.effortLevels.join() === levels.join()) return
        s.modelShape = {
            ...s.modelShape,
            models: s.modelShape.models.map(m =>
                m.value === model ? { ...m, effortLevels: levels } : m,
            ),
        }
        emit(s, { type: 'models', models: s.modelShape.models })
    }

    /** The error for a turn that ended normally but failed: openclaw's bridge drops the gateway's
     *  error and ends the turn empty; hermes sends a failed model call as the reply. Null otherwise. */
    function failedTurnMessage(s: AcpSession, result: unknown): string | null {
        if (s.turnTools > 0) return null
        const stop =
            result && typeof result === 'object'
                ? (result as Record<string, unknown>).stopReason
                : null
        const text = s.turnText.trim()
        if (agent.emptyTurnIsError && stop === 'end_turn' && !text)
            return `${agent.label} ended the turn without a reply; the model request likely failed (see \`${agent.binary} logs\`).`
        if (agent.failureTextPrefixes?.some(p => text.startsWith(p))) return text
        return null
    }

    function runOrQueue(
        s: AcpSession,
        text: string,
        images?: ChatImage[],
    ): void {
        if (s.turnActive) {
            s.queue.push({ text, images })
            return
        }
        void runTurn(s, text, images)
    }

    async function runTurn(
        s: AcpSession,
        text: string,
        images?: ChatImage[],
    ): Promise<void> {
        s.turnActive = true
        s.lastActivityAt = Date.now()
        // A resume may still be loading, and a model, effort or mode change may still be in flight.
        if (!(await s.ready)) {
            s.turnActive = false
            return
        }
        await s.configChain
        if (sessions.get(s.id) !== s) return
        const prompt: AcpOutboundContentBlock[] = acpInstructionBlocks(
            s.cwd,
            !s.instructed,
            await chatLineRefNoteFor(s.cwd),
        )
        s.instructed = true
        if (text) prompt.push({ type: 'text', text })
        for (const im of images ?? [])
            prompt.push({
                type: 'image',
                data: im.data,
                mimeType: im.media_type,
            })
        if (!prompt.length) prompt.push({ type: 'text', text: '' })

        let result: unknown = null
        let hardError: string | null = null
        s.turnError = undefined
        s.turnText = ''
        s.turnTools = 0
        s.openTools.clear()
        try {
            const silent = new Promise<never>((_, reject) => {
                s.silentStop = message => {
                    // Stop the agent's own retries, then end the turn here: its prompt may never settle.
                    if (s.sessionId)
                        writeToProc(
                            s,
                            encodeJsonRpcNotification('session/cancel', {
                                sessionId: s.sessionId,
                            }),
                        )
                    s.pendingPermissions.clear()
                    reject(new Error(message))
                }
            })
            silent.catch(() => {})
            armSilence(s)
            result = await Promise.race([
                call(s, 'session/prompt', {
                    sessionId: s.sessionId,
                    prompt,
                }),
                silent,
            ])
        } catch (e) {
            hardError = e instanceof Error ? e.message : String(e)
        } finally {
            if (s.silence) clearTimeout(s.silence)
            s.silence = undefined
            s.silentStop = undefined
        }
        if (sessions.get(s.id) !== s) return // torn down mid-turn (closeChat, or watchExit already reported it)
        hardError ??= s.turnError ?? null
        if (!hardError && !s.aborting) hardError = failedTurnMessage(s, result)

        s.aborting = false
        if (hardError) {
            emit(s, { type: 'error', code: 'error', message: hardError })
            emit(s, {
                type: 'result',
                isError: true,
                numTurns: 1,
                costUsd: s.translateState.costUsd,
            })
        } else {
            const stopReason =
                result && typeof result === 'object'
                    ? (result as Record<string, unknown>).stopReason
                    : null
            // "cancelled" ends the turn cleanly (mirrors opencode.ts's `aborting` flag) — only a genuine
            // model refusal is reported as a turn error; max_tokens/max_turn_requests still succeeded a
            // turn, just an incomplete one, same as Claude's own result reporting.
            const isError = stopReason === 'refusal'
            emit(s, {
                type: 'result',
                isError,
                numTurns: 1,
                costUsd: s.translateState.costUsd,
            })
        }
        emit(s, { type: 'done' })
        if (!s.titleSent) {
            const title = titleFromPrompt(text)
            if (title) {
                s.titleSent = true
                emit(s, { type: 'title', title })
            }
        }
        s.turnActive = false
        s.lastActivityAt = Date.now()
        const next = s.queue.shift()
        if (next) void runTurn(s, next.text, next.images)
    }

    function closeChat(chatId: string): void {
        const s = sessions.get(chatId)
        if (!s) return
        sessions.delete(chatId)
        s.settleReady(false)
        if (s.silence) clearTimeout(s.silence)
        if (s.closeTimer) clearTimeout(s.closeTimer)
        s.queue = []
        for (const [, p] of s.pendingCalls) p.reject(new Error('chat closed'))
        s.pendingCalls.clear()
        s.pendingPermissions.clear()
        if (s.private) {
            void closePrivate(s)
            return
        }
        // closeChat() itself stays synchronous (signature/callers unchanged) — killWithEscalation is
        // fire-and-forget and force-kills a process that ignores the graceful signal, rather than
        // leaving it running past this chat indefinitely. See KILL_ESCALATION_GRACE_MS's own doc comment
        // for why this is required for a real agent (openclaw), not speculative hardening.
        if (s.proc) killWithEscalation(s.proc, KILL_ESCALATION_GRACE_MS)
    }

    /** A private conversation's teardown (setPrivate): `session/delete` while the agent still
     *  runs (when it offers one), then stop the process, wait for it to exit so it cannot write again,
     *  and run the agent's eraser over what it left on disk. */
    async function closePrivate(s: AcpSession): Promise<void> {
        const proc = s.proc
        if (agent.privateDeleteRpc && proc && s.sessionId)
            await Promise.race([
                call(s, 'session/delete', { sessionId: s.sessionId }).catch(() => {}),
                new Promise(r => setTimeout(r, PRIVATE_DELETE_TIMEOUT_MS)),
            ])
        if (proc) {
            killWithEscalation(proc, KILL_ESCALATION_GRACE_MS)
            await proc.exited.catch(() => {})
        }
        if (!agent.privateErase) return
        await PRIVATE_ERASERS[agent.privateErase]({
            sessionId: s.sessionId ?? '',
            chatId: s.storeChatId,
            cwd: s.cwd,
            startedAt: s.startedAt,
            env: process.env,
            bin: whichBinary(agent.binary) ?? undefined,
        }).catch(() => {})
    }

    shutdownHooks.push(() => {
        for (const id of Array.from(sessions.keys())) closeChat(id)
    })

    return {
        id: agentId,

        hasSession: chatId => sessions.has(chatId),

        setPrivate: (chatId: string, on: boolean) => {
            const s = sessions.get(chatId)
            if (s) s.private = on
        },

        openSession: (ctx: ChatTurnContext) => {
            if (sessions.has(ctx.chatId)) return
            void createSession(ctx.chatId, ctx.cwd, ctx.sink, ctx.memoryDir)
        },

        sendMessage: (ctx: ChatTurnContext & { text: string }) => {
            const existing = sessions.get(ctx.chatId)
            if (!existing) {
                // PRE-EXISTING GAP, out of scope here: createSession is async, so the session isn't
                // registered in `sessions` until this await resolves. A WS close landing in that window
                // finds no session yet (detachSink no-ops) and, once creation DOES complete, the now-dead
                // sink is never detached and no grace-close timer is ever armed for it — an attached session
                // with nowhere to send frames and no teardown scheduled. Not reachable via the identity-guard
                // work in this file (that guards an EXISTING session's re-detach, not a session that doesn't
                // exist yet); would need its own fix (e.g. a placeholder session registered before the await).
                void (async () => {
                    const created = await createSession(
                        ctx.chatId,
                        ctx.cwd,
                        ctx.sink,
                        ctx.memoryDir,
                    )
                    if (!created) return
                    runOrQueue(created, ctx.text, ctx.images)
                })()
                return
            }
            reattachSessionSink(existing, ctx.sink)
            existing.cwd = ctx.cwd
            runOrQueue(existing, ctx.text, ctx.images)
        },

        resumeSession: (ctx: ChatTurnContext & { sessionId: string }) => {
            if (sessions.has(ctx.chatId)) closeChat(ctx.chatId)
            void createSession(
                ctx.chatId,
                ctx.cwd,
                ctx.sink,
                ctx.memoryDir,
                ctx.sessionId,
            )
        },

        // ACP has no transcript-export method — historyReplay
        // is declared false in the catalog; this only satisfies the ChatBackend interface.
        sessionHistoryFrames: async () => [],

        abortTurn: (chatId: string) => {
            const s = sessions.get(chatId)
            if (!s || !s.turnActive) return
            s.aborting = true
            s.queue = []
            if (s.sessionId)
                writeToProc(
                    s,
                    encodeJsonRpcNotification('session/cancel', {
                        sessionId: s.sessionId,
                    }),
                )
            // Defensive: if the agent never settles the in-flight session/prompt after cancel, kill the
            // process rather than leaving the chat wedged forever — watchExit then reports the outcome
            // and tears the session down (a later message spawns a fresh one). Same
            // killWithEscalation/KILL_ESCALATION_GRACE_MS as closeChat, not a bare kill() — a bare SIGTERM
            // here has the EXACT SAME failure mode KILL_ESCALATION_GRACE_MS's own doc comment documents for
            // closeChat: a real openclaw ACP bridge process doesn't exit on SIGTERM alone, so without the
            // escalation this fallback would leave `turnActive: true` against a half-dead bridge (its
            // Gateway connection gone, watchExit never firing because the process itself never exits) until
            // the chat is eventually closed.
            setTimeout(() => {
                const cur = sessions.get(chatId)
                if (cur === s && cur.turnActive && cur.aborting && cur.proc) {
                    killWithEscalation(cur.proc, KILL_ESCALATION_GRACE_MS)
                }
            }, ABORT_GRACE_MS)
        },

        setModel: (chatId: string, model: string) => {
            const s = sessions.get(chatId)
            if (!s || !s.sessionId) return
            const refuse = () => {
                if (model === s.modelShape.currentModelId) return
                emit(s, {
                    type: 'model-refused',
                    model,
                    current: s.modelShape.currentModelId ?? s.local?.model ?? '',
                })
            }
            if (!acceptsModelPick(s.local, model)) return refuse()
            const shape = s.modelShape.shape
            const configId = s.modelShape.modelConfigId
            if (!(shape === 'old' || (shape === 'new' && configId))) {
                // openclaw lists models its bridge cannot switch to.
                if (agent.modelListCommand) refuse()
                return
            }
            const sessionId = s.sessionId
            queueConfig(s, async () => {
                let result: unknown
                if (shape === 'new') {
                    result = await call(s, 'session/set_config_option', {
                        sessionId,
                        configId,
                        value: model,
                    })
                } else {
                    // GUESS: session/set_model's param shape is not otherwise confirmed beyond the method
                    // name, mirrored off NewSessionResponse.models.currentModelId's field naming.
                    result = await call(s, 'session/set_model', {
                        sessionId,
                        modelId: model,
                    })
                }
                s.modelShape = { ...s.modelShape, currentModelId: model }
                s.translateState.manifest.model = model
                refreshEffort(s, model, result)
                // goose rebuilds its provider on a model switch and drops the effort back to the new
                // model's default, so the user's choice is sent again.
                if (s.effort && s.modelShape.effortConfigId)
                    await call(s, 'session/set_config_option', {
                        sessionId,
                        configId: s.modelShape.effortConfigId,
                        value: s.effort,
                    }).catch(() => {})
            })
        },

        closeChat,

        scheduleClose: (chatId: string, ms: number) => {
            const s = sessions.get(chatId)
            if (!s) return
            scheduleSessionClose(s, ms, () => closeChat(chatId))
        },

        rebindSink: (chatId: string, sink: ChatSink) => {
            const s = sessions.get(chatId)
            if (!s) return false
            rebindSessionSink(s, sink)
            return true
        },

        detachSink: (chatId: string, sink: ChatSink) => {
            const s = sessions.get(chatId)
            if (!s) return false
            return detachSessionSink(s, sink)
        },

        respondPermission: (
            chatId: string,
            id: string,
            behavior: 'allow' | 'deny',
            always?: boolean,
        ) => {
            const s = sessions.get(chatId)
            if (!s) return
            const pending = s.pendingPermissions.get(id)
            if (!pending) return
            s.pendingPermissions.delete(id)
            const optionId = choosePermissionOption(pending.options, {
                behavior,
                always,
            })
            const outcome = optionId
                ? { outcome: 'selected', optionId }
                : { outcome: 'cancelled' }
            writeToProc(s, encodeJsonRpcResult(pending.rpcId, { outcome }))
            // The agent now owes the turn an update; the wait for the user is over.
            if (s.silence) armSilence(s)
        },

        // setPermissionMode is implemented only for an agent whose approval is a session mode
        // (agent.askMode: goose, hermes, codex-acp; agent.passModeNames: claude-code-acp): the chat's
        // mode reaches the agent as `session/set_mode` (applyMode),
        // so the catalog's permissionModes is true for exactly those agents. respondQuestion is not
        // implemented: no ACP session/update kind carries an AskUserQuestion-style multi-choice prompt
        // (only session/request_permission, answered by respondPermission above).
        ...(agent.askMode || agent.passModeNames
            ? {
                  setPermissionMode: (chatId: string, mode: string) => {
                      const s = sessions.get(chatId)
                      if (!s) return
                      s.translateState.manifest.permissionMode = mode
                      applyMode(s)
                      emit(s, {
                          type: 'manifest',
                          manifest: { ...s.translateState.manifest },
                      })
                  },
              }
            : {}),
        setEffort: (chatId: string, effort: string) => {
            const s = sessions.get(chatId)
            if (!s || !s.sessionId || !s.modelShape.effortConfigId) return
            s.effort = effort
            const sessionId = s.sessionId
            queueConfig(s, async () => {
                if (!s.modelShape.effortConfigId) return
                await call(s, 'session/set_config_option', {
                    sessionId,
                    configId: s.modelShape.effortConfigId,
                    value: effort,
                })
            })
        },
    }
}

export const clineBackend: ChatBackend = createAcpBackend('cline')
export const geminiBackend: ChatBackend = createAcpBackend('gemini')
export const gooseBackend: ChatBackend = createAcpBackend('goose')
export const openclawBackend: ChatBackend = createAcpBackend('openclaw')
export const hermesBackend: ChatBackend = createAcpBackend('hermes')
export const claudeCodeAcpBackend: ChatBackend =
    createAcpBackend('claude-code-acp')
export const codexAcpBackend: ChatBackend = createAcpBackend('codex-acp')

/** Every ACP-backed provider, in agents.ts order — spread into ../backends.ts's CHAT_BACKENDS /
 *  CHAT_BACKEND_LIST so this module is the ONLY place that has to know all six exist. */
export const ACP_BACKEND_LIST: readonly ChatBackend[] = [
    clineBackend,
    geminiBackend,
    gooseBackend,
    openclawBackend,
    hermesBackend,
    claudeCodeAcpBackend,
    codexAcpBackend,
]

// Kill any in-flight ACP agent subprocesses on backend shutdown (mirrors chat.ts/opencode.ts).
// ChatBackend itself has no "list every live id" verb (none of the other providers need one), so
// each createAcpBackend call registers its own closeChat-everything hook above instead.
let shuttingDown = false
function shutdownAll(): void {
    if (shuttingDown) return
    shuttingDown = true
    for (const hook of shutdownHooks) hook()
}
process.on('exit', shutdownAll)
