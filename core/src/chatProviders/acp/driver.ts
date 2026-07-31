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
// driver needs (JSON-RPC request/notification/response framing, the handful of methods listed in
// the ACP research report) is small — ./protocol.ts's envelope helpers are ~120 lines — and the
// SDK's own major version is visibly churning (1.3.0 today; the still-current claude-code-acp
// adapter pins 0.14.1 with materially different NewSessionResponse fields), which this driver
// already has to branch around via detectModelShape regardless of which JSON-RPC transport sends
// the bytes. Adding the dependency would not remove that branching, and would add a second
// generated-schema surface (Zod validators + `.gen.d.ts` types) to keep in sync with the very
// version skew the research report calls out as the central risk — hand-rolling keeps the whole
// wire contract in one small, readable, tolerant-by-construction file instead. Revisit if a future
// task wants request/response types generated from the SDK's schema directly.
//
// Lifecycle (mirrors ../opencode.ts's session registry conventions — Map<chatId, session>, emit /
// rebindSessionSink / scheduleSessionClose from ../sessionSink, a turn queue, process.on("exit")
// teardown, tolerant parsing that never throws into a user's chat):
//   1. openSession/sendMessage/resumeSession spawn the agent (if not already running for this
//      chat), `initialize`, then `session/new` (or `session/load`, falling back to `session/resume`
//      on a method-not-found error — the version-skew fallback the research report documents).
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
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatFrame, ChatImage, ChatSink } from "../../chat";
import { emit, rebindSessionSink, scheduleSessionClose } from "../sessionSink";
import { claudeSpawnEnv, whichBinary } from "../../claudeWhich";
import type { ChatBackend, ChatTurnContext } from "../backends";
import type { BackendId } from "../../agentBackends/catalog";
import { ACP_AGENTS, type AcpAgentSpec } from "./agents";
import type { FileSink } from "bun";
import { titleFromPrompt } from "../titleFromPrompt";
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
  translateSessionUpdate,
  type AcpManifestBaseline,
  type AcpMcpServerStdio,
  type AcpModelShapeInfo,
  type AcpNewSessionResult,
  type AcpOutboundContentBlock,
  type AcpPermissionOption,
  type AcpTranslateState,
  type JsonRpcInbound,
  type JsonRpcRequest,
} from "./protocol";

// ── Bismuth's own MCP binary (Surface 5 — the biggest ACP win: per-session injection, zero global
// config file) ──────────────────────────────────────────────────────────────────────────────────

/**
 * The installed `bismuth-mcp` binary, or null when the app never installed the machine-wide tools.
 * A deliberate literal duplicate of daemon/src/lib/bismuthPaths.ts's `mcpBin()` (same convention:
 * "the daemon is a separate workspace + separately-bundled binary, so it must not import across
 * into @bismuth/core") rather than importing core/src/bismuthInstall.ts's BIN_DIR/MCP_DEST — those
 * consts are private (not exported) and that file is concurrently owned by another task per this
 * task's brief (read-only). existsSync-gated so a machine where the app never installed the tools
 * degrades to an empty mcpServers array, never a crash.
 */
function bismuthMcpBin(): string | null {
  const p = join(homedir(), ".bismuth", "bin", "bismuth-mcp");
  return existsSync(p) ? p : null;
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
function buildMcpServers(vaultRoot: string, memoryDir?: string): AcpMcpServerStdio[] {
  const bin = bismuthMcpBin();
  if (!bin) return [];
  const env: { name: string; value: string }[] = [
    { name: "BISMUTH_VAULT", value: vaultRoot },
    { name: "BISMUTH_MCP_CHANNEL", value: "chat" },
    { name: "BISMUTH_AGENT_CHANNEL", value: "chat" },
  ];
  if (memoryDir) env.push({ name: "BISMUTH_MEMORY_DIR", value: memoryDir });
  return [{ name: "bismuth", command: bin, args: [], env }];
}

// ── initialize handshake params ────────────────────────────────────────────────────────────────

// GUESS: the research report verifies initialize's TOP-LEVEL shape
// ({protocolVersion, clientCapabilities, clientInfo} in, {protocolVersion, agentCapabilities,
// authMethods, agentInfo} out) but not clientCapabilities' own field names beyond one bundle-strings
// artifact ("an fs.readTextFile: z.boolean() capability flag" seen in cline's compiled binary).
// `protocolVersion: 1` mirrors the integer-version convention most JSON-RPC dev-tool protocols use
// (LSP et al) — untested against a real agent. clientCapabilities below declares NO fs/terminal
// support, which IS mandatory per this task's brief regardless of the exact shape: never claim a
// capability with no backing client-method implementation.
const INITIALIZE_PARAMS = {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: "Bismuth", version: "0.1.0" },
};

const ABORT_GRACE_MS = 8000;

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
 *  OPEN QUESTION, not verified either way: `npx`-spawned adapters (claude-code-acp, codex-acp,
 *  agents.ts's two `adapter: true` entries) put an `npx` WRAPPER process, not the real agent, as the
 *  direct child this module's `proc` handle names. Whether SIGKILL to that wrapper propagates to
 *  whatever real process npx itself spawned underneath (or leaves it orphaned) was never exercised —
 *  neither adapter was spawned during this task (no npx-resolvable install on the machine this was
 *  verified on). Flagged here rather than assumed either way; only cline/gemini/goose/openclaw (the
 *  four NATIVE, non-adapter agents) are actually confirmed covered by this escalation. */
const KILL_ESCALATION_GRACE_MS = 3000;

/** Send SIGTERM (`proc.kill()`), then SIGKILL after `graceMs` if `proc.exited` hasn't resolved by
 *  then — see KILL_ESCALATION_GRACE_MS's own doc comment for why this is required, not
 *  defense-in-depth, for at least one real agent (openclaw). Fire-and-forget: returns immediately,
 *  callers (closeChat, abortTurn's grace-timeout) stay synchronous exactly as before this existed.
 *  `proc` is the caller's own local/captured reference (never re-read from mutable session state
 *  inside this function), so a session that respawns its process in the meantime can't redirect
 *  which process this escalation ultimately signals — it always targets the exact process handle it
 *  was given. `.catch(() => {})` on the race itself (not only inside `.then`) matches this file's
 *  own convention for a `proc.exited` consumer that must never become an unhandled rejection (see
 *  watchExit's identical `.catch(() => {})` and raceExit's `.catch(() => finish(...))` above). */
function killWithEscalation(proc: ReturnType<typeof Bun.spawn>, graceMs: number): void {
  try {
    proc.kill();
  } catch {
    /* already exited */
  }
  void Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), graceMs)),
  ])
    .then((timedOut) => {
      if (!timedOut) return;
      try {
        proc.kill(9);
      } catch {
        /* already exited between the timeout firing and this call */
      }
    })
    .catch(() => {});
}

// ── Session state ───────────────────────────────────────────────────────────────────────────────

interface AcpPendingCall {
  resolve: (result: unknown) => void;
  reject: (err: unknown) => void;
}

interface AcpPendingPermission {
  /** The JSON-RPC request id to reply to (echoed back verbatim in encodeJsonRpcResult). */
  rpcId: number | string;
  options: AcpPermissionOption[];
}

interface AcpSession {
  id: string; // the chat id
  cwd: string;
  sink: ChatSink;
  proc: ReturnType<typeof Bun.spawn> | null;
  nextId: () => number;
  pendingCalls: Map<number, AcpPendingCall>;
  pendingPermissions: Map<string, AcpPendingPermission>;
  /** The ACP session id (learned from session/new, or supplied on resume). */
  sessionId: string | null;
  modelShape: AcpModelShapeInfo;
  translateState: AcpTranslateState;
  turnActive: boolean;
  /** Set by abortTurn right before session/cancel — cleared once session/prompt settles (its
   *  stopReason:"cancelled" is then NOT reported as an error), mirroring opencode.ts's `aborting`. */
  aborting: boolean;
  queue: { text: string; images?: ChatImage[] }[];
  detached: boolean;
  buffer: ChatFrame[];
  closeTimer?: ReturnType<typeof setTimeout>;
  titleSent: boolean;
  lastActivityAt: number;
  /** Undecoded tail of the stdout stream (a JSON-RPC line can arrive split across chunks). */
  stdoutPending: string;
  /** True once the fallbackArgs respawn has been tried (retried ONCE, never looped). */
  usedFallbackArgs: boolean;
}

function blankManifest(mcpServers: { name: string; status: string }[]): AcpManifestBaseline {
  return { model: "", permissionMode: "default", tools: [], mcpServers, slashCommands: [], commandDetails: {} };
}

// ── One ChatBackend per ACP agent (cline/gemini/goose/openclaw/claude-code-acp/codex-acp) ────────
// Each gets its OWN session Map + closes over its OWN AcpAgentSpec, so e.g. a "cline" chat id and a
// "gemini" chat id (however unlikely to collide) can never see each other's session state.

/** Every ACP backend's own "close every session I know about" — populated by createAcpBackend
 *  below (each closure's `sessions` map is private to it), drained by shutdownAll() so a backend
 *  restart never leaves an ACP agent subprocess running past it. */
const shutdownHooks: (() => void)[] = [];

function createAcpBackend(agentId: BackendId): ChatBackend {
  const found = ACP_AGENTS.find((a) => a.id === agentId);
  if (!found) throw new Error(`no ACP agent spec for backend id "${agentId}"`);
  // A plain typed const (not a narrowed reference) so every nested `function` declaration below —
  // TS doesn't carry a closure-captured variable's narrowing into hoisted function declarations,
  // only into arrow/expression closures defined after the guard — sees AcpAgentSpec, never
  // `AcpAgentSpec | undefined`.
  const agent: AcpAgentSpec = found;

  const sessions = new Map<string, AcpSession>();

  function spawnAcpProcess(bin: string, args: string[], cwd: string): ReturnType<typeof Bun.spawn> | null {
    try {
      return Bun.spawn([bin, ...args], {
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        // "chat": every ACP agent here is a chat backend. Stamps BISMUTH_AGENT_CHANNEL so a
        // `bismuth` invocation from THIS process's own shell/tool-use (not just through the MCP
        // server above) is gated by core/src/visibilityCliGate.ts.
        env: claudeSpawnEnv(process.env, "chat") as Record<string, string>,
      });
    } catch {
      return null;
    }
  }

  function writeToProc(s: AcpSession, text: string): void {
    if (!s.proc) return;
    try {
      // `ReturnType<typeof Bun.spawn>` collapses stdin's type to the general `FileSink | number |
      // undefined` union (the generic overload resolution loses the concrete `{stdin:"pipe"}` we
      // always pass to spawnAcpProcess) — cast to the FileSink shape that option actually produces.
      const stdin = s.proc.stdin as FileSink;
      stdin.write(text);
      stdin.flush();
    } catch {
      /* pipe closed — watchExit reports the teardown */
    }
  }

  function call(s: AcpSession, method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!s.proc) {
        reject(new Error(`${agent.label} is not running`));
        return;
      }
      const id = s.nextId();
      s.pendingCalls.set(id, { resolve, reject });
      writeToProc(s, encodeJsonRpcRequest(id, method, params));
    });
  }

  /** Answer the agent's `session/request_permission` call by parking it as a `permission` frame;
   *  anything else we don't implement gets a method-not-found reply (see the top-of-file note). */
  function handleAgentRequest(s: AcpSession, req: JsonRpcRequest): void {
    if (req.method === "session/request_permission") {
      const params = req.params && typeof req.params === "object" ? (req.params as Record<string, unknown>) : {};
      const toolCall = params.toolCall && typeof params.toolCall === "object" ? (params.toolCall as Record<string, unknown>) : {};
      const options = Array.isArray(params.options) ? (params.options as AcpPermissionOption[]) : [];
      const id = String(req.id);
      s.pendingPermissions.set(id, { rpcId: req.id, options });
      const toolName =
        (typeof toolCall.name === "string" && toolCall.name) ||
        (typeof toolCall.title === "string" && toolCall.title) ||
        (typeof toolCall.kind === "string" && toolCall.kind) ||
        "tool";
      emit(s, { type: "permission", id, toolName, input: toolCallInput(toolCall) ?? {} });
      return;
    }
    writeToProc(s, encodeJsonRpcError(req.id, -32601, `Bismuth's ACP client does not implement ${req.method}`));
  }

  function handleInbound(s: AcpSession, msg: JsonRpcInbound): void {
    if (isJsonRpcResponse(msg)) {
      const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
      const pending = s.pendingCalls.get(id);
      if (!pending) return;
      s.pendingCalls.delete(id);
      if ("error" in msg) pending.reject(new AcpRpcError(msg.error.code, msg.error.message));
      else pending.resolve(msg.result);
      return;
    }
    if (isJsonRpcNotification(msg)) {
      if (msg.method === "session/update") {
        const params = msg.params && typeof msg.params === "object" ? (msg.params as Record<string, unknown>) : {};
        for (const frame of translateSessionUpdate(params.update, s.translateState)) emit(s, frame);
      }
      return;
    }
    if (isJsonRpcRequest(msg)) handleAgentRequest(s, msg);
  }

  function startReadLoop(s: AcpSession, proc: ReturnType<typeof Bun.spawn>): void {
    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    const decoder = new TextDecoder();
    (async () => {
      try {
        for await (const chunk of stdout) {
          if (s.proc !== proc) return; // superseded by a fallbackArgs respawn
          s.stdoutPending += decoder.decode(chunk, { stream: true });
          let nl: number;
          while ((nl = s.stdoutPending.indexOf("\n")) >= 0) {
            const raw = s.stdoutPending.slice(0, nl);
            s.stdoutPending = s.stdoutPending.slice(nl + 1);
            const msg = parseJsonRpcLine(raw);
            if (msg) handleInbound(s, msg);
          }
        }
      } catch {
        /* stream torn down (kill/exit) — watchExit reports the outcome */
      }
    })();
  }

  /** The child died (crash, or a deliberate abort-timeout kill). A respawn superseding this proc
   *  (fallbackArgs retry) is NOT a teardown — guarded by identity, not just session lookup. */
  function watchExit(s: AcpSession, proc: ReturnType<typeof Bun.spawn>): void {
    proc.exited
      .then(() => {
        if (s.proc !== proc) return; // superseded — the fallbackArgs respawn owns teardown now
        if (sessions.get(s.id) !== s) return; // already closed deliberately via closeChat
        sessions.delete(s.id);
        const message = `${agent.label} exited unexpectedly.`;
        for (const [, p] of s.pendingCalls) p.reject(new Error(message));
        s.pendingCalls.clear();
        s.pendingPermissions.clear(); // the pipe is gone — nothing left to reply to
        if (s.turnActive) {
          s.turnActive = false;
          emit(s, { type: "result", isError: true, numTurns: 1, costUsd: s.translateState.costUsd });
          emit(s, { type: "done" });
        }
        emit(s, { type: "error", code: "exit", message });
      })
      .catch(() => {});
  }

  function attachProc(s: AcpSession, proc: ReturnType<typeof Bun.spawn>): void {
    s.proc = proc;
    s.stdoutPending = "";
    s.nextId = createIdMinter();
    startReadLoop(s, proc);
    watchExit(s, proc);
  }

  /** Await `promise`, but resolve early (exited:true) if the process exits first — the signal
   *  handshake()'s fallbackArgs retry watches for ("the process exits before initialize responds",
   *  per the ACP research report). Untested against a real agent binary (none installed here). */
  function raceExit(s: AcpSession, promise: Promise<unknown>): Promise<{ ok: boolean; exited: boolean }> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (r: { ok: boolean; exited: boolean }) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const proc = s.proc;
      if (proc) proc.exited.then(() => finish({ ok: false, exited: true })).catch(() => finish({ ok: false, exited: true }));
      promise.then(() => finish({ ok: true, exited: false })).catch(() => finish({ ok: false, exited: false }));
    });
  }

  /** `initialize`, retried ONCE with agents.ts's fallbackArgs if the process exits before it
   *  responds — the version-uncertain flag spelling (e.g. Gemini CLI's --experimental-acp vs
   *  --acp) is tolerated by trying the documented spelling first and only reaching for the guess
   *  if the CLI's own exit tells us the flag didn't parse. */
  async function handshake(s: AcpSession): Promise<boolean> {
    const first = await raceExit(s, call(s, "initialize", INITIALIZE_PARAMS));
    if (first.ok) return true;
    if (!first.exited || !agent.fallbackArgs || s.usedFallbackArgs) return false;
    s.usedFallbackArgs = true;
    const bin = whichBinary(agent.binary);
    if (!bin) return false;
    // Same per-chat argv extension as createSession's primary spawn (s.id is the chat id — see
    // AcpSession's own `id` field doc comment) — currently dead for every agent that HAS
    // fallbackArgs (only gemini, which has no sessionKeyArgs), kept consistent in case a future
    // agent ever needs both.
    const fallbackSpawnArgs = [...agent.fallbackArgs, ...(agent.sessionKeyArgs?.(s.id) ?? [])];
    const proc = spawnAcpProcess(bin, fallbackSpawnArgs, s.cwd);
    if (!proc) return false;
    attachProc(s, proc);
    const second = await raceExit(s, call(s, "initialize", INITIALIZE_PARAMS));
    return second.ok;
  }

  async function createSession(
    chatId: string,
    cwd: string,
    sink: ChatSink,
    memoryDir: string | undefined,
    resumeId?: string,
  ): Promise<AcpSession | null> {
    const bin = whichBinary(agent.binary);
    if (!bin) {
      sink({
        type: "error",
        code: "no-binary",
        binary: agent.binary,
        message: `The \`${agent.binary}\` CLI was not found. Install ${agent.label} to use this provider.`,
      });
      return null;
    }
    // agent.sessionKeyArgs (currently only openclaw): a per-CHAT argv extension, computed from THIS
    // call's own chatId (already a parameter above — nothing new needed to reach it here). See
    // agents.ts's openclaw entry for why a per-chat session key is required, not optional: a fixed
    // constant here was shipped once and reverted after review found it leaks one chat's content
    // into another's upstream request (the openclaw isolation test in openclawMocked.test.ts proves
    // this stays closed). Every other agent leaves this undefined and gets byte-identical argv to
    // before this field existed.
    const spawnArgs = [...agent.args, ...(agent.sessionKeyArgs?.(chatId) ?? [])];
    const proc = spawnAcpProcess(bin, spawnArgs, cwd);
    if (!proc) {
      sink({ type: "error", code: "spawn", message: `Failed to start ${agent.label}.` });
      return null;
    }
    // agent.supportsSessionMcpServers === false (currently only openclaw — see its own agents.ts
    // comment for the live-confirmed citation): that agent's session/new REJECTS a non-empty
    // mcpServers array outright rather than ignoring/merging it, so sending [] here is required for
    // EVERY turn to succeed at all, not an optional degrade.
    const mcpServers = agent.supportsSessionMcpServers === false ? [] : buildMcpServers(cwd, memoryDir);
    const s: AcpSession = {
      id: chatId,
      cwd,
      sink,
      proc: null,
      nextId: createIdMinter(),
      pendingCalls: new Map(),
      pendingPermissions: new Map(),
      sessionId: null,
      modelShape: { shape: "none", models: [], currentModelId: null, modelConfigId: null, effortConfigId: null },
      translateState: newAcpTranslateState(blankManifest(mcpServers.map((m) => ({ name: m.name, status: "connected" })))),
      turnActive: false,
      aborting: false,
      queue: [],
      detached: false,
      buffer: [],
      titleSent: false,
      lastActivityAt: Date.now(),
      stdoutPending: "",
      usedFallbackArgs: false,
    };
    sessions.set(chatId, s);
    attachProc(s, proc);

    const handshakeOk = await handshake(s);
    if (sessions.get(chatId) !== s) return null; // closed while we awaited
    if (!handshakeOk) {
      emit(s, { type: "error", code: "spawn", message: `${agent.label} did not complete the ACP handshake.` });
      closeChat(chatId);
      return null;
    }

    try {
      let result: unknown;
      if (resumeId) {
        try {
          result = await call(s, "session/load", { sessionId: resumeId, cwd, mcpServers });
        } catch (e) {
          if (!isMethodNotFoundError(e)) throw e;
          result = await call(s, "session/resume", { sessionId: resumeId, cwd, mcpServers });
        }
        s.sessionId = resumeId;
      } else {
        const created = (await call(s, "session/new", { cwd, mcpServers })) as AcpNewSessionResult;
        result = created;
        s.sessionId = typeof created?.sessionId === "string" && created.sessionId ? created.sessionId : null;
      }
      if (sessions.get(chatId) !== s) return null; // closed while we awaited
      s.modelShape = detectModelShape(result);
      s.translateState.manifest.model = s.modelShape.currentModelId ?? "";
    } catch (e) {
      emit(s, {
        type: "error",
        code: "error",
        message: `${agent.label} could not start a session: ${e instanceof Error ? e.message : String(e)}`,
      });
      closeChat(chatId);
      return null;
    }

    emit(s, { type: "manifest", manifest: { ...s.translateState.manifest } });
    if (s.modelShape.models.length) emit(s, { type: "models", models: s.modelShape.models });
    // origin "user", always: the daemon runs on the Claude Code SDK and records ITS session ids in
    // <vault>/.daemon/session-ids — an ACP session id comes from a per-agent id namespace that can
    // never be the daemon's (mirrors opencode.ts's emitOpenFrames reasoning).
    if (s.sessionId) emit(s, { type: "session", sessionId: s.sessionId, origin: "user" });
    return s;
  }

  function runOrQueue(s: AcpSession, text: string, images?: ChatImage[]): void {
    if (s.turnActive) {
      s.queue.push({ text, images });
      return;
    }
    void runTurn(s, text, images);
  }

  async function runTurn(s: AcpSession, text: string, images?: ChatImage[]): Promise<void> {
    s.turnActive = true;
    s.lastActivityAt = Date.now();
    const prompt: AcpOutboundContentBlock[] = [];
    if (text) prompt.push({ type: "text", text });
    for (const im of images ?? []) prompt.push({ type: "image", data: im.data, mimeType: im.media_type });
    if (!prompt.length) prompt.push({ type: "text", text: "" });

    let result: unknown = null;
    let hardError: string | null = null;
    try {
      result = await call(s, "session/prompt", { sessionId: s.sessionId, prompt });
    } catch (e) {
      hardError = e instanceof Error ? e.message : String(e);
    }
    if (sessions.get(s.id) !== s) return; // torn down mid-turn (closeChat, or watchExit already reported it)

    s.aborting = false;
    if (hardError) {
      emit(s, { type: "error", code: "error", message: hardError });
      emit(s, { type: "result", isError: true, numTurns: 1, costUsd: s.translateState.costUsd });
    } else {
      const stopReason = result && typeof result === "object" ? (result as Record<string, unknown>).stopReason : null;
      // "cancelled" ends the turn cleanly (mirrors opencode.ts's `aborting` flag) — only a genuine
      // model refusal is reported as a turn error; max_tokens/max_turn_requests still succeeded a
      // turn, just an incomplete one, same as Claude's own result reporting.
      const isError = stopReason === "refusal";
      emit(s, { type: "result", isError, numTurns: 1, costUsd: s.translateState.costUsd });
    }
    emit(s, { type: "done" });
    if (!s.titleSent) {
      const title = titleFromPrompt(text);
      if (title) {
        s.titleSent = true;
        emit(s, { type: "title", title });
      }
    }
    s.turnActive = false;
    s.lastActivityAt = Date.now();
    const next = s.queue.shift();
    if (next) void runTurn(s, next.text, next.images);
  }

  function closeChat(chatId: string): void {
    const s = sessions.get(chatId);
    if (!s) return;
    sessions.delete(chatId);
    if (s.closeTimer) clearTimeout(s.closeTimer);
    s.queue = [];
    for (const [, p] of s.pendingCalls) p.reject(new Error("chat closed"));
    s.pendingCalls.clear();
    s.pendingPermissions.clear();
    // closeChat() itself stays synchronous (signature/callers unchanged) — killWithEscalation is
    // fire-and-forget and force-kills a process that ignores the graceful signal, rather than
    // leaving it running past this chat indefinitely. See KILL_ESCALATION_GRACE_MS's own doc comment
    // for why this is required for a real agent (openclaw), not speculative hardening.
    if (s.proc) killWithEscalation(s.proc, KILL_ESCALATION_GRACE_MS);
  }

  shutdownHooks.push(() => {
    for (const id of Array.from(sessions.keys())) closeChat(id);
  });

  return {
    id: agentId,

    hasSession: (chatId) => sessions.has(chatId),

    openSession: (ctx: ChatTurnContext) => {
      if (sessions.has(ctx.chatId)) return;
      void createSession(ctx.chatId, ctx.cwd, ctx.sink, ctx.memoryDir);
    },

    sendMessage: (ctx: ChatTurnContext & { text: string }) => {
      const existing = sessions.get(ctx.chatId);
      if (!existing) {
        void (async () => {
          const created = await createSession(ctx.chatId, ctx.cwd, ctx.sink, ctx.memoryDir);
          if (!created) return;
          runOrQueue(created, ctx.text, ctx.images);
        })();
        return;
      }
      if (existing.closeTimer) {
        clearTimeout(existing.closeTimer);
        existing.closeTimer = undefined;
      }
      existing.sink = ctx.sink;
      existing.detached = false;
      existing.cwd = ctx.cwd;
      runOrQueue(existing, ctx.text, ctx.images);
    },

    resumeSession: (ctx: ChatTurnContext & { sessionId: string }) => {
      if (sessions.has(ctx.chatId)) closeChat(ctx.chatId);
      void createSession(ctx.chatId, ctx.cwd, ctx.sink, ctx.memoryDir, ctx.sessionId);
    },

    // ACP has no transcript-export method (confirmed absent in the research report) — historyReplay
    // is declared false in the catalog; this only satisfies the ChatBackend interface.
    sessionHistoryFrames: async () => [],

    abortTurn: (chatId: string) => {
      const s = sessions.get(chatId);
      if (!s || !s.turnActive) return;
      s.aborting = true;
      s.queue = [];
      if (s.sessionId) writeToProc(s, encodeJsonRpcNotification("session/cancel", { sessionId: s.sessionId }));
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
        const cur = sessions.get(chatId);
        if (cur === s && cur.turnActive && cur.aborting && cur.proc) {
          killWithEscalation(cur.proc, KILL_ESCALATION_GRACE_MS);
        }
      }, ABORT_GRACE_MS);
    },

    setModel: (chatId: string, model: string) => {
      const s = sessions.get(chatId);
      if (!s || !s.sessionId) return;
      if (s.modelShape.shape === "new" && s.modelShape.modelConfigId) {
        const configId = s.modelShape.modelConfigId;
        void call(s, "session/set_config_option", { sessionId: s.sessionId, configId, value: model })
          .then(() => {
            s.modelShape = { ...s.modelShape, currentModelId: model };
            s.translateState.manifest.model = model;
          })
          .catch(() => {
            /* best-effort — a rejected switch just leaves the previous model active */
          });
      } else if (s.modelShape.shape === "old") {
        // GUESS: session/set_model's param shape is not detailed in the research report beyond the
        // method name itself — mirrored off NewSessionResponse.models.currentModelId's field
        // naming. Untested against a real 0.14.x-era agent (claude-code-acp/cline).
        void call(s, "session/set_model", { sessionId: s.sessionId, modelId: model })
          .then(() => {
            s.modelShape = { ...s.modelShape, currentModelId: model };
            s.translateState.manifest.model = model;
          })
          .catch(() => {});
      }
    },

    closeChat,

    scheduleClose: (chatId: string, ms: number) => {
      const s = sessions.get(chatId);
      if (!s) return;
      scheduleSessionClose(s, ms, () => closeChat(chatId));
    },

    rebindSink: (chatId: string, sink: ChatSink) => {
      const s = sessions.get(chatId);
      if (!s) return false;
      rebindSessionSink(s, sink);
      return true;
    },

    detachSink: (chatId: string) => {
      const s = sessions.get(chatId);
      if (!s) return;
      s.detached = true;
    },

    respondPermission: (chatId: string, id: string, behavior: "allow" | "deny", always?: boolean) => {
      const s = sessions.get(chatId);
      if (!s) return;
      const pending = s.pendingPermissions.get(id);
      if (!pending) return;
      s.pendingPermissions.delete(id);
      const optionId = choosePermissionOption(pending.options, { behavior, always });
      const outcome = optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" };
      writeToProc(s, encodeJsonRpcResult(pending.rpcId, { outcome }));
    },

    // Deliberately NOT implemented here: setPermissionMode and respondQuestion. ACP's
    // `session/set_mode` is a generic session-mode concept (verified to exist), but not documented
    // as the same Default/Plan/Accept-Edits/Bypass vocabulary Claude's permission-mode picker
    // offers, and no ACP session/update kind carries an AskUserQuestion-style multi-choice prompt
    // (only session/request_permission, implemented above as respondPermission) — mapping either
    // onto ACP would be a guess with no research backing. Net effect: the header's permission-mode
    // picker still RENDERS (this task's brief sets permissionModes:true for the live permission
    // prompts respondPermission answers), but picking a mode is a no-op for every ACP backend — a
    // known rough edge, called out in this task's final report.
    setEffort: (chatId: string, effort: string) => {
      const s = sessions.get(chatId);
      if (!s || !s.sessionId || !s.modelShape.effortConfigId) return;
      const configId = s.modelShape.effortConfigId;
      void call(s, "session/set_config_option", { sessionId: s.sessionId, configId, value: effort }).catch(() => {});
    },
  };
}

export const clineBackend: ChatBackend = createAcpBackend("cline");
export const geminiBackend: ChatBackend = createAcpBackend("gemini");
export const gooseBackend: ChatBackend = createAcpBackend("goose");
export const openclawBackend: ChatBackend = createAcpBackend("openclaw");
export const claudeCodeAcpBackend: ChatBackend = createAcpBackend("claude-code-acp");
export const codexAcpBackend: ChatBackend = createAcpBackend("codex-acp");

/** Every ACP-backed provider, in agents.ts order — spread into ../backends.ts's CHAT_BACKENDS /
 *  CHAT_BACKEND_LIST so this module is the ONLY place that has to know all six exist. */
export const ACP_BACKEND_LIST: readonly ChatBackend[] = [
  clineBackend,
  geminiBackend,
  gooseBackend,
  openclawBackend,
  claudeCodeAcpBackend,
  codexAcpBackend,
];

// Kill any in-flight ACP agent subprocesses on backend shutdown (mirrors chat.ts/opencode.ts).
// ChatBackend itself has no "list every live id" verb (none of the other providers need one), so
// each createAcpBackend call registers its own closeChat-everything hook above instead.
let shuttingDown = false;
function shutdownAll(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const hook of shutdownHooks) hook();
}
process.on("exit", shutdownAll);
