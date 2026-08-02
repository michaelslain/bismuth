// core/src/chatProviders/codex/driver.ts
//
// The effectful half of the Codex chat backend: spawns the user's OWN `codex` binary directly
// (`codex exec`) via Bun.spawn and pumps its NDJSON stdout — the exact pattern ../opencode.ts's run
// mode already uses for opencode. See ./protocol.ts for the pure ThreadEvent-shaped-JSON ->
// ChatFrame translator this wraps; that module is untouched by this revision, because the wire
// events `codex exec --json`/`--experimental-json` emit are the same shape whether parsed by hand
// or by a client library (see below).
//
// WHY NOT @openai/codex-sdk (a prior revision of this file used it; removed on review):
//  - It buys NOTHING for lifecycle: reading its shipped dist/index.js showed `Thread.runStreamed()`
//    spawns a FRESH `codex exec` subprocess on every call — there is no long-lived session process
//    to manage, so there was never a lifecycle advantage over spawning the CLI ourselves.
//  - It has NO per-session MCP field (ThreadOptions carries no `mcpServers`-shaped option at all,
//    confirmed absent from the .d.ts) — surface 5 was already CLI-registrar-only either way
//    (agentBackends/mcpRegistrars.ts's `codex mcp add`), so the SDK bought nothing there either.
//  - Its own binary resolution has NO PATH lookup: without an explicit override it resolves a
//    BUNDLED platform binary via `require.resolve('@openai/codex/package.json')` — an
//    optionalDependency of `@openai/codex` that measured ~310MB on disk for one platform. Every
//    OTHER backend in this codebase drives the user's own installed CLI through the same
//    augmented-PATH lookup (`whichOpencode()` in ../opencode.ts, `whichBinary()` in
//    ../../claudeWhich.ts) — a vendored second copy of a coding agent is the wrong shape for this
//    app, adds ~310MB to every contributor's `bun install`, and can silently drift from the actual
//    version the user has logged into and configured.
// So this driver resolves `codex` via the SAME whichBinary() every other backend uses and drives it
// as a plain subprocess — no SDK dependency at all.
//
// Lifecycle mirrors ../opencode.ts exactly: a session Map keyed by chat id, emit/
// rebindSessionSink/scheduleSessionClose from ../sessionSink for reconnect buffering, a turn queue
// serialized through the settle point at the end of runTurn, tolerant NDJSON parsing (a bad line is
// skipped, never crashes the turn), process.on("exit") teardown, and NEVER throwing into a user's
// chat. Continuity across turns rides `codex exec resume <threadId>`, learned from the first
// "thread.started" event of the stream — the same "-s <sessionID> per invocation" shape
// opencode.ts already uses for its own per-turn subprocess.
//
// `--json` vs `--experimental-json`: `codex exec --json` is a real, documented flag captured from
// the CLI's own `--help` output. Separately, reading the (now removed) SDK's compiled source showed
// IT invokes `codex exec --experimental-json` internally —
// the same OpenAI-maintained package, pinned to the exact CLI version it targets. Both are real,
// evidenced spellings for what is presumably the same wire protocol, and this driver cannot tell
// which one a given installed `codex` recognizes without running it. So `--json` is tried first
// (the documented, human-facing flag); if a turn's `codex exec` produces ZERO parseable JSON lines
// while exiting non-zero — a signature specific to "the flag was rejected before anything could
// start" (a genuine turn failure still emits at least `thread.started` first, since the thread id
// is assigned before any model call happens) — the SAME turn is retried exactly once with
// `--experimental-json`, and whichever spelling works is cached for the rest of the session. This
// mirrors ../acp/driver.ts's `fallbackArgs` retry-once pattern for the identical kind of
// version-uncertain flag spelling (Gemini CLI's `--experimental-acp`/`--acp`).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FileSink } from "bun";
import type { ChatFrame, ChatImage, ChatManifest, ChatSink } from "../../chat";
import { detachSessionSink, emit, reattachSessionSink, rebindSessionSink, scheduleSessionClose } from "../sessionSink";
import { claudeSpawnEnv, whichBinary } from "../../claudeWhich";
import type { ChatBackend, ChatTurnContext } from "../backends";
import { readCodexOptIns } from "../../settings";
import { writeAgentsMdBlock } from "../../agentBackends/agentsMd";
import { writeCodexHooksFiles } from "../../agentBackends/codexHooks";
import { titleFromPrompt } from "../titleFromPrompt";
import { newCodexTranslateState, resetCodexTurnState, translateThreadEvent, type CodexTranslateState } from "./protocol";

/** Codex's five reasoning-effort levels — a small, stable enum unlike model ids, which churn
 *  (confirmed from the CLI's own --config reference: `model_reasoning_effort`). */
type ModelReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
const EFFORT_VALUES: readonly ModelReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
function isModelReasoningEffort(v: string): v is ModelReasoningEffort {
  return (EFFORT_VALUES as readonly string[]).includes(v);
}

type JsonFlag = "--json" | "--experimental-json";
function fallbackJsonFlag(flag: JsonFlag): JsonFlag {
  return flag === "--json" ? "--experimental-json" : "--json";
}

interface CodexSession {
  id: string;
  cwd: string;
  sink: ChatSink;
  /** Resolved once at session creation (see createSession) — never re-resolved per turn. */
  bin: string;
  /** The CLI's own durable thread id, learned from the first turn's `thread.started` event (or
   *  seeded on resume). `null` until the first turn actually starts. */
  threadId: string | null;
  /** Free-form model id for FUTURE turns (no model-list capability — see catalog.ts's rationale —
   *  so this is never populated from a picker today, only settable programmatically). */
  model?: string;
  /** One of Codex's five reasoning-effort levels for FUTURE turns. */
  effort?: ModelReasoningEffort;
  /** Which `--json`/`--experimental-json` spelling has worked so far — see file header. Learned
   *  once per session and reused for every later turn. */
  jsonFlag: JsonFlag;
  translateState: CodexTranslateState;
  turnActive: boolean;
  /** Set by abortTurn right before kill(); cleared once the turn settles (so its resulting
   *  non-zero exit is reported as a deliberate Stop, not a turn error) — mirrors opencode.ts's
   *  `aborting`. */
  aborting: boolean;
  proc: ReturnType<typeof Bun.spawn> | null;
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

/** The user's own `codex` binary, resolved against the same augmented PATH every other backend
 *  uses (homebrew/~/.local/bin/nvm/POSIX dirs — a Finder-launched bundle sees a minimal PATH). */
export function whichCodex(): string | null {
  return whichBinary("codex");
}

/** Codex has none of the dynamic manifest fields Claude/opencode report (no live tool registry, no
 *  slash-command registry — see catalog.ts's rationale for why those capabilities are false), so
 *  this is a single static frame emitted once at session open rather than something re-derived per
 *  turn. */
function blankManifest(model: string): ChatManifest {
  return { model, permissionMode: "default", slashCommands: [], tools: [], mcpServers: [] };
}

function buildCodexEnv(): Record<string, string> {
  // claudeSpawnEnv's name is a historical artifact (see core/src/claudeWhich.ts) — it's a general
  // "spawn env for a CLI that needs Keychain/PATH access" builder, already reused unmodified by
  // ../opencode.ts and ../acp/driver.ts for their own (non-Claude) child processes.
  //
  // "chat": this IS the chat surface (an alternate backend for the same in-app chat core/src/chat.ts
  // drives for Claude) — stamps BISMUTH_AGENT_CHANNEL so a `bismuth` invocation from this codex
  // process's own Bash-equivalent tool is gated by core/src/visibilityCliGate.ts rather than running
  // as the vault owner's own hand (the unstamped default).
  return claudeSpawnEnv(process.env, "chat") as Record<string, string>;
}

interface CodexExecArgsInput {
  jsonFlag: JsonFlag;
  cwd: string;
  model?: string;
  effort?: ModelReasoningEffort;
  threadId: string | null;
  imagePaths: string[];
}

/** Build `codex exec`'s argv. Flag choice/order mirrors the (now-removed) official SDK's own
 *  arg-builder verbatim — read from its compiled source before this driver stopped depending on
 *  it, so this is real, working, OpenAI-maintained behavior, not a guess: `--sandbox`/`--cd`/
 *  `--skip-git-repo-check`/`--model` as direct flags, reasoning effort + approval policy via
 *  `--config key="value"` (TOML string literals), `resume <id>` AFTER every flag, `--image <path>`
 *  repeated last. The prompt itself is NEVER a positional argv element — Bun.spawn passes argv
 *  directly to execve (no shell involved), so none of this needs quoting; the prompt is written to
 *  the child's stdin instead (see runTurn), matching that same verified SDK behavior (it always
 *  piped stdin, resume or not, rather than ever passing the prompt as a CLI argument). */
function buildCodexExecArgs(a: CodexExecArgsInput): string[] {
  const args: string[] = ["exec", a.jsonFlag];
  if (a.model) args.push("--model", a.model);
  args.push("--sandbox", "workspace-write");
  args.push("--cd", a.cwd);
  args.push("--skip-git-repo-check");
  if (a.effort) args.push("--config", `model_reasoning_effort="${a.effort}"`);
  // `codex exec` has no TTY to prompt on anyway (there is no session/request_permission-shaped
  // event in the ThreadEvent union) — explicit for determinism, matching opencode.ts's `--auto`
  // posture (the same effective "never park on an approval this run mode can't answer" stance).
  args.push("--config", 'approval_policy="never"');
  if (a.threadId) args.push("resume", a.threadId);
  for (const p of a.imagePaths) args.push("--image", p);
  return args;
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
  const bin = whichCodex();
  if (!bin) {
    sink({
      type: "error",
      code: "no-binary",
      binary: "codex",
      message: "The `codex` CLI was not found. Install OpenAI Codex (`npm i -g @openai/codex`) and run `codex` once to log in.",
    });
    return null;
  }
  const s: CodexSession = {
    id: chatId,
    cwd,
    sink,
    bin,
    threadId: resumeId ?? null,
    jsonFlag: "--json",
    translateState: newCodexTranslateState(resumeId ?? null),
    turnActive: false,
    aborting: false,
    proc: null,
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

/** Write each image attachment's base64 payload to a temp file — `--image` takes a PATH, not raw
 *  bytes. Cleaned up unconditionally after the turn settles. */
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

/** Spawn one `codex exec` for this turn and stream its NDJSON stdout as ChatFrames — the
 *  ../opencode.ts run-mode pattern verbatim, adapted for Codex's argv/stdin shape.
 *  `useFallbackFlag` is set ONLY by the internal one-time retry below; callers never pass it. */
async function runTurn(s: CodexSession, text: string, images?: ChatImage[], useFallbackFlag = false): Promise<void> {
  s.turnActive = true;
  s.lastActivityAt = Date.now();
  // A fresh turn's item ids are not confirmed to be globally unique across a whole thread (see
  // ./protocol.ts's header) — reset per-item tracking before consuming THIS turn's events so a
  // reused id can never diff against stale state from an earlier turn.
  resetCodexTurnState(s.translateState);

  const { paths, cleanup } = materializeImages(images);
  const jsonFlag = useFallbackFlag ? fallbackJsonFlag(s.jsonFlag) : s.jsonFlag;
  const args = buildCodexExecArgs({ jsonFlag, cwd: s.cwd, model: s.model, effort: s.effort, threadId: s.threadId, imagePaths: paths });

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([s.bin, ...args], { cwd: s.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: buildCodexEnv() });
  } catch (e) {
    cleanup();
    s.turnActive = false;
    emit(s, { type: "error", code: "spawn", message: (e as Error).message });
    return;
  }
  s.proc = proc;

  // The prompt rides stdin, never a positional argv element — matches the verified (now-removed)
  // SDK behavior exactly (see buildCodexExecArgs's comment): `codex exec` reads it and closes on EOF.
  try {
    const stdin = proc.stdin as FileSink;
    stdin.write(text);
    await stdin.end();
  } catch {
    /* pipe already gone — the exit handler below reports the outcome */
  }

  const stderrPromise = new Response(proc.stderr as ReadableStream).text().catch(() => "");

  let sawErrorFrame = false;
  let parsedAnyLine = false;
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
        parsedAnyLine = true;
        for (const frame of translateThreadEvent(ev, s.translateState)) {
          if (frame.type === "error") sawErrorFrame = true;
          emit(s, frame);
        }
      }
    }
  } catch {
    /* stream torn down mid-read (kill/abort) — the exit handler below reports the outcome */
  }

  const exitCode = await proc.exited.catch(() => 1);
  const stderr = await stderrPromise;
  cleanup();
  const wasAborting = s.aborting;
  s.proc = null;

  if (sessions.get(s.id) !== s) return; // closed mid-turn (closeChat) — nothing left to report to

  // The durable thread id, the moment it's first learned — translateThreadEvent already set this
  // on translateState as the events were consumed.
  const threadIdNow = s.translateState.threadId;
  if (threadIdNow && threadIdNow !== s.threadId) {
    s.threadId = threadIdNow;
    emit(s, { type: "session", sessionId: threadIdNow, origin: "user" });
  }

  // Defensive fallback for the --json / --experimental-json spelling uncertainty (see file header):
  // zero parseable JSON lines + a non-zero exit is specifically "the flag was never recognized, so
  // nothing ever started" — retry ONCE with the other spelling before reporting a hard failure.
  // Never loops (useFallbackFlag guards it); a real turn failure still gets at least
  // "thread.started" first, so this can't misfire on a genuine model/API error.
  if (!parsedAnyLine && exitCode !== 0 && !wasAborting && !useFallbackFlag) {
    s.aborting = false;
    return runTurn(s, text, images, true);
  }
  if (useFallbackFlag && parsedAnyLine) {
    s.jsonFlag = jsonFlag; // the fallback spelling worked — stick with it for every later turn
  }

  s.aborting = false;
  const failed = exitCode !== 0 && !wasAborting;
  if (failed && !sawErrorFrame) {
    const tail = stderr.trim().split("\n").slice(-3).join("\n").trim();
    emit(s, { type: "error", code: "error", message: tail || `codex exited with code ${exitCode}` });
  }
  emit(s, { type: "result", isError: failed || sawErrorFrame, numTurns: 1, costUsd: null });
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
    reattachSessionSink(s, sink);
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
  if (!s || !s.turnActive || !s.proc) return;
  s.aborting = true;
  s.queue = [];
  try {
    s.proc.kill();
  } catch {
    /* already exited */
  }
}

export function setModel(chatId: string, model: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  // No model-list capability (see catalog.ts) — treat as a free-form string, not an enum (OpenAI's
  // model naming churns). Blank clears back to Codex's default.
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

export function rebindSink(chatId: string, sink: ChatSink): boolean {
  const s = sessions.get(chatId);
  if (!s) return false;
  rebindSessionSink(s, sink);
  return true;
}

export function detachSink(chatId: string, sink: ChatSink): boolean {
  const s = sessions.get(chatId);
  return s ? detachSessionSink(s, sink) : false;
}

// Kill any in-flight Codex children on backend shutdown (mirrors chat.ts/opencode.ts/acp/driver.ts).
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
