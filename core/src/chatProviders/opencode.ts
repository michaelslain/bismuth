// core/src/chatProviders/opencode.ts
// The opencode chat provider: drives the user's own `opencode` CLI and speaks the SAME ChatFrame
// wire protocol chat.ts does, so ChatView renders an opencode conversation with zero rendering
// changes. TWO session modes coexist behind one registry/sink/queue (SessionSink from ./sessionSink,
// shared with chat.ts and the ACP driver):
//
//  - SERVER mode (preferred): one persistent `opencode serve` process, owned by
//    ./opencodeServer.ts and shared by every opencode chat this core process hosts (lazily started
//    on the first opencode chat, never one-per-chat). Sessions/turns ride @opencode-ai/sdk's typed
//    HTTP client; real-time deltas/tool progress/permission asks ride the server's GLOBAL event
//    stream (one subscription for the whole process — see opencodeServer.ts). This closes the
//    degradations the old per-turn subprocess had: real token-level streaming
//    (`message.part.delta`), a genuine permission request/response cycle (`permission.asked` +
//    `postSessionIdPermissionsPermissionId`), image attachments (`FilePartInput` with a `data:` URL),
//    and per-turn memory injection (`session.prompt`'s `system` field, from recallMemory).
//  - RUN mode (fallback): the ORIGINAL one `opencode run --format json` subprocess PER TURN,
//    continued with `-s <sessionID>`. Used when `ensureOpencodeServer` reports the installed opencode
//    can't serve (no `serve` subcommand, or the startup banner never appears within its timeout) —
//    kept verbatim so an older opencode install still works, just without the server-mode wins above.
//    stdout is NDJSON (one event per line) → translateOpencodeEvent → ChatFrames; `--auto` auto-
//    approves permissions (no way to park on a prompt in this mode); images are refused with a
//    friendly error (see dispatchTurn).
//
// A session's mode is decided ONCE, at creation (whichever `ensureOpencodeServer` resolves to at that
// moment), and never flips mid-session — a session started before opencode's server support was
// detected (or before the shared server crashed) simply keeps running the mode it started in.
//
// VISIBILITY GATE (docs/vault/visibility.md): opencode has no native per-path deny of its own, so
// the only real gate available is agentBackends/sandboxWrapper.ts's OS-level Seatbelt wrapper. A
// prior design pass verified the raw mechanism live against a real `opencode run` turn
// (opencode/deepseek-v4-flash-free, $0 cost via Zen's free rotation — see /private/tmp/claude-501/-Users-michaelslain-Documents-dev-bismuth/28ea2c63-ba06-4a2e-b1e2-e93bc7fd4baf/scratchpad/visibility/DESIGN.md
// §2.5); THIS integration (getOrCreateSession/runTurnLegacy/runTurn below) was independently
// re-verified live end to end through openSession/setModel/sendMessage exactly as chatProviders/
// index.ts calls them — opencode/big-pickle (also a free Zen model, $0 cost) — the read tool AND a
// Bash `cat` fallback of a hidden note were BOTH denied in one real turn, with the secret in no
// frame, while a sibling PUBLIC note in the SAME restricted vault stayed fully readable in a second
// turn (the wrapper gates per-file, not per-vault). Two hard consequences follow:
//  - The wrapper can only apply to a DEDICATED per-turn subprocess (sandboxWrapper.ts's P3), never
//    the shared `opencode serve` process — that ONE process is multiplexed across every vault this
//    core hosts, so a profile scoped to one vault's restricted files can't be applied to it without
//    leaking (or wrongly restricting) every OTHER vault's session on the same process. A RESTRICTED
//    vault is therefore forced onto RUN mode unconditionally — see getOrCreateSession below — even
//    when the installed opencode is perfectly capable of serving.
//  - Where the wrapper itself is unavailable (non-macOS, `sandbox-exec` missing — see
//    checkSandboxWrapperAvailability) and the vault restricts anything, the session/turn is REFUSED
//    outright. Never silently spawn unwrapped: a gate that quietly does nothing on failure isn't one.
// An UNRESTRICTED vault (buildDenyPaths returns nothing) is completely unaffected by any of this —
// the feature stays invisible until the vault actually marks something hidden/chat-only.
//
// Both modes share: the Zen free-model rotation (`withZenFreeRotate`/`pickZenFreeModel`, card #90),
// the command registry powering `/` autocomplete (server mode: `GET /command`; run mode: `opencode
// debug config` + built-ins), the auth pill (`opencode auth list` — a plain CLI spawn, safe to run
// alongside a live server: it only reads `~/.local/share/opencode/auth.json`, verified live to not
// contend with the server's own sqlite), "a run that streamed an error still exits 0" rule (run mode
// only — server mode gets its error signal from the awaited HTTP response, not an exit code), and the
// sqlite-cold-start serialization note (run mode's `ensureOpenInfo`/first-turn spawns stay
// sequential — irrelevant once a server is already up and warm).
import type { ChatFrame, ChatImage, ChatSink } from "../chat";
import { recallMemory } from "@bismuth/memory";
import { detachSessionSink, emit, reattachSessionSink, rebindSessionSink, scheduleSessionClose } from "./sessionSink";
import { claudeLookupPath, claudeSpawnEnv } from "../claudeWhich";
import { ensureOpencodeServer, registerOpencodeServerListener, type OpencodeServerHandle } from "./opencodeServer";
import { buildDenyPaths, buildSandboxDenyPaths, type DenyEntry } from "../visibility";
import { can } from "../agentBackends/catalog";
import {
  checkSandboxWrapperAvailability,
  describeSandboxWrapperUnavailable,
  isSandboxApplyFailure,
  materializeSandboxProfile,
  wrapArgv,
} from "../agentBackends/sandboxWrapper";
import {
  buildOpencodePromptParts,
  commandEntriesFromApi,
  modelEntriesFromProviders,
  newOpencodeServerTurnState,
  reconcileOpencodeFinalParts,
  newOpencodeTurnState,
  opencodeErrorMessage,
  opencodePermissionResponse,
  opencodeTitleFromPrompt,
  parseOpencodeAuthList,
  parseOpencodeDebugConfigCommands,
  parseOpencodeModels,
  parseOpencodeModelsVerbose,
  parseOpencodePermissionAsk,
  parseOpencodeRunCommand,
  pickZenFreeModel,
  splitOpencodeModelId,
  translateOpencodeEvent,
  translateOpencodeExport,
  translateOpencodeServerEvent,
  translateOpencodeSessionMessages,
  withOpencodeBuiltinCommands,
  withZenFreeRotate,
  zenFreeModelIds,
  ZEN_FREE_ROTATE_ID,
  type OpencodeCommandEntry,
  type OpencodeModelEntry,
} from "./opencodeTranslate";

/** Resolve the user's `opencode` binary against the SAME augmented PATH claude resolution uses
 *  (homebrew / ~/.local/bin / nvm / POSIX dirs — a Finder-launched bundle sees a minimal PATH). */
export function whichOpencode(): string | null {
  return Bun.which("opencode", { PATH: claudeLookupPath() });
}

interface OpencodeSession {
  id: string;
  cwd: string;
  sink: ChatSink;
  /** opencode's durable session id (ses_…), learned from server.session.create()/the first run's
   *  events; preset when resuming. `-s`/the server session id continues it on every later turn. */
  sessionId: string | null;
  /** The `provider/model` the user picked in the header (set_model); rides every turn. */
  model?: string;
  bin: string;
  /** Decided once at session creation — see top-of-file note. */
  mode: "server" | "run";
  /** This vault's `.daemon/memory` when the daemon is enabled — gates per-turn memory injection
   *  (server mode only; run mode has no system-prompt override to inject it through). */
  memoryDir?: string;
  /** The in-flight turn's child process (run mode only; killed by abortTurn/closeChat). */
  proc: ReturnType<typeof Bun.spawn> | null;
  turnActive: boolean;
  /** Set by abortTurn right before killing/cancelling the turn, so the completion handler reports a
   *  deliberate Stop (isError:false), mirroring ChatSession.aborting. */
  aborting: boolean;
  /** Turns staged while one is in flight (the client also queues; this is the backend guard). */
  queue: { text: string; images?: ChatImage[] }[];
  /** Completed-turn count — drives the Zen free-model ROTATION (turn N runs free model N mod roster
   *  size) when the virtual `ZEN_FREE_ROTATE_ID` is the selected model. */
  turnCount: number;
  detached: boolean;
  buffer: ChatFrame[];
  closeTimer?: ReturnType<typeof setTimeout>;
  titleSent?: boolean;
  lastActivityAt: number;
  /** Permission ids this session has asked about and not yet answered (server mode only) — guards
   *  respondPermission against answering an id twice or one from a stale/foreign session. */
  pendingPermissions: Set<string>;
}

// Frame buffering + reconnect lifecycle (emit / rebindSessionSink / scheduleSessionClose) is
// transport-agnostic and shared with the Claude provider — see ./sessionSink. OpencodeSession
// satisfies its SessionSink shape structurally.

const sessions = new Map<string, OpencodeSession>();

export function hasSession(chatId: string): boolean {
  return sessions.has(chatId);
}

export function sessionCount(): number {
  return sessions.size;
}

/**
 * `claudeSpawnEnv`'s env, with `PWD` forced to match `cwd`. LIVE-VERIFIED load-bearing fix: Bun's
 * `cwd` spawn option correctly `chdir()`s the child before exec, but does NOT update the inherited
 * `PWD` environment variable — and `opencode run` was found to trust `PWD` over the process's real
 * working directory. Reproduced directly: spawning `opencode run` with `cwd: "/tmp/ocwd-test"` but
 * an inherited `PWD` from a DIFFERENT directory made its own `bash` tool's `pwd`/`cat` operate in
 * the STALE PWD directory, not the one just `chdir()`'d to; forcing `PWD` to match `cwd` (or passing
 * `--dir <cwd>` — this is the cheaper fix, no extra argv) made every tool call resolve correctly.
 * `claudeSpawnEnv` itself just spreads the CALLING process's env (Bismuth's own core server's own
 * launch directory, irrelevant to any vault it serves), so every opencode spawn in this file must
 * override PWD explicitly or a stale one silently redirects the whole turn to the wrong directory.
 * This is exactly why the visibility gate matters here beyond "denies the right paths": the deny
 * list (buildDenyPaths/materializeSandboxProfile, both keyed on `cwd`) and the agent's actual
 * operating directory must be THE SAME directory, or a deny list is enforcement theater — it would
 * faithfully deny paths under a vault the agent was never even operating in.
 */
function opencodeSpawnEnv(cwd: string): Record<string, string> {
  return { ...claudeSpawnEnv(process.env, "chat"), PWD: cwd } as Record<string, string>;
}

/** One opencode CLI invocation → stdout text (stderr ignored). Every RUN-mode open-time discovery
 *  (`models`, `debug config`) and the auth pill (`auth list`, BOTH modes) goes through here. */
async function runCliText(bin: string, cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([bin, ...args], { cwd, stdout: "pipe", stderr: "ignore", env: opencodeSpawnEnv(cwd) });
  const out = await new Response(proc.stdout as ReadableStream).text();
  await proc.exited;
  return out;
}

// Models + commands are static per opencode config — fetch once per process and reuse for every
// session's open frames. SERVER mode reads them straight off the typed API (`config.providers()` +
// `command.list()` — richer than text-scraping and no extra subprocess per fetch); RUN mode falls
// back to the original CLI-text parse (each call takes ~1.4s; still worth caching per process). The
// two RUN-mode fetches stay SEQUENTIAL in one shared promise: opencode's local sqlite rejects
// concurrent openers at cold start ("database is locked" — observed live), so open-time CLI spawns
// must never race each other (or the first turn — runTurnLegacy awaits this same promise). That
// concern doesn't apply to server mode (the server is already up and warm by the time this runs).
let modelsCache: OpencodeModelEntry[] | null = null;
let commandsCache: OpencodeCommandEntry[] | null = null;
let openInfoInFlight: Promise<void> | null = null;
function ensureOpenInfo(bin: string, cwd: string, server: OpencodeServerHandle | null): Promise<void> {
  if (!openInfoInFlight) {
    openInfoInFlight = (async () => {
      if (server) {
        try {
          const res = await server.client.config.providers({ query: { directory: cwd } });
          modelsCache = res.data ? modelEntriesFromProviders(res.data.providers) : [];
        } catch {
          modelsCache = [];
        }
        try {
          const res = await server.client.command.list({ query: { directory: cwd } });
          commandsCache = withOpencodeBuiltinCommands(res.data ? commandEntriesFromApi(res.data) : []);
        } catch {
          commandsCache = withOpencodeBuiltinCommands([]); // built-ins need no config — always offer them
        }
        return;
      }
      try {
        modelsCache = parseOpencodeModelsVerbose(await runCliText(bin, cwd, ["models", "--verbose"]));
        if (!modelsCache.length) modelsCache = parseOpencodeModels(await runCliText(bin, cwd, ["models"]));
      } catch {
        modelsCache = [];
      }
      try {
        commandsCache = withOpencodeBuiltinCommands(parseOpencodeDebugConfigCommands(await runCliText(bin, cwd, ["debug", "config"])));
      } catch {
        commandsCache = withOpencodeBuiltinCommands([]);
      }
    })();
  }
  return openInfoInFlight;
}

/** The manifest frame for an opencode session: the command registry rides `slashCommands` (so the
 *  composer's "/" popover autocompletes opencode commands exactly like Claude's) with per-command
 *  blurbs in `commandDetails`; tools/MCP stay empty (nothing to report — the frontend hides those
 *  pills) and permissionMode is nominal — server-mode sessions CAN answer a live permission ask (see
 *  `permission` frames below), but there is still no drivable mode-switch, so the header's
 *  mode-picker string stays "default" either way (the picker itself is gated on the separate
 *  `permissionModes` capability, which stays false). */
function manifestFrame(s: OpencodeSession): ChatFrame {
  const commands = commandsCache ?? [];
  return {
    type: "manifest",
    manifest: {
      model: s.model ?? "",
      permissionMode: "default",
      slashCommands: commands.map((c) => c.name),
      tools: [],
      mcpServers: [],
      commandDetails: Object.fromEntries(commands.filter((c) => c.description).map((c) => [c.name, c.description])),
    },
  };
}

/** Emit the open-time header frames for a fresh/resumed session: the manifest (re-emitted once the
 *  command registry lands, when the first one went out before the fetch finished), the `models`
 *  frame (with the virtual "Zen Free (rotating)" entry prepended when Zen's free roster is
 *  non-empty), and the `auth` frame (`opencode auth list`, re-fetched per open so logging in via a
 *  terminal shows up on the next chat/new-chat without restarting the app). */
function emitOpenFrames(s: OpencodeSession, server: OpencodeServerHandle | null): void {
  const hadCommands = commandsCache !== null;
  emit(s, manifestFrame(s));
  // origin "user", always: the daemon runs on the Claude Code SDK and records ITS session ids in
  // <vault>/.daemon/session-ids. An opencode session id comes from a different store in a different
  // id namespace, so it can never be the daemon's — no membership test to make.
  if (s.sessionId) emit(s, { type: "session", sessionId: s.sessionId, origin: "user" });
  void ensureOpenInfo(s.bin, s.cwd, server).then(async () => {
    if (sessions.get(s.id) !== s) return;
    if (!hadCommands && commandsCache?.length) emit(s, manifestFrame(s));
    const models = withZenFreeRotate(modelsCache ?? []);
    if (models.length) emit(s, { type: "models", models });
    const providers = parseOpencodeAuthList(await runCliText(s.bin, s.cwd, ["auth", "list"]).catch(() => ""));
    if (sessions.get(s.id) === s) emit(s, { type: "auth", providers });
  });
}

/** Human-facing refusal text for a restricted vault opencode can't (or can no longer) protect —
 *  shared by session open (getOrCreateSession) and every per-turn re-check (runTurnLegacy, runTurn's
 *  server-mode guard). `why` names the SPECIFIC unmet precondition — never a vague "can't protect
 *  this" — so the message never claims a mechanism that wasn't actually checked.
 *
 *  DISTINCT from core/src/chat.ts's `visibilityRefusalMessage`, and deliberately not merged with it:
 *  that one answers "this backend has no verified mechanism at all" (decided up-front by the router's
 *  chokepoint, agentBackends/visibilityGate.ts), whereas this one answers "opencode normally CAN
 *  enforce, but a specific precondition failed right here" — wrong platform, no sandbox-exec, or a
 *  session already bound to shared server mode. The `why` is the whole value; collapsing the two
 *  would throw it away. Renamed off the shared name so the distinction is visible at every call. */
function opencodePreconditionRefusal(denyEntries: DenyEntry[], why: string): string {
  const n = denyEntries.length;
  return (
    `This vault marks ${n} note${n === 1 ? "" : "s"} off-limits to AI sessions, but ${why}. ` +
    "Switch to Claude Code, or clear the vault's hidden/chat-only notes to use opencode here."
  );
}

/** What the user sees when the vault's restricted set could not be enumerated at all. Distinct from
 *  opencodePreconditionRefusal, which is about a KNOWN restricted set this backend can't enforce. */
function undeterminedRefusal(reason: string): string {
  return (
    "Bismuth couldn't read this vault's visibility settings, so this chat wasn't started rather " +
    `than risk running without them (${reason}). Check the vault's \`.settings\` file, then try again.`
  );
}

/** The restricted set for this vault's chat channel, or the REASON the walk could not determine it.
 *  `buildDenyPaths` throws rather than reporting an empty set for a vault it failed to read (see
 *  core/src/visibility.ts's DenyPlan); every caller here refuses on `undetermined`.
 *
 *  Carries the diagnostic rather than discarding it, matching chat.ts and visibilityGate: the
 *  message a user gets says WHICH file is unparseable, which is the difference between a fixable
 *  error and a mysterious one. */
type DenyLookup = { ok: true; entries: DenyEntry[] } | { ok: false; reason: string };

async function denyEntriesOrReason(cwd: string): Promise<DenyLookup> {
  try {
    return { ok: true, entries: await buildDenyPaths(cwd, "chat") };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Create (or resume) a session, preferring server mode when the shared `opencode serve` process is
 *  up (or comes up within its startup timeout) — see ./opencodeServer.ts. Async because both modes
 *  now involve awaiting something before the session is ready to use (the shared server's startup
 *  promise; a fresh session's `session.create()` call in server mode).
 *
 *  A RESTRICTED vault (see this file's top-of-file VISIBILITY GATE note) never even attempts server
 *  mode — `ensureOpencodeServer` is skipped entirely, so `server` stays null and `mode` resolves to
 *  "run" below, unconditionally. When the OS wrapper itself is unavailable for a restricted vault,
 *  the session is refused outright rather than created unprotected. */
async function getOrCreateSession(
  chatId: string,
  cwd: string,
  sink: ChatSink,
  resume: string | undefined,
  memoryDir: string | undefined,
): Promise<OpencodeSession | null> {
  const bin = whichOpencode();
  if (!bin) {
    sink({ type: "error", code: "no-opencode", message: "The `opencode` CLI was not found. Install opencode (opencode.ai) to use this provider." });
    return null;
  }

  // Visibility gate (docs/vault/visibility.md): resolved fresh at every session open, mirroring
  // chat.ts's createSession — see this file's top-of-file note for the full rationale.
  const lookup = await denyEntriesOrReason(cwd);
  if (!lookup.ok) {
    sink({ type: "error", code: "visibility-refused", binary: "opencode", message: undeterminedRefusal(lookup.reason) });
    return null;
  }
  const denyEntries = lookup.entries;
  const restricted = denyEntries.length > 0;
  if (restricted) {
    const availability = checkSandboxWrapperAvailability({ selfSandboxes: can("opencode", "selfSandboxes") });
    if (!availability.available) {
      sink({ type: "error", code: "visibility-refused", binary: "opencode", message: opencodePreconditionRefusal(denyEntries, describeSandboxWrapperUnavailable(availability.reason)) });
      return null;
    }
  }

  const server = restricted ? null : await ensureOpencodeServer(bin).catch(() => null);
  const session: OpencodeSession = {
    id: chatId,
    cwd,
    sink,
    sessionId: resume ?? null,
    bin,
    mode: server ? "server" : "run",
    memoryDir,
    proc: null,
    turnActive: false,
    aborting: false,
    queue: [],
    turnCount: 0,
    detached: false,
    buffer: [],
    lastActivityAt: Date.now(),
    pendingPermissions: new Set(),
  };
  if (server && !resume) {
    let created: { data?: { id?: string }; error?: unknown } | null = null;
    try {
      created = await server.client.session.create({ body: {}, query: { directory: cwd } });
    } catch (e) {
      created = { error: e };
    }
    if (!created || created.error || !created.data?.id) {
      sink({ type: "error", code: "spawn", message: "The opencode server could not start a session." });
      return null;
    }
    session.sessionId = created.data.id;
  }
  sessions.set(chatId, session);
  emitOpenFrames(session, server);
  return session;
}

/** Send one turn against the shared opencode SERVER: registers a listener on the server's global
 *  event stream for real-time deltas/tool progress (unregistered once the call settles — see
 *  opencodeServer.ts), then awaits `session.prompt()` (or `session.command()` for a leading
 *  `/known-command`) — that HTTP call blocks until the model's reply is fully generated (verified
 *  live) and its response carries the turn's authoritative cost + any error, so THAT settling, not
 *  any event, is what ends the turn here. A permission ask mid-turn parks as a `permission` frame
 *  answered by respondPermission (POST .../permissions/{id}), which resolves the SAME blocked
 *  session.prompt() call once answered (verified live for both "once" and "reject"). */
async function runTurnServer(s: OpencodeSession, text: string, images: ChatImage[] | undefined, server: OpencodeServerHandle): Promise<void> {
  s.turnActive = true;
  s.lastActivityAt = Date.now();
  const state = newOpencodeServerTurnState();
  const commandNames = (commandsCache ?? []).map((c) => c.name);
  const slash = parseOpencodeRunCommand(text, commandNames);
  // The virtual "Zen Free (rotating)" model resolves to a REAL free Zen model per turn — round-robin
  // over the currently-free roster; an empty roster omits `model` (opencode's default).
  const model = s.model === ZEN_FREE_ROTATE_ID ? pickZenFreeModel(zenFreeModelIds(modelsCache ?? []), s.turnCount) : s.model;
  s.turnCount += 1;

  const unregister = registerOpencodeServerListener(s.sessionId as string, (ev) => {
    for (const frame of translateOpencodeServerEvent(ev, state)) emit(s, frame);
    const asked = parseOpencodePermissionAsk(ev);
    if (asked && !s.pendingPermissions.has(asked.id)) {
      s.pendingPermissions.add(asked.id);
      emit(s, { type: "permission", id: asked.id, toolName: asked.toolName, input: asked.input });
    }
  });

  let isError = false;
  let costUsd: number | null = null;
  // The authoritative final message parts off the HTTP response. Held here (rather than emitted at
  // the call site) so reconciliation runs AFTER the listener is torn down — no late SSE event can
  // then interleave with it — but BEFORE `result`/`done`, so the text still lands in the right order.
  let finalParts: unknown = null;
  try {
    // Per-turn memory injection (RE-FIX: opencode had none before server mode): recall off the
    // CURRENT prompt and ride it as `system` — a genuine per-call override, verified live
    // (SessionPromptData.system), so this is real auto-recall, not a once-per-session digest.
    let system: string | undefined;
    if (s.memoryDir) {
      const recalled = await recallMemory(s.memoryDir, text).catch(() => null);
      if (recalled) system = recalled;
    }
    if (slash) {
      const res = await server.client.session.command({
        path: { id: s.sessionId as string },
        query: { directory: s.cwd },
        body: { command: slash.command, arguments: slash.args, ...(model ? { model } : {}) },
      });
      if (res.error) {
        isError = true;
        emit(s, { type: "error", code: "error", message: opencodeErrorMessage({ error: res.error }) });
      } else if (res.data?.info?.error) {
        isError = !s.aborting;
        if (!s.aborting) emit(s, { type: "error", code: "error", message: opencodeErrorMessage({ error: res.data.info.error }) });
      }
      costUsd = res.data?.info?.cost ?? null;
      finalParts = res.data?.parts ?? null;
    } else {
      const parts = buildOpencodePromptParts(text, images);
      const modelObj = model ? splitOpencodeModelId(model) : null;
      const res = await server.client.session.prompt({
        path: { id: s.sessionId as string },
        query: { directory: s.cwd },
        body: { ...(modelObj ? { model: modelObj } : {}), ...(system ? { system } : {}), parts },
      });
      if (res.error) {
        isError = true;
        emit(s, { type: "error", code: "error", message: opencodeErrorMessage({ error: res.error }) });
      } else if (res.data?.info?.error) {
        // A deliberate Stop resolves session.prompt() with info.error.name === "MessageAbortedError"
        // (verified live via session.abort()) — that's a clean cancel, not a turn failure.
        isError = !s.aborting;
        if (!s.aborting) emit(s, { type: "error", code: "error", message: opencodeErrorMessage({ error: res.data.info.error }) });
      }
      costUsd = res.data?.info?.cost ?? null;
      finalParts = res.data?.parts ?? null;
    }
  } catch (e) {
    isError = !s.aborting;
    if (!s.aborting) emit(s, { type: "error", code: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    unregister();
  }

  // Captured BEFORE the reset below: a deliberate Stop must not have the cancelled turn's partial
  // text replayed at it, and `s.aborting` is cleared on the very next line.
  const wasAborted = s.aborting;
  s.aborting = false;
  // The session may have been closed (closeChat) while this turn ran — nothing left to report to.
  if (sessions.get(s.id) !== s) return;

  // Emit anything the event stream never delivered (see reconcileOpencodeFinalParts): the HTTP
  // response is the source of truth for what the model actually said, the stream only makes it
  // appear sooner. A fully-streamed turn reconciles to zero frames.
  if (!wasAborted) for (const frame of reconcileOpencodeFinalParts(finalParts, state)) emit(s, frame);

  emit(s, { type: "result", isError, numTurns: 1, costUsd });
  emit(s, { type: "done" });
  if (!s.titleSent) {
    const title = opencodeTitleFromPrompt(text);
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

/** Emit a terminal error+result+done for a turn that never ran (a visibility refusal, a lost
 *  server connection, …) and dispatch whatever's queued next — the four-frame tail every
 *  early-refusal path needs. */
function refuseTurn(s: OpencodeSession, message: string, code: "error" | "visibility-refused" = "error"): void {
  s.turnActive = true;
  emit(s, { type: "error", code, ...(code === "visibility-refused" ? { binary: "opencode" } : {}), message });
  emit(s, { type: "result", isError: true, numTurns: 1, costUsd: null });
  emit(s, { type: "done" });
  s.turnActive = false;
  s.lastActivityAt = Date.now();
  const next = s.queue.shift();
  if (next) void runTurn(s, next.text, next.images);
}

/** Spawn one `opencode run --format json` for this turn and stream its events as ChatFrames (RUN
 *  mode — the fallback path for an opencode too old to `serve`, OR the forced path for a vault the
 *  visibility gate restricts — see this file's top-of-file VISIBILITY GATE note). */
async function runTurnLegacy(s: OpencodeSession, text: string): Promise<void> {
  s.turnActive = true;
  s.lastActivityAt = Date.now();

  // Visibility gate, recomputed FRESH every turn — never cached. Run mode's one-subprocess-per-turn
  // shape means a vault edit (a note just marked hidden, or un-marked) takes effect on the very next
  // turn with nothing to invalidate, unlike Claude's spawn-fixed managedSettings (which needs an
  // explicit respawn — see docs/vault/visibility.md's "Mid-session change" table). This also covers
  // a session whose MODE was locked to "run" for an unrelated reason (an old opencode with no
  // `serve` support) at a point when the vault had nothing restricted yet.
  const legacyLookup = await denyEntriesOrReason(s.cwd);
  if (!legacyLookup.ok) return refuseTurn(s, undeterminedRefusal(legacyLookup.reason), "visibility-refused");
  const denyEntries = legacyLookup.entries;
  let profilePath: string | null = null;
  if (denyEntries.length > 0) {
    const availability = checkSandboxWrapperAvailability({ selfSandboxes: can("opencode", "selfSandboxes") });
    if (!availability.available) {
      return refuseTurn(s, opencodePreconditionRefusal(denyEntries, describeSandboxWrapperUnavailable(availability.reason)), "visibility-refused");
    }
    profilePath = await materializeSandboxProfile(s.cwd, buildSandboxDenyPaths(denyEntries, s.cwd));
  }

  // opencode's local sqlite rejects concurrent openers at cold start ("database is locked" —
  // observed live when a session-open discovery fetch and the first turn's run spawned together).
  // Await the shared open-info chain before spawning so the first turn never races it; afterwards
  // the caches make this a no-op. (Also required here: the command registry below and the Zen
  // free-rotation roster both come off these caches.)
  if (openInfoInFlight) await openInfoInFlight.catch(() => null);
  const state = newOpencodeTurnState();
  // A leading `/name` matching a KNOWN opencode command runs as `--command name <args>` —
  // opencode's non-interactive command invocation (the composer autocompletes these off the
  // manifest; RE-FIX #90). Anything else is an ordinary prompt.
  const slash = parseOpencodeRunCommand(text, (commandsCache ?? []).map((c) => c.name));
  // The virtual "Zen Free (rotating)" model resolves to a REAL free Zen model per turn —
  // round-robin over the currently-free roster; an empty roster omits `-m` (opencode's default).
  const model = s.model === ZEN_FREE_ROTATE_ID ? pickZenFreeModel(zenFreeModelIds(modelsCache ?? []), s.turnCount) : s.model;
  s.turnCount += 1;
  const args = [
    s.bin,
    "run",
    "--format",
    "json",
    // Non-interactive runs can't answer permission prompts — auto-approve anything not explicitly
    // denied by the user's own opencode config (the same posture as the app's Claude default,
    // bypassPermissions). Their config's explicit denies still win.
    "--auto",
    ...(s.sessionId ? ["-s", s.sessionId] : []),
    ...(model ? ["-m", model] : []),
    ...(slash ? ["--command", slash.command, ...(slash.args ? [slash.args] : [])] : [text]),
  ];
  // Wrapped only when `profilePath` is non-null (something restricted AND the OS wrapper is
  // available — see above); an unrestricted vault's argv is byte-identical to before this gate
  // existed, never paying sandbox-exec's overhead.
  const wrappedArgs = wrapArgv(args, profilePath);
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(wrappedArgs, { cwd: s.cwd, stdout: "pipe", stderr: "pipe", env: opencodeSpawnEnv(s.cwd) });
  } catch (e) {
    s.turnActive = false;
    emit(s, { type: "error", code: "spawn", message: (e as Error).message });
    return;
  }
  s.proc = proc;

  // Collect stderr in parallel (small: progress/banner lines) for the non-zero-exit error message.
  const stderrPromise = new Response(proc.stderr as ReadableStream).text().catch(() => "");

  // NDJSON pump: buffer stdout chunks, translate each complete line's event into frames.
  let sawErrorFrame = false;
  try {
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (!line) continue;
        let ev: unknown;
        try {
          ev = JSON.parse(line);
        } catch {
          continue; // non-JSON noise on stdout — skip the line, never the turn
        }
        const before = state.sessionId;
        for (const frame of translateOpencodeEvent(ev, state)) {
          if (frame.type === "error") sawErrorFrame = true;
          emit(s, frame);
        }
        // The durable opencode session id, the moment it's first learned — the client persists it
        // (chatSessionStore) so a reopened tab resumes THIS conversation.
        if (state.sessionId && state.sessionId !== before && state.sessionId !== s.sessionId) {
          s.sessionId = state.sessionId;
          emit(s, { type: "session", sessionId: state.sessionId, origin: "user" }); // never the daemon's — see emitOpenFrames
        }
      }
    }
  } catch {
    /* stream torn down mid-read (kill/abort) — the exit handler below reports the outcome */
  }

  const exitCode = await proc.exited.catch(() => 1);
  const stderr = await stderrPromise;
  const wasAborting = s.aborting;
  s.aborting = false;
  s.proc = null;

  // The session may have been closed (closeChat) while this turn ran — nothing left to report to.
  if (sessions.get(s.id) !== s) return;

  // `sandbox_apply` failing (exit 71) means the OS gate never actually engaged for this turn —
  // ALWAYS a refusal to surface plainly, never an ordinary CLI failure to fold into the generic
  // stderr-tail message below (agentBackends/sandboxWrapper.ts's isSandboxApplyFailure/P4). Only
  // meaningful when this turn WAS wrapped (profilePath !== null) — an unwrapped turn exiting 71 for
  // some unrelated reason (opencode's own use of that code, however unlikely) gets the normal path.
  const sandboxApplyFailed = profilePath !== null && isSandboxApplyFailure(exitCode);
  const failed = (exitCode !== 0 && !wasAborting) || sandboxApplyFailed;
  if (failed && !sawErrorFrame) {
    const message = sandboxApplyFailed
      ? "The OS sandbox could not be applied to this turn (exit 71) — refusing rather than running it unprotected."
      : stderr.trim().split("\n").slice(-3).join("\n").trim() || `opencode exited with code ${exitCode}`;
    emit(s, { type: "error", code: "error", message });
  }
  // A run that streamed an error event still EXITS 0 (verified live: an API 401 → error event,
  // exit code 0) — the result must report the failure either way or the footer shows a clean turn.
  emit(s, { type: "result", isError: failed || sawErrorFrame, numTurns: 1, costUsd: state.costUsd });
  emit(s, { type: "done" });
  // Name the tab off the first prompt (opencode's own session titling is async + truncated-prompt
  // based anyway) — latched once, like chat.ts maybeEmitTitle.
  if (!s.titleSent) {
    const title = opencodeTitleFromPrompt(text);
    if (title) {
      s.titleSent = true;
      emit(s, { type: "title", title });
    }
  }
  s.turnActive = false;
  s.lastActivityAt = Date.now();

  // Dispatch the next staged turn, if any (the exit handler is the serialization point).
  const next = s.queue.shift();
  if (next) void runTurn(s, next.text, next.images);
}

/** Dispatch one turn on whichever mode this session settled on at creation. A SERVER-mode session
 *  whose shared server has since crashed (rare — see opencodeServer.ts's watchExit) reports a clean
 *  error rather than silently spawning a run-mode subprocess mid-session (the two modes have
 *  different opencode session-id semantics; switching underneath a live chat would be surprising).
 *
 *  A SERVER-mode session can never be retrofitted with the OS wrapper (this file's top-of-file
 *  VISIBILITY GATE note, P3: the shared `serve` process multiplexes every vault this core hosts, so
 *  a profile scoped to ONE vault can't be applied to it). If this vault has since restricted a note
 *  (it had nothing restricted when the session was created — see getOrCreateSession), the turn is
 *  refused outright rather than answered unprotected; closing the chat and reopening it re-runs the
 *  gate at session-creation time and correctly lands on the wrapped run path. */
async function runTurn(s: OpencodeSession, text: string, images?: ChatImage[]): Promise<void> {
  if (s.mode === "run") return runTurnLegacy(s, text);

  const lookup = await denyEntriesOrReason(s.cwd);
  if (!lookup.ok) return refuseTurn(s, undeterminedRefusal(lookup.reason), "visibility-refused");
  const denyEntries = lookup.entries;
  if (denyEntries.length > 0) {
    return refuseTurn(
      s,
      opencodePreconditionRefusal(denyEntries, "this chat already started on opencode's shared server mode, which can't enforce that — close this chat and start a new one"),
      "visibility-refused",
    );
  }

  const server = await ensureOpencodeServer(s.bin).catch(() => null);
  if (!server) return refuseTurn(s, "Lost connection to the opencode server.");
  return runTurnServer(s, text, images, server);
}

/** Queue-or-run gate shared by sendMessage's two call sites (existing session / freshly created). */
function dispatchTurn(s: OpencodeSession, text: string, images?: ChatImage[]): void {
  if (images?.length && s.mode !== "server") {
    emit(s, {
      type: "error",
      code: "error",
      message: "Image attachments need the opencode server mode, which isn't available for this session — remove the image or switch the provider to Claude Code.",
    });
    return;
  }
  if (s.turnActive) {
    s.queue.push({ text, images });
    return;
  }
  void runTurn(s, text, images);
}

/** Send a user turn — creates the session on first use (mirrors chat.ts sendMessage). Images ride
 *  `FilePartInput` parts in server mode; run mode still has no attachment flag (see dispatchTurn). */
export function sendMessage(chatId: string, text: string, cwd: string, sink: ChatSink, images?: ChatImage[], memoryDir?: string): void {
  const existing = sessions.get(chatId);
  if (!existing) {
    // PRE-EXISTING GAP, out of scope here: getOrCreateSession is async, so the session isn't
    // registered in `sessions` until this await resolves. A WS close landing in that window finds
    // no session yet (detachSink no-ops) and, once creation DOES complete, the now-dead sink is
    // never detached and no grace-close timer is ever armed for it — an attached session with
    // nowhere to send frames and no teardown scheduled. Not reachable via the identity-guard work in
    // this file (that guards an EXISTING session's re-detach, not a session that doesn't exist yet);
    // would need its own fix (e.g. a placeholder session registered before the await).
    void (async () => {
      const created = await getOrCreateSession(chatId, cwd, sink, undefined, memoryDir);
      if (!created) return; // no-opencode/spawn error already pushed
      dispatchTurn(created, text, images);
    })();
    return;
  }
  reattachSessionSink(existing, sink);
  existing.cwd = cwd;
  dispatchTurn(existing, text, images);
}

/** Eagerly open a session (chat WS `open`) so the header's manifest + models land before the
 *  first message — the opencode twin of chat.ts openSession. */
export function openSession(chatId: string, cwd: string, sink: ChatSink, memoryDir?: string): void {
  if (sessions.has(chatId)) return;
  void getOrCreateSession(chatId, cwd, sink, undefined, memoryDir);
}

/** Bind this chat to an EXISTING opencode session (ses_…): the next turn continues it with full
 *  context. History replay is served separately over HTTP (sessionHistoryFrames below), mirroring
 *  the Claude resume flow. */
export function resumeSession(chatId: string, sessionId: string, cwd: string, sink: ChatSink, memoryDir?: string): void {
  if (sessions.has(chatId)) closeChat(chatId);
  void getOrCreateSession(chatId, cwd, sink, sessionId, memoryDir);
}

/** Replay a past opencode session as ChatFrames. Prefers the shared server's typed
 *  `GET /session/{id}/message` (verified live to carry the same per-message `{info:{role},parts}`
 *  shape `opencode export`'s JSON does); falls back to `opencode export` (stdout JSON) when no
 *  server is available — both read the SAME on-disk session store, so a session created under one
 *  mode replays fine under the other. Tolerant: any failure yields []. */
export async function sessionHistoryFrames(sessionId: string, cwd: string): Promise<ChatFrame[]> {
  const bin = whichOpencode();
  if (!bin || !/^[\w-]+$/.test(sessionId)) return [];
  const server = await ensureOpencodeServer(bin).catch(() => null);
  if (server) {
    try {
      const res = await server.client.session.messages({ path: { id: sessionId }, query: { directory: cwd } });
      if (res.data) return translateOpencodeSessionMessages(res.data);
    } catch {
      /* fall through to the CLI export fallback below */
    }
  }
  try {
    const proc = Bun.spawn([bin, "export", sessionId], { cwd, stdout: "pipe", stderr: "ignore", env: opencodeSpawnEnv(cwd) });
    const out = await new Response(proc.stdout as ReadableStream).text();
    await proc.exited;
    const json = JSON.parse(out) as unknown;
    return translateOpencodeExport(json).frames;
  } catch {
    return [];
  }
}

/** Interrupt the in-flight turn. Run mode kills the child; server mode calls the server's own
 *  `session.abort()` (verified live: the blocked `session.prompt()` call then resolves with
 *  `info.error.name === "MessageAbortedError"` rather than hanging or rejecting). */
export function abortTurn(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  if (s.mode === "run") {
    if (!s.proc) return;
    s.aborting = true;
    s.queue = [];
    try {
      s.proc.kill();
    } catch {
      /* already exited */
    }
    return;
  }
  if (!s.turnActive || !s.sessionId) return;
  s.aborting = true;
  s.queue = [];
  void ensureOpencodeServer(s.bin)
    .then((server) => server?.client.session.abort({ path: { id: s.sessionId as string }, query: { directory: s.cwd } }))
    .catch(() => {
      /* best-effort — a turn that never settles is still reported by the awaited call's own catch */
    });
}

/** Answer a `permission` frame (server mode only — run mode never raises one). Maps allow/deny/always
 *  onto the server's own once/reject/always response, verified live for both allow ("once") and
 *  deny ("reject"). */
export function respondPermission(chatId: string, id: string, behavior: "allow" | "deny", always?: boolean): void {
  const s = sessions.get(chatId);
  if (!s || s.mode !== "server" || !s.sessionId || !s.pendingPermissions.has(id)) return;
  s.pendingPermissions.delete(id);
  void ensureOpencodeServer(s.bin)
    .then((server) =>
      server?.client.postSessionIdPermissionsPermissionId({
        path: { id: s.sessionId as string, permissionID: id },
        query: { directory: s.cwd },
        body: { response: opencodePermissionResponse(behavior, always) },
      }),
    )
    .catch(() => {
      /* best-effort — the pending ask just stays parked client-side if this fails */
    });
}

/** Switch the model for FUTURE turns (each run passes it along). opencode model ids are
 *  `provider/model`; anything else (e.g. a Claude model id from a stale localStorage key) is
 *  ignored rather than poisoning the next run. The virtual `ZEN_FREE_ROTATE_ID`
 *  (`bismuth/zen-free-rotate`) shares the shape, passes here, and is resolved to a real free Zen
 *  model per turn in runTurnServer/runTurnLegacy — it never reaches the CLI/server as-is. */
export function setModel(chatId: string, model: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  if (!/^[\w.-]+\/[\w.:-]+$/.test(model)) return;
  s.model = model;
}

export function closeChat(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  sessions.delete(chatId);
  if (s.closeTimer) clearTimeout(s.closeTimer);
  s.queue = [];
  s.pendingPermissions.clear();
  if (s.proc) {
    try {
      s.proc.kill();
    } catch {
      /* already exited */
    }
  }
  // Server-mode sessions have no local process to kill — the shared server outlives every chat.
  // A closed chat does NOT delete the opencode session server-side: the whole point is that it stays
  // resumable (opencode export / GET /session/{id}/message both still work after this call).
}

export function scheduleClose(chatId: string, ms: number): void {
  const s = sessions.get(chatId);
  if (!s) return;
  scheduleSessionClose(s, ms, () => closeChat(chatId));
}

/** Re-point a live session's sink at a reconnected socket, flushing frames buffered while
 *  detached; a between-turns rebind pushes a synthetic `done` so a terminating frame lost to the
 *  dead socket can't wedge the streaming state. Mirrors chat.ts. */
export function rebindSink(chatId: string, sink: ChatSink): boolean {
  const s = sessions.get(chatId);
  if (!s) return false;
  rebindSessionSink(s, sink);
  return true;
}

export function detachSink(chatId: string, sink: ChatSink): boolean {
  const s = sessions.get(chatId);
  if (!s) return false;
  return detachSessionSink(s, sink);
}

// Kill any in-flight RUN-mode opencode children on backend shutdown (mirrors chat.ts/terminal.ts).
// The shared SERVER process's own teardown lives in ./opencodeServer.ts (its own process.on("exit")
// hook) — kept separate since the server outlives any single chat/session this file manages.
let shuttingDown = false;
function shutdownAll(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const id of Array.from(sessions.keys())) closeChat(id);
}
process.on("exit", shutdownAll);
