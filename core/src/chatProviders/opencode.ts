// core/src/chatProviders/opencode.ts
// The opencode chat provider: drives the user's own `opencode` CLI (like chat.ts drives `claude`)
// and speaks the SAME ChatFrame wire protocol, so ChatView renders an opencode conversation with
// zero rendering changes. Design (verified live against opencode 1.17.15):
//
//  - ONE `opencode run --format json` subprocess PER TURN (not a long-lived server): opencode's
//    `-s <sessionID>` flag continues a session with full context, so per-turn spawns give us
//    durable multi-turn conversations with the simplest possible lifecycle — no port management,
//    no orphaned server, teardown is just killing the in-flight child.
//  - stdout is NDJSON (one event per line) → translateOpencodeEvent → ChatFrames. `text` parts
//    arrive complete per part (opencode run does not stream deltas); tools arrive already
//    resolved (tool-use + tool-result emitted together).
//  - `--auto` is passed so tools never park on a permission prompt the non-interactive run mode
//    can't answer — the same effective posture as the app's Claude default (bypassPermissions).
//    Claude-specific interactive surfaces (permission frames, AskUserQuestion, permission modes,
//    effort) simply never occur; the frontend hides those controls for opencode sessions.
//  - opencode-NATIVE surfaces (RE-FIX #90): the command registry (`opencode debug config` +
//    built-ins) rides the manifest so `/…` autocompletes, and a matching turn runs as
//    `run --command`; `opencode auth list` rides an `auth` frame (the header's auth pill); a
//    virtual "Zen Free (rotating)" model rotates among Zen's currently-free models per turn.
//  - History replay + resume: `opencode export <sessionID>` (JSON on stdout) → ChatFrames, and
//    `-s` on the next run continues it — so a reopened chat tab resumes its opencode
//    conversation just like a Claude one.
//
// Session registry semantics (sink buffering while detached, grace-close, rebind with a
// synthetic `done`, process-exit teardown) mirror core/src/chat.ts so the server's WS handler
// treats both providers identically.
import type { ChatFrame, ChatImage, ChatSink } from "../chat";
import { emit, rebindSessionSink, scheduleSessionClose } from "./sessionSink";
import { claudeLookupPath, claudeSpawnEnv } from "../claudeWhich";
import {
  newOpencodeTurnState,
  opencodeTitleFromPrompt,
  parseOpencodeAuthList,
  parseOpencodeDebugConfigCommands,
  parseOpencodeModels,
  parseOpencodeModelsVerbose,
  parseOpencodeRunCommand,
  pickZenFreeModel,
  translateOpencodeEvent,
  translateOpencodeExport,
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
  /** opencode's durable session id (ses_…), learned from the first run's events; `-s` on every
   *  later turn continues it. Preset when resuming. */
  sessionId: string | null;
  /** The `provider/model` the user picked in the header (set_model); rides `-m` on each run. */
  model?: string;
  bin: string;
  /** The in-flight turn's child process (killed by abortTurn/closeChat). */
  proc: ReturnType<typeof Bun.spawn> | null;
  turnActive: boolean;
  /** Set by abortTurn right before kill() so the exit handler reports a deliberate Stop
   *  (isError:false), mirroring ChatSession.aborting. */
  aborting: boolean;
  /** Turns staged while one is in flight (the client also queues; this is the backend guard). */
  queue: { text: string }[];
  /** Completed-turn count — drives the Zen free-model ROTATION (turn N runs free model N mod
   *  roster size) when the virtual `ZEN_FREE_ROTATE_ID` is the selected model. */
  turnCount: number;
  detached: boolean;
  buffer: ChatFrame[];
  closeTimer?: ReturnType<typeof setTimeout>;
  titleSent?: boolean;
  lastActivityAt: number;
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

/** One opencode CLI invocation → stdout text (stderr ignored). Every open-time discovery
 *  (`models`, `debug config`, `auth list`) goes through here. */
async function runCliText(bin: string, cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([bin, ...args], { cwd, stdout: "pipe", stderr: "ignore", env: claudeSpawnEnv() as Record<string, string> });
  const out = await new Response(proc.stdout as ReadableStream).text();
  await proc.exited;
  return out;
}

// Models + commands are static per opencode config — fetch once per process and reuse for every
// session's open frames (each CLI call takes ~1.4s; no need to pay it per chat open). The two
// fetches run SEQUENTIALLY in one shared promise: opencode's local sqlite rejects concurrent
// openers at cold start ("database is locked" — observed live), so open-time CLI spawns must
// never race each other (or the first turn — runTurn awaits this same promise).
//  - models: `--verbose` carries display name + cost metadata (→ the Free/Paid badge and the Zen
//    free-rotation roster, card #90); an older opencode degrades to the plain id list.
//  - commands: `debug config` resolves the user's whole command registry (config dirs +
//    opencode.json(c) + plugin-registered) — merged with the built-ins (/init, /review) for the
//    composer's "/" autocomplete (RE-FIX #90).
let modelsCache: OpencodeModelEntry[] | null = null;
let commandsCache: OpencodeCommandEntry[] | null = null;
let openInfoInFlight: Promise<void> | null = null;
function ensureOpenInfo(bin: string, cwd: string): Promise<void> {
  if (!openInfoInFlight) {
    openInfoInFlight = (async () => {
      try {
        modelsCache = parseOpencodeModelsVerbose(await runCliText(bin, cwd, ["models", "--verbose"]));
        if (!modelsCache.length) modelsCache = parseOpencodeModels(await runCliText(bin, cwd, ["models"]));
      } catch {
        modelsCache = [];
      }
      try {
        commandsCache = withOpencodeBuiltinCommands(parseOpencodeDebugConfigCommands(await runCliText(bin, cwd, ["debug", "config"])));
      } catch {
        commandsCache = withOpencodeBuiltinCommands([]); // built-ins need no config — always offer them
      }
    })();
  }
  return openInfoInFlight;
}

/** The manifest frame for an opencode session: the command registry rides `slashCommands` (so the
 *  composer's "/" popover autocompletes opencode commands exactly like Claude's) with per-command
 *  blurbs in `commandDetails`; tools/MCP stay empty (nothing to report — the frontend hides those
 *  pills) and permissionMode is nominal (runs are `--auto`; the picker is hidden for opencode). */
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
function emitOpenFrames(s: OpencodeSession): void {
  const hadCommands = commandsCache !== null;
  emit(s, manifestFrame(s));
  // origin "user", always: the daemon runs on the Claude Code SDK and records ITS session ids in
  // <vault>/.daemon/session-ids. An opencode session id comes from a different store in a different
  // id namespace, so it can never be the daemon's — no membership test to make.
  if (s.sessionId) emit(s, { type: "session", sessionId: s.sessionId, origin: "user" });
  void ensureOpenInfo(s.bin, s.cwd).then(async () => {
    if (sessions.get(s.id) !== s) return;
    if (!hadCommands && commandsCache?.length) emit(s, manifestFrame(s));
    const models = withZenFreeRotate(modelsCache ?? []);
    if (models.length) emit(s, { type: "models", models });
    // Auth AFTER the shared discovery chain (never concurrent with another cold-start spawn).
    const providers = parseOpencodeAuthList(await runCliText(s.bin, s.cwd, ["auth", "list"]).catch(() => ""));
    if (sessions.get(s.id) === s) emit(s, { type: "auth", providers });
  });
}

function createSession(chatId: string, cwd: string, sink: ChatSink, resume?: string): OpencodeSession | null {
  const bin = whichOpencode();
  if (!bin) {
    sink({ type: "error", code: "no-opencode", message: "The `opencode` CLI was not found. Install opencode (opencode.ai) to use this provider." });
    return null;
  }
  const session: OpencodeSession = {
    id: chatId,
    cwd,
    sink,
    sessionId: resume ?? null,
    bin,
    proc: null,
    turnActive: false,
    aborting: false,
    queue: [],
    turnCount: 0,
    detached: false,
    buffer: [],
    lastActivityAt: Date.now(),
  };
  sessions.set(chatId, session);
  emitOpenFrames(session);
  return session;
}

/** Spawn one `opencode run --format json` for this turn and stream its events as ChatFrames.
 *  Serialized per session: a turn arriving while one is in flight is queued and dispatched from
 *  the exit handler. */
async function runTurn(s: OpencodeSession, text: string): Promise<void> {
  s.turnActive = true;
  s.lastActivityAt = Date.now();
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
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { cwd: s.cwd, stdout: "pipe", stderr: "pipe", env: claudeSpawnEnv() as Record<string, string> });
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

  const failed = exitCode !== 0 && !wasAborting;
  if (failed && !sawErrorFrame) {
    const tail = stderr.trim().split("\n").slice(-3).join("\n").trim();
    emit(s, { type: "error", code: "error", message: tail || `opencode exited with code ${exitCode}` });
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
  if (next) void runTurn(s, next.text);
}

/** Send a user turn — creates the session on first use (mirrors chat.ts sendMessage). Images are
 *  not supported by `opencode run` (no attachment-bytes flag) — refused with a friendly error
 *  frame rather than silently dropped. */
export function sendMessage(chatId: string, text: string, cwd: string, sink: ChatSink, images?: ChatImage[]): void {
  let s = sessions.get(chatId);
  if (!s) {
    const created = createSession(chatId, cwd, sink);
    if (!created) return; // no-opencode already pushed
    s = created;
  } else {
    if (s.closeTimer) {
      clearTimeout(s.closeTimer);
      s.closeTimer = undefined;
    }
    s.sink = sink;
    s.detached = false;
    s.cwd = cwd;
  }
  if (images?.length) {
    emit(s, { type: "error", code: "error", message: "Image attachments aren't supported on the opencode provider yet — remove the image or switch the provider to Claude Code." });
    return;
  }
  if (s.turnActive) {
    s.queue.push({ text });
    return;
  }
  void runTurn(s, text);
}

/** Eagerly open a session (chat WS `open`) so the header's manifest + models land before the
 *  first message — the opencode twin of chat.ts openSession. */
export function openSession(chatId: string, cwd: string, sink: ChatSink): void {
  if (sessions.has(chatId)) return;
  createSession(chatId, cwd, sink);
}

/** Bind this chat to an EXISTING opencode session (ses_…): the next turn runs with `-s` so the
 *  conversation continues with full context. History replay is served separately over HTTP
 *  (sessionHistoryFrames below), mirroring the Claude resume flow. */
export function resumeSession(chatId: string, sessionId: string, cwd: string, sink: ChatSink): void {
  if (sessions.has(chatId)) closeChat(chatId);
  createSession(chatId, cwd, sink, sessionId);
}

/** Replay a past opencode session as ChatFrames via `opencode export` (JSON on stdout, banner on
 *  stderr — verified). Tolerant: any failure yields []. */
export async function sessionHistoryFrames(sessionId: string, cwd: string): Promise<ChatFrame[]> {
  const bin = whichOpencode();
  if (!bin || !/^[\w-]+$/.test(sessionId)) return [];
  try {
    const proc = Bun.spawn([bin, "export", sessionId], { cwd, stdout: "pipe", stderr: "ignore", env: claudeSpawnEnv() as Record<string, string> });
    const out = await new Response(proc.stdout as ReadableStream).text();
    await proc.exited;
    const json = JSON.parse(out) as unknown;
    return translateOpencodeExport(json).frames;
  } catch {
    return [];
  }
}

/** Interrupt the in-flight turn (kill the child); the exit handler reports a deliberate Stop. */
export function abortTurn(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s || !s.proc) return;
  s.aborting = true;
  s.queue = [];
  try {
    s.proc.kill();
  } catch {
    /* already exited */
  }
}

/** Switch the model for FUTURE turns (each run passes `-m`). opencode model ids are
 *  `provider/model`; anything else (e.g. a Claude model id from a stale localStorage key) is
 *  ignored rather than poisoning the next run. The virtual `ZEN_FREE_ROTATE_ID`
 *  (`bismuth/zen-free-rotate`) shares the shape, passes here, and is resolved to a real free Zen
 *  model per turn in runTurn — it never reaches the CLI. */
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
  if (s.proc) {
    try {
      s.proc.kill();
    } catch {
      /* already exited */
    }
  }
}

export function scheduleClose(chatId: string, ms: number): void {
  const s = sessions.get(chatId);
  if (!s) return;
  scheduleSessionClose(s, ms, () => closeChat(chatId));
}

/** Re-point a live session's sink at a reconnected socket, flushing frames buffered while
 *  detached; a between-turns rebind pushes a synthetic `done` (idempotent client-side) so a
 *  terminating frame lost to the dead socket can't wedge the streaming state. Mirrors chat.ts. */
export function rebindSink(chatId: string, sink: ChatSink): boolean {
  const s = sessions.get(chatId);
  if (!s) return false;
  rebindSessionSink(s, sink);
  return true;
}

export function detachSink(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  s.detached = true;
}

// Kill any in-flight opencode children on backend shutdown (mirrors chat.ts/terminal.ts).
let shuttingDown = false;
function shutdownAll(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const id of Array.from(sessions.keys())) closeChat(id);
}
process.on("exit", shutdownAll);
