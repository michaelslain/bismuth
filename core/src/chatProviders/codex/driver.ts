// core/src/chatProviders/codex/driver.ts
//
// The effectful half of the Codex chat backend: drives `@openai/codex-sdk`'s Codex/Thread classes.
// See ./protocol.ts for the pure ThreadEvent -> ChatFrame translator this wraps.
//
// Architecturally closer to ../opencode.ts than to ../../chat.ts: `Thread.runStreamed()` spawns a
// FRESH `codex exec` subprocess EVERY CALL — verified by reading the shipped SDK's dist/index.js
// (CodexExec.run does a plain `child_process.spawn` per invocation; there is no long-lived session
// process the way Claude's Agent SDK query() keeps one). So this driver follows opencode.ts's
// lifecycle conventions exactly: a session Map keyed by chat id, emit/rebindSessionSink/
// scheduleSessionClose from ../sessionSink for reconnect buffering, a turn queue serialized through
// the settle point at the end of runTurn, tolerant event handling (a single bad line/exception never
// crashes the turn), process.on("exit") teardown, and NEVER throwing into a user's chat. Continuity
// across turns rides the SDK's own thread id (learned from the FIRST "thread.started" event of the
// stream, not a getter poll), passed to `codex.resumeThread(id, options)` on every subsequent turn —
// the same "-s <sessionID> per invocation" shape opencode.ts already uses, just via the SDK instead
// of a raw CLI flag.
//
// Binary resolution: codexPathOverride, NOT the SDK's own auto-resolution. Without an override,
// `@openai/codex-sdk` resolves a BUNDLED platform binary — an optionalDependency of `@openai/codex`,
// verified ~300MB on disk — via `require.resolve`, which would mean spawning a Codex Bismuth itself
// vendored rather than the user's own installed/logged-in CLI. That breaks the "drive the user's own
// binary, their own login, never bundle a duplicate" pattern every other backend in this file
// follows (claude, opencode, every ACP agent) and would silently ship ~300MB nobody asked for. So
// this driver ALWAYS resolves `codex` via the same augmented-PATH `whichBinary` every other backend
// uses and passes it as `codexPathOverride` — a missing binary is the standard "no-binary" setup
// screen, never a crash and never a silent fallback to the SDK's bundled copy.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Codex, type ModelReasoningEffort, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";
import type { ChatFrame, ChatImage, ChatManifest, ChatSink } from "../../chat";
import { emit, rebindSessionSink, scheduleSessionClose } from "../sessionSink";
import { claudeSpawnEnv, whichBinary } from "../../claudeWhich";
import type { ChatBackend, ChatTurnContext } from "../backends";
import { readCodexOptIns } from "../../settings";
import { writeAgentsMdBlock } from "../../agentBackends/agentsMd";
import { writeCodexHooksFiles } from "../../agentBackends/codexHooks";
import { titleFromPrompt } from "../titleFromPrompt";
import { newCodexTranslateState, resetCodexTurnState, translateThreadEvent, type CodexTranslateState } from "./protocol";

interface CodexSession {
  id: string;
  cwd: string;
  sink: ChatSink;
  codex: Codex;
  /** The SDK's durable thread id, learned from the first turn's `thread.started` event (or seeded
   *  on resume). `null` until the first turn actually starts. */
  threadId: string | null;
  /** Free-form model id for FUTURE turns (no model-list capability — see catalog.ts's rationale —
   *  so this is never populated from a picker today, only settable programmatically). */
  model?: string;
  /** One of Codex's five reasoning-effort levels for FUTURE turns. */
  effort?: ModelReasoningEffort;
  translateState: CodexTranslateState;
  turnActive: boolean;
  /** Set by abortTurn right before controller.abort(); cleared once the turn settles (so its
   *  resulting exception is reported as a deliberate Stop, not a turn error) — mirrors
   *  opencode.ts's `aborting`. */
  aborting: boolean;
  controller: AbortController | null;
  queue: { text: string; images?: ChatImage[] }[];
  detached: boolean;
  buffer: ChatFrame[];
  closeTimer?: ReturnType<typeof setTimeout>;
  titleSent: boolean;
  lastActivityAt: number;
}

const sessions = new Map<string, CodexSession>();

export function hasSession(chatId: string): boolean {
  return sessions.has(chatId);
}

export function sessionCount(): number {
  return sessions.size;
}

const EFFORT_VALUES: readonly ModelReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];

function isModelReasoningEffort(v: string): v is ModelReasoningEffort {
  return (EFFORT_VALUES as readonly string[]).includes(v);
}

/**
 * Codex has none of the dynamic manifest fields Claude/opencode report (no live tool registry, no
 * slash-command registry — see catalog.ts's rationale for why those capabilities are false), so
 * this is a single static frame emitted once at session open rather than something re-derived per
 * turn.
 */
function blankManifest(model: string): ChatManifest {
  return { model, permissionMode: "default", slashCommands: [], tools: [], mcpServers: [] };
}

function buildCodexEnv(): Record<string, string> {
  // claudeSpawnEnv's name is a historical artifact (see core/src/claudeWhich.ts) — it's a general
  // "spawn env for a CLI that needs Keychain/PATH access" builder, already reused unmodified by
  // ../opencode.ts and ../acp/driver.ts for their own (non-Claude) child processes.
  return claudeSpawnEnv() as Record<string, string>;
}

/**
 * Best-effort, opt-in refresh of Codex's memory channel (AGENTS.md) + agents-graph hooks. Reads
 * `settings.codex.*` fresh on every session open (so a toggle takes effect on the NEXT new chat,
 * not a live one) and never throws or blocks a turn on failure — mirrors how chat.ts's
 * buildSystemPrompt / bismuthInstall.ts's registerMcp degrade.
 */
async function applyCodexOptIns(cwd: string): Promise<void> {
  try {
    const optIns = await readCodexOptIns(cwd);
    if (optIns.writeAgentsMd) {
      writeAgentsMdBlock(
        cwd,
        [
          "This is a Bismuth-managed vault: a personal knowledge base of markdown notes linked with",
          "[[wikilinks]] and #tags. Treat it as the user's second brain — read existing notes before",
          "creating new ones, and prefer linking to an existing note over duplicating its content.",
        ].join("\n"),
      );
    }
    if (optIns.installRelayHooks) writeCodexHooksFiles(cwd);
  } catch {
    /* best-effort only — never blocks session open */
  }
}

function createSession(chatId: string, cwd: string, sink: ChatSink, resumeId?: string): CodexSession | null {
  const bin = whichBinary("codex");
  if (!bin) {
    sink({
      type: "error",
      code: "no-binary",
      binary: "codex",
      message: "The `codex` CLI was not found. Install OpenAI Codex (`npm i -g @openai/codex`) and run `codex` once to log in.",
    });
    return null;
  }
  const codex = new Codex({ codexPathOverride: bin, env: buildCodexEnv() });
  const s: CodexSession = {
    id: chatId,
    cwd,
    sink,
    codex,
    threadId: resumeId ?? null,
    translateState: newCodexTranslateState(resumeId ?? null),
    turnActive: false,
    aborting: false,
    controller: null,
    queue: [],
    detached: false,
    buffer: [],
    titleSent: false,
    lastActivityAt: Date.now(),
  };
  sessions.set(chatId, s);
  emit(s, { type: "manifest", manifest: blankManifest(s.model ?? "") });
  // origin "user", always: the daemon's Codex backend (daemon/src/daemon/codexSession.ts) records
  // its OWN thread ids under <vault>/.daemon — a different store in a different id namespace, so a
  // chat-side thread id can never be the daemon's (mirrors opencode.ts/acp's identical reasoning).
  if (s.threadId) emit(s, { type: "session", sessionId: s.threadId, origin: "user" });
  void applyCodexOptIns(cwd);
  return s;
}

function threadOptions(s: CodexSession): ThreadOptions {
  const opts: ThreadOptions = {
    workingDirectory: s.cwd,
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write",
    // codex exec (what the SDK always drives) has no TTY to prompt on anyway — explicit for
    // determinism, matching opencode.ts's --auto posture (the same effective "don't park on an
    // approval this non-interactive run mode can never answer" stance).
    approvalPolicy: "never",
  };
  if (s.model) opts.model = s.model;
  if (s.effort) opts.modelReasoningEffort = s.effort;
  return opts;
}

/** Write each image attachment's base64 payload to a temp file — the SDK's `local_image` input
 *  takes a PATH, not raw bytes (verified from the shipped .d.ts's UserInput union). Cleaned up
 *  unconditionally after the turn settles. */
function materializeImages(images: ChatImage[] | undefined): { paths: string[]; cleanup: () => void } {
  if (!images?.length) return { paths: [], cleanup: () => {} };
  const dir = join(tmpdir(), `bismuth-codex-${randomUUID()}`);
  const paths: string[] = [];
  try {
    mkdirSync(dir, { recursive: true });
    images.forEach((img, i) => {
      const ext = img.media_type.split("/")[1]?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
      const p = join(dir, `image-${i}.${ext}`);
      writeFileSync(p, Buffer.from(img.data, "base64"));
      paths.push(p);
    });
  } catch {
    /* best-effort — a failed write just means fewer/no images ride this turn */
  }
  return {
    paths,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* nothing to clean up, or already gone */
      }
    },
  };
}

function runOrQueue(s: CodexSession, text: string, images?: ChatImage[]): void {
  if (s.turnActive) {
    s.queue.push({ text, images });
    return;
  }
  void runTurn(s, text, images);
}

async function runTurn(s: CodexSession, text: string, images?: ChatImage[]): Promise<void> {
  s.turnActive = true;
  s.lastActivityAt = Date.now();
  // A fresh turn's item ids are not confirmed to be globally unique across a whole thread (see
  // ./protocol.ts's header) — reset per-item tracking before consuming THIS turn's events so a
  // reused id can never diff against stale state from an earlier turn.
  resetCodexTurnState(s.translateState);

  const { paths, cleanup } = materializeImages(images);
  const input =
    paths.length > 0
      ? [...(text ? [{ type: "text" as const, text }] : []), ...paths.map((p) => ({ type: "local_image" as const, path: p }))]
      : text;

  const controller = new AbortController();
  s.controller = controller;
  const thread = s.threadId ? s.codex.resumeThread(s.threadId, threadOptions(s)) : s.codex.startThread(threadOptions(s));

  let sawErrorFrame = false;
  let hardError: string | null = null;
  try {
    const { events } = await thread.runStreamed(input, { signal: controller.signal });
    for await (const event of events as AsyncGenerator<ThreadEvent>) {
      for (const frame of translateThreadEvent(event, s.translateState)) {
        if (frame.type === "error") sawErrorFrame = true;
        emit(s, frame);
      }
    }
  } catch (e) {
    // The SDK itself THROWS mid-generator on a malformed JSONL line (a JSON.parse failure inside
    // its own runStreamedInternal) or when the child process exits non-zero/signalled (including a
    // deliberate abort — see below) — never let either propagate into an uncaught rejection or a
    // crashed turn.
    hardError = e instanceof Error ? e.message : String(e);
  } finally {
    cleanup();
  }
  s.controller = null;

  if (sessions.get(s.id) !== s) return; // closed mid-turn (closeChat) — nothing left to report to

  // Learn/refresh the durable thread id the moment it's known. Prefer the event-stream's own
  // "thread.started" (already captured into translateState.threadId as the events were consumed —
  // and NOT the Thread instance's own `.id` getter, since re-reading through the SDK's mutable
  // internal state after the fact is one more thing that could disagree with what was actually
  // streamed) but fall back to the Thread getter for the (currently unconfirmed) case where a
  // resumed thread never re-emits "thread.started".
  const threadIdNow = s.translateState.threadId ?? thread.id;
  if (threadIdNow && threadIdNow !== s.threadId) {
    s.threadId = threadIdNow;
    emit(s, { type: "session", sessionId: threadIdNow, origin: "user" });
  }

  const wasAborting = s.aborting;
  s.aborting = false;
  if (hardError && !wasAborting) emit(s, { type: "error", code: "error", message: hardError });
  const isError = (!!hardError && !wasAborting) || sawErrorFrame;
  emit(s, { type: "result", isError, numTurns: 1, costUsd: null });
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

export function openSession(chatId: string, cwd: string, sink: ChatSink): void {
  if (sessions.has(chatId)) return;
  createSession(chatId, cwd, sink);
}

export function sendMessage(chatId: string, text: string, cwd: string, sink: ChatSink, images?: ChatImage[]): void {
  let s = sessions.get(chatId);
  if (!s) {
    const created = createSession(chatId, cwd, sink);
    if (!created) return; // no-binary already pushed
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
  runOrQueue(s, text, images);
}

export function resumeSession(chatId: string, sessionId: string, cwd: string, sink: ChatSink): void {
  if (sessions.has(chatId)) closeChat(chatId);
  createSession(chatId, cwd, sink, sessionId);
}

/** No transcript-export or session-list mechanism was confirmed for Codex — the `~/.codex/sessions`
 *  rollout JSONL could in principle be tailed, but its exact shape was only medium-confidence
 *  (secondary-source) verified, not read directly the way ThreadEvent was — so historyReplay is
 *  false in the catalog and this stays a safe stub rather than populating a picker/replay from an
 *  unverified format. */
async function sessionHistoryFrames(): Promise<ChatFrame[]> {
  return [];
}

export function abortTurn(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s || !s.turnActive) return;
  s.aborting = true;
  s.queue = [];
  try {
    s.controller?.abort();
  } catch {
    /* already settled */
  }
}

export function setModel(chatId: string, model: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  // No model-list capability (see catalog.ts) — treat as a free-form string per this task's
  // instructions (OpenAI's model naming churns), not an enum. Blank clears back to Codex's default.
  const trimmed = model.trim();
  s.model = trimmed || undefined;
}

export function setEffort(chatId: string, effort: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  s.effort = isModelReasoningEffort(effort) ? effort : undefined;
}

export function closeChat(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  sessions.delete(chatId);
  if (s.closeTimer) clearTimeout(s.closeTimer);
  s.queue = [];
  if (s.turnActive) {
    try {
      s.controller?.abort();
    } catch {
      /* already settled */
    }
  }
}

export function scheduleClose(chatId: string, ms: number): void {
  const s = sessions.get(chatId);
  if (!s) return;
  scheduleSessionClose(s, ms, () => closeChat(chatId));
}

export function rebindSink(chatId: string, sink: ChatSink): boolean {
  const s = sessions.get(chatId);
  if (!s) return false;
  rebindSessionSink(s, sink);
  return true;
}

export function detachSink(chatId: string): void {
  const s = sessions.get(chatId);
  if (s) s.detached = true;
}

// Kill any in-flight Codex turns on backend shutdown (mirrors chat.ts/opencode.ts/acp/driver.ts).
let shuttingDown = false;
function shutdownAll(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const id of Array.from(sessions.keys())) closeChat(id);
}
process.on("exit", shutdownAll);

export const codexBackend: ChatBackend = {
  id: "codex",
  hasSession,
  openSession: (c: ChatTurnContext) => openSession(c.chatId, c.cwd, c.sink),
  sendMessage: (c: ChatTurnContext & { text: string }) => sendMessage(c.chatId, c.text, c.cwd, c.sink, c.images),
  resumeSession: (c: ChatTurnContext & { sessionId: string }) => resumeSession(c.chatId, c.sessionId, c.cwd, c.sink),
  sessionHistoryFrames,
  abortTurn,
  setModel,
  closeChat,
  scheduleClose,
  rebindSink,
  detachSink,
  setEffort,
  // No respondPermission/respondQuestion/setPermissionMode: codex exec has no live approval-request
  // channel to answer (see catalog.ts's permissionPrompts/permissionModes rationale) — omitting
  // these matches capabilities.permissionModes:false, so the frontend never sends a verb into a void.
};
