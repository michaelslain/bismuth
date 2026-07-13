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
//    Claude-specific interactive surfaces (permission frames, AskUserQuestion, slash commands,
//    permission modes, effort) simply never occur; the frontend hides those controls for
//    opencode sessions.
//  - History replay + resume: `opencode export <sessionID>` (JSON on stdout) → ChatFrames, and
//    `-s` on the next run continues it — so a reopened chat tab resumes its opencode
//    conversation just like a Claude one.
//
// Session registry semantics (sink buffering while detached, grace-close, rebind with a
// synthetic `done`, process-exit teardown) mirror core/src/chat.ts so the server's WS handler
// treats both providers identically.
import type { ChatFrame, ChatImage, ChatSink } from "../chat";
import { claudeLookupPath, claudeSpawnEnv } from "../claudeWhich";
import {
  newOpencodeTurnState,
  opencodeTitleFromPrompt,
  parseOpencodeModels,
  translateOpencodeEvent,
  translateOpencodeExport,
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
  detached: boolean;
  buffer: ChatFrame[];
  closeTimer?: ReturnType<typeof setTimeout>;
  titleSent?: boolean;
  lastActivityAt: number;
}

const MAX_BUFFERED_FRAMES = 2000;

const sessions = new Map<string, OpencodeSession>();

function emit(s: OpencodeSession, frame: ChatFrame): void {
  if (s.detached) {
    if (s.buffer.length < MAX_BUFFERED_FRAMES) s.buffer.push(frame);
    return;
  }
  s.sink(frame);
}

export function hasSession(chatId: string): boolean {
  return sessions.has(chatId);
}

export function sessionCount(): number {
  return sessions.size;
}

// The models list is static per opencode config — fetch once per process and reuse for every
// session's `models` frame (the CLI call takes ~1.4s; no need to pay it per chat open).
type OpencodeModelEntry = { value: string; label: string; description: string; effortLevels: string[] };
let modelsCache: OpencodeModelEntry[] | null = null;
let modelsInFlight: Promise<OpencodeModelEntry[]> | null = null;
async function fetchModels(bin: string, cwd: string): Promise<OpencodeModelEntry[]> {
  if (modelsCache) return modelsCache;
  if (!modelsInFlight) {
    modelsInFlight = (async () => {
      try {
        const proc = Bun.spawn([bin, "models"], { cwd, stdout: "pipe", stderr: "ignore", env: claudeSpawnEnv() as Record<string, string> });
        const out = await new Response(proc.stdout as ReadableStream).text();
        await proc.exited;
        modelsCache = parseOpencodeModels(out);
      } catch {
        modelsCache = [];
      }
      return modelsCache;
    })();
  }
  return (await modelsInFlight) ?? [];
}

/** Emit the open-time header frames for a fresh/resumed session: a synthetic manifest (opencode
 *  has no slash commands / tools list / MCP status to report — empty lists make the frontend hide
 *  those affordances) and the `models` frame (fetched once per process). */
function emitOpenFrames(s: OpencodeSession): void {
  emit(s, {
    type: "manifest",
    manifest: { model: s.model ?? "", permissionMode: "default", slashCommands: [], tools: [], mcpServers: [] },
  });
  if (s.sessionId) emit(s, { type: "session", sessionId: s.sessionId });
  void fetchModels(s.bin, s.cwd).then((models) => {
    if (sessions.get(s.id) === s && models.length) emit(s, { type: "models", models });
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
  // observed live when the session-open `opencode models` fetch and the first turn's run spawned
  // together). Await the in-flight models fetch before spawning so the first turn never races it;
  // afterwards the cache makes this a no-op.
  if (modelsInFlight && !modelsCache) await modelsInFlight.catch(() => null);
  const state = newOpencodeTurnState();
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
    ...(s.model ? ["-m", s.model] : []),
    text,
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
          emit(s, { type: "session", sessionId: state.sessionId });
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
  emit(s, { type: "result", isError: failed, numTurns: 1, costUsd: state.costUsd });
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
 *  ignored rather than poisoning the next run. */
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
  if (s.closeTimer) clearTimeout(s.closeTimer);
  s.closeTimer = setTimeout(() => closeChat(chatId), ms);
}

/** Re-point a live session's sink at a reconnected socket, flushing frames buffered while
 *  detached; a between-turns rebind pushes a synthetic `done` (idempotent client-side) so a
 *  terminating frame lost to the dead socket can't wedge the streaming state. Mirrors chat.ts. */
export function rebindSink(chatId: string, sink: ChatSink): boolean {
  const s = sessions.get(chatId);
  if (!s) return false;
  if (s.closeTimer) {
    clearTimeout(s.closeTimer);
    s.closeTimer = undefined;
  }
  s.sink = sink;
  if (s.buffer.length) {
    const buffered = s.buffer;
    s.buffer = [];
    for (const f of buffered) {
      try {
        sink(f);
      } catch {
        break;
      }
    }
  }
  s.detached = false;
  if (!s.turnActive) {
    try {
      sink({ type: "done" });
    } catch {
      /* */
    }
  }
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
