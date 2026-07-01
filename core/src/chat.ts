import { randomUUID } from "node:crypto";
import {
  query,
  listSessions,
  getSessionMessages,
  type CanUseTool,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { whichClaude } from "./claudeWhich";

/**
 * Visual Claude Code driver for the in-app chat surface. Each chat is ONE long-lived Agent-SDK
 * query() session that drives the USER'S OWN `claude` binary (whichClaude()) with their
 * machine-login auth — never an API call, because this app has no API key by design.
 *
 * The whole UI is fed by the SDK + each turn's `init` manifest: commands, tools, model, mcp
 * servers, and permission mode all come off the wire, so new Claude Code features show up with
 * zero code changes here — nothing is hardcoded. SDK messages are translated into the ChatFrame
 * union below and pushed to a sink (the chat WebSocket); the client renders them in order and
 * answers permission prompts inline (just like the Claude Code TUI).
 *
 * Lifecycle mirrors core/src/terminal.ts: a registry of sessions keyed by a client chat id, each
 * spawning the user's CLI, all torn down on process exit so headless `claude` runs don't outlive
 * a backend restart.
 */

// --- The wire contract (server -> client). ChatView.tsx imports ChatFrame from here. ----------

/** The self-updating per-turn manifest, sourced entirely from the SDK `system`/`init` event —
 *  NEVER hardcode any of these lists; they reflect the live CLI (commands, tools, model, …). */
export interface ChatManifest {
  model: string;
  permissionMode: string; // 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
  slashCommands: string[]; // from init.slash_commands
  tools: string[]; // from init.tools
  mcpServers: { name: string; status: string }[]; // from init.mcp_servers
}

export type ChatFrame =
  /** A fresh manifest from each `system`/`init` (emitted every turn; the manifest self-updates). */
  | { type: "manifest"; manifest: ChatManifest }
  /** A past USER turn, emitted ONLY when replaying history (live user messages come from the client,
   *  not the wire). The frontend renders it as a user bubble — same as a freshly-sent user item. */
  | { type: "user-message"; text: string }
  /** A delta of assistant prose (markdown). Streamed live from `content_block_delta` text deltas. */
  | { type: "assistant-text"; text: string }
  /** A delta of extended-thinking text. Streamed live from `content_block_delta` thinking deltas. */
  | { type: "thinking"; text: string }
  /** Claude invoked a tool (an assistant `tool_use` content block). */
  | { type: "tool-use"; id: string; name: string; input: unknown }
  /** That tool finished (a user `tool_result` content block). */
  | { type: "tool-result"; id: string; content: string; isError: boolean }
  /** canUseTool is asking the USER to approve/deny a not-pre-allowed tool. */
  | { type: "permission"; id: string; toolName: string; input: unknown }
  /** A turn ended (the `result` event). */
  | { type: "result"; isError: boolean; numTurns: number; costUsd: number | null }
  /** The turn is fully drained (pushed after `result`). */
  | { type: "done" }
  /** A fatal problem. `no-claude` = the CLI isn't installed (surface setup, never fall back to an
   *  API); `spawn`/`exit` = the child failed; `error` = an SDK/turn error. */
  | { type: "error"; code: "no-claude" | "spawn" | "exit" | "error"; message: string };

export type ChatSink = (frame: ChatFrame) => void;

/** A base64 image the user attached to a chat turn. `media_type` must be one of the SDK-accepted
 *  image MIME types (image/png | image/jpeg | image/gif | image/webp); `data` is the raw base64
 *  payload WITHOUT the `data:<mime>;base64,` prefix. Threaded client → /chat WS → chatSend →
 *  sendMessage → makeUserMessage, where it becomes an SDK image content block. */
export interface ChatImage {
  media_type: string;
  data: string;
}

/**
 * Build ONE SDKUserMessage for a turn. The content SHAPE is load-bearing:
 *  - NO images → a PLAIN STRING. The spawned `claude` CLI only runs slash-command detection/
 *    expansion for a string prompt; an array-of-blocks shape is forwarded to the model as literal
 *    text, so "/compact", "/clear", and custom commands would never execute. String content also
 *    replays fine (userMessageText handles it), so a plain string is safe for ordinary prose too.
 *  - images present → an ARRAY of content blocks: an optional leading text block, then one base64
 *    image block per attachment. MessageParam.content accepts ImageBlockParam, so no query()/preset
 *    change is needed — only this shape.
 */
export function makeUserMessage(text: string, images?: ChatImage[]): SDKUserMessage {
  const content = (
    images && images.length
      ? [
          ...(text ? [{ type: "text", text }] : []),
          ...images.map((im) => ({
            type: "image",
            source: { type: "base64", media_type: im.media_type, data: im.data },
          })),
        ]
      : text
  ) as SDKUserMessage["message"]["content"];
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: "",
  };
}

// --- Permission plumbing --------------------------------------------------------------------

/** How the client answers a "permission" frame; resolves the pending canUseTool promise. */
type PermissionDecision = { behavior: "allow" | "deny"; always?: boolean };
type PermissionResolver = (d: PermissionDecision) => void;

// The SDK CanUseTool returns this union; we shape it ourselves to avoid coupling to the SDK's
// optional fields. Allow echoes the input back unchanged; deny carries a user-facing message.
type SdkPermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

// --- The push-input queue ------------------------------------------------------------------

/**
 * An async-iterable mailbox of user turns. query() consumes it as `prompt`; each sendMessage()
 * pushes one SDKUserMessage (a slash command is just text — the CLI runs it). `close()` ends the
 * stream (the session is done). When the consumer is faster than the producer, next() parks on a
 * promise that push()/close() later settles.
 */
interface InputQueue extends AsyncIterable<SDKUserMessage> {
  push(text: string, images?: ChatImage[]): void;
  close(): void;
}

function makeInputQueue(): InputQueue {
  const buffered: SDKUserMessage[] = [];
  let waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  let closed = false;

  return {
    push(text: string, images?: ChatImage[]) {
      if (closed) return;
      const msg = makeUserMessage(text, images);
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: msg, done: false });
      } else {
        buffered.push(msg);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: undefined as unknown as SDKUserMessage, done: true });
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return {
        next(): Promise<IteratorResult<SDKUserMessage>> {
          if (buffered.length) {
            return Promise.resolve({ value: buffered.shift()!, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
          }
          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };
}

// --- Session registry ----------------------------------------------------------------------

interface ChatSession {
  id: string;
  /** The vault dir; the query()'s cwd so `claude` operates against the user's notes. */
  cwd: string;
  /** The push-input mailbox feeding query() as the multi-turn `prompt`. */
  input: InputQueue;
  /** The live query() generator + control surface (interrupt/setModel/setPermissionMode/close). */
  q: Query;
  /** Where ChatFrames go for this chat (the chat WebSocket). */
  sink: ChatSink;
  /** In-flight permission prompts keyed by toolUseID — resolved by respondPermission(). */
  pending: Map<string, PermissionResolver>;
  /** Tool names the user chose to always allow this session (canUseTool short-circuits these). */
  alwaysAllow: Set<string>;
  /** The latest Claude Code session id seen on the wire (for diagnostics). */
  sessionId: string | null;
  /** From init: "none" when the user is on a Claude subscription login (no API key) — in that case
   *  the SDK's total_cost_usd is a notional API-equivalent figure the user does NOT pay, so we hide
   *  it. Any other value means real API-key billing, where the cost is meaningful. */
  apiKeySource: string;
  /** A pending grace-period teardown (set on an abnormal WS drop, cleared on reconnect). */
  closeTimer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, ChatSession>();

/** Generate a fresh chat id (used by the server on upgrade). */
export function newChatId(): string {
  return randomUUID();
}

/** Coerce a tool_result `content` (string | block array | other) into a sensible display string. */
function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          parts.push(b.text);
          continue;
        }
      }
      // Non-text block (image, etc.) — render its JSON so nothing is silently dropped.
      try {
        parts.push(JSON.stringify(block));
      } catch {
        parts.push(String(block));
      }
    }
    return parts.join("\n");
  }
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** The visual chat prepends a `<editor-context>…</editor-context>` preamble (active file / open
 *  tabs / selection) to the WIRE message only — it's grounding context for Claude, never user prose.
 *  The live bubble is pushed raw client-side, but on HISTORY RESUME the bubble is reconstructed from
 *  the SDK-persisted content, which still carries the preamble — so strip a leading preamble block
 *  here so a replayed bubble shows only what the user actually typed. Kept in sync with
 *  ChatView.buildEditorContext (a lone `<editor-context>` line … `</editor-context>` then a blank line). */
export function stripEditorContext(text: string): string {
  return text.replace(/^<editor-context>\n[\s\S]*?\n<\/editor-context>\n\n/, "");
}

/** Coerce a user message's `content` (string | block array) into its plain prose. Used when
 *  replaying history: pulls the `text` out of `{role:"user", content}` (the raw Anthropic shape),
 *  joining the text blocks and ignoring tool_result/non-text blocks (those become tool-result frames). */
function userMessageText(content: unknown): string {
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      }
    }
    text = parts.join("");
  }
  return stripEditorContext(text);
}

/**
 * The single SOURCE-OF-TRUTH translator: one SDK message → the ChatFrame(s) it produces. Shared by
 * the live drain loop AND history replay so both render identically.
 *
 * `live` distinguishes the two consumers:
 *  - live=true (drain loop): assistant text/thinking already streamed via `stream_event` deltas, so
 *    an `assistant` message contributes only its `tool_use` blocks (no double-emit). User turns are
 *    the client's own input (never echoed back), so a `user` message contributes only tool_result
 *    frames. `system`/`result` are handled inline by the drain loop (they touch session state) and
 *    are NOT translated here.
 *  - live=false (history): there are no deltas, so an `assistant` message contributes its text +
 *    thinking + tool_use blocks in order, a `user` message contributes a `user-message` frame for
 *    its prose AND tool-result frames for any tool_result blocks. `system` carries no replayable UI.
 */
function translateSdkMessage(msg: SessionMessage | SDKMessage, opts: { live: boolean }): ChatFrame[] {
  const frames: ChatFrame[] = [];

  if (msg.type === "assistant") {
    const content = (msg.message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use") {
          frames.push({
            type: "tool-use",
            id: typeof b.id === "string" ? b.id : randomUUID(),
            name: typeof b.name === "string" ? b.name : "tool",
            input: b.input,
          });
        } else if (!opts.live) {
          // History has no deltas — replay assistant prose + thinking from the final blocks.
          if (b.type === "text" && typeof b.text === "string" && b.text.length) {
            frames.push({ type: "assistant-text", text: b.text });
          } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.length) {
            frames.push({ type: "thinking", text: b.thinking });
          }
        }
      }
    }
    return frames;
  }

  if (msg.type === "user") {
    const content = (msg.message as { content?: unknown }).content;
    // A live user message is ONLY the carrier of tool_result blocks (the user's own prompt came from
    // the client). In history we also surface the prose as a user-message bubble.
    if (!opts.live) {
      const text = userMessageText(content);
      if (text.length) frames.push({ type: "user-message", text });
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "tool_result") {
          frames.push({
            type: "tool-result",
            id: typeof b.tool_use_id === "string" ? b.tool_use_id : "",
            content: stringifyToolContent(b.content),
            isError: b.is_error === true,
          });
        }
      }
    }
    return frames;
  }

  // system / result carry no frame here — the live loop handles them inline (they mutate session
  // state); history has nothing replayable from them.
  return frames;
}

/**
 * Send a user turn. The FIRST call for a chatId creates the session: it builds the input queue and
 * starts a single long-lived query() (the user's `claude`, machine-login auth, partial messages on
 * for live streaming), then spawns a background drain loop. Every call (first and subsequent)
 * pushes `text` into the queue so the CLI runs it as the next turn. If `claude` isn't installed,
 * pushes {error, code:"no-claude"} and returns — NEVER calls any API.
 */
export function sendMessage(chatId: string, text: string, cwd: string, sink: ChatSink, images?: ChatImage[]): void {
  const existing = sessions.get(chatId);
  if (existing) {
    // Existing session: a turn arriving cancels any pending grace-teardown (we reconnected), keeps
    // the sink fresh (a reconnect installs a new socket), and queues the turn.
    if (existing.closeTimer) {
      clearTimeout(existing.closeTimer);
      existing.closeTimer = undefined;
    }
    existing.sink = sink;
    existing.cwd = cwd;
    existing.input.push(text, images);
    return;
  }

  const session = createSession(chatId, cwd, sink);
  if (!session) return; // no-claude / spawn error already pushed to the sink

  // Send the first turn, then drain the generator forever (until the queue closes / session ends).
  session.input.push(text, images);
  void drain(session);
}

/**
 * Resume an EXISTING Claude Code session into this chatId — the chat becomes a true window onto the
 * user's real conversation (terminal + in-app share one store). Mirrors the first-call branch of
 * sendMessage but passes `options.resume: sessionId` to query() and pushes NO initial turn: it just
 * opens the input queue and starts draining so the resumed session's `init` manifest streams in. The
 * subsequent sendMessage(chatId, …) continues this resumed session normally.
 *
 * If a session already exists for this chatId, it's torn down first so we cleanly re-bind to the
 * resumed conversation.
 */
export function resumeSession(chatId: string, sessionId: string, cwd: string, sink: ChatSink): void {
  if (sessions.has(chatId)) closeChat(chatId);
  const session = createSession(chatId, cwd, sink, sessionId);
  if (!session) return; // no-claude / spawn error already pushed to the sink
  // No initial turn — query() resumes the existing session; the drain loop streams its init manifest.
  void drain(session);
}

/**
 * Build + register a chat session (the user's `claude`, machine-login auth, live partial messages),
 * wiring the canUseTool permission flow and the claude_code preset. Returns the registered session,
 * or null after pushing a friendly error frame (no `claude` on PATH, or query() spawn failure).
 *
 * When `resume` is given, query() resumes that existing Claude Code session (keeps its history +
 * session_id) instead of starting fresh — the ONLY difference from a brand-new session.
 */
function createSession(chatId: string, cwd: string, sink: ChatSink, resume?: string): ChatSession | null {
  const bin = whichClaude();
  if (!bin) {
    sink({ type: "error", code: "no-claude", message: "The `claude` CLI was not found. Install Claude Code to use chat." });
    return null;
  }

  const input = makeInputQueue();
  const session: ChatSession = {
    id: chatId,
    cwd,
    input,
    // q is assigned just below; the canUseTool closure only runs after query() returns, so the
    // forward reference through `session` is safe.
    q: undefined as unknown as Query,
    sink,
    pending: new Map(),
    alwaysAllow: new Set(),
    sessionId: null,
    apiKeySource: "none",
  };

  // canUseTool fires ONLY for tools not already allowed by the user's settings (pre-allowed tools
  // run silently — correct Claude Code behavior). Pre-approved-this-session tools short-circuit;
  // everything else surfaces a "permission" frame and parks until the client answers.
  const canUseTool = (
    toolName: string,
    toolInput: Record<string, unknown>,
    opts: { toolUseID?: string },
  ): Promise<SdkPermissionResult> => {
    if (session.alwaysAllow.has(toolName)) {
      return Promise.resolve({ behavior: "allow", updatedInput: toolInput });
    }
    const id = opts.toolUseID ?? randomUUID();
    return new Promise<SdkPermissionResult>((resolve) => {
      session.pending.set(id, ({ behavior, always }) => {
        if (behavior === "allow") {
          if (always) session.alwaysAllow.add(toolName);
          resolve({ behavior: "allow", updatedInput: toolInput });
        } else {
          resolve({ behavior: "deny", message: "Denied by the user" });
        }
      });
      session.sink({ type: "permission", id, toolName, input: toolInput });
    });
  };

  let q: Query;
  try {
    q = query({
      prompt: input,
      options: {
        pathToClaudeCodeExecutable: bin,
        cwd,
        includePartialMessages: true,
        // resume an existing Claude Code session (keeps its history + session_id) when asked; a
        // brand-new session simply omits it.
        ...(resume ? { resume } : {}),
        // permissionMode is intentionally NOT set: omitting it (like settingSources) makes the SDK
        // resolve it from the user's OWN Claude Code config — the app doesn't determine the starting
        // mode. The user can still switch it live in the header (set_permission_mode).
        // Use Claude Code's own preset system prompt — this is a VISUAL CLAUDE CODE, so it must
        // behave like the TUI: the preset injects the `<env>` context (working directory, platform,
        // today's date) + loads CLAUDE.md, skills, and the full tool guidance. Without it the SDK
        // ships a bare prompt with NO cwd context, so the model can't know its working directory and
        // resolves a relative path like `t.txt` against $HOME instead of `cwd` (writes land in the
        // wrong dir). The preset makes relative paths resolve against `cwd` exactly like the CLI.
        systemPrompt: { type: "preset", preset: "claude_code" },
        // The SDK CanUseTool type carries many optional fields we don't read; cast our narrow
        // closure to it.
        canUseTool: canUseTool as unknown as CanUseTool,
      },
    });
  } catch (e) {
    sink({ type: "error", code: "spawn", message: (e as Error).message });
    return null;
  }
  session.q = q;
  sessions.set(chatId, session);
  return session;
}

// --- Session history (the resume picker) ----------------------------------------------------

/**
 * List the user's existing Claude Code sessions for a cwd — BOTH their terminal Claude Code sessions
 * and in-app chat sessions for that dir (one unified store, newest-first). Powers the chat's history
 * picker. Tolerant: returns [] if the SDK can't read the store.
 */
export async function listChatSessions(
  cwd: string,
  limit = 50,
): Promise<{ sessionId: string; summary: string; lastModified: number }[]> {
  try {
    const sessions = await listSessions({ dir: cwd, limit });
    return sessions.map((s) => ({
      sessionId: s.sessionId,
      summary: s.summary,
      lastModified: s.lastModified,
    }));
  } catch {
    return [];
  }
}

/**
 * Replay a past session as ChatFrames, in order — the same frames the live drain loop would have
 * produced, via the single translateSdkMessage source of truth (live=false: assistant text/thinking/
 * tool_use, user-message bubbles for user prose, tool-result frames for tool_result blocks). Tolerant
 * of odd/empty messages; returns [] if the session can't be read.
 */
export async function sessionHistoryFrames(sessionId: string, cwd: string): Promise<ChatFrame[]> {
  let messages: SessionMessage[];
  try {
    messages = await getSessionMessages(sessionId, { dir: cwd });
  } catch {
    return [];
  }
  const frames: ChatFrame[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    try {
      for (const frame of translateSdkMessage(msg, { live: false })) frames.push(frame);
    } catch {
      /* skip a malformed message rather than abort the whole replay */
    }
  }
  return frames;
}

/**
 * The drain loop: translate every SDK message for this session into ChatFrames per the taxonomy.
 * Runs until the generator ends (input queue closed or the CLI exited). Wrapped so any throw —
 * including query()'s "Reached maximum number of turns" — surfaces as a friendly error frame
 * instead of crashing the server.
 *
 * De-dupe: assistant text/thinking are emitted LIVE via stream_event deltas; when the final
 * `assistant` message arrives we skip its text/thinking blocks (already streamed) and emit only
 * the tool_use blocks (which have no delta form).
 */
async function drain(session: ChatSession): Promise<void> {
  let drainError: string | null = null;
  try {
    for await (const msg of session.q as AsyncIterable<SDKMessage>) {
      // Capture the session id wherever it appears.
      const anyMsg = msg as { session_id?: string };
      if (typeof anyMsg.session_id === "string" && anyMsg.session_id) {
        session.sessionId = anyMsg.session_id;
      }

      if (msg.type === "system" && msg.subtype === "init") {
        // "none" => the user is on a Claude subscription login (no API key), so the reported cost
        // is notional and we hide it. Read from Claude Code's own init — the app doesn't decide this.
        session.apiKeySource = (msg as { apiKeySource?: string }).apiKeySource ?? session.apiKeySource;
        session.sink({
          type: "manifest",
          manifest: {
            model: msg.model,
            permissionMode: msg.permissionMode,
            slashCommands: msg.slash_commands ?? [],
            tools: msg.tools ?? [],
            mcpServers: (msg.mcp_servers ?? []).map((m) => ({ name: m.name, status: m.status })),
          },
        });
        continue;
      }

      if (msg.type === "system" && msg.subtype === "local_command_output") {
        // A slash command whose output is produced LOCALLY (e.g. /compact, /context, or a custom
        // command that only prints) arrives solely as this system message — it never becomes an
        // assistant turn. Surface its text as assistant prose so the command's output is visible
        // instead of the turn appearing to do nothing.
        const out = msg.content;
        if (typeof out === "string" && out.length) session.sink({ type: "assistant-text", text: out });
        continue;
      }

      if (msg.type === "stream_event") {
        // Live deltas (only present with includePartialMessages). Prefer these for streaming.
        const ev = msg.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
        if (ev?.type === "content_block_delta" && ev.delta) {
          if (ev.delta.type === "text_delta" && typeof ev.delta.text === "string" && ev.delta.text.length) {
            session.sink({ type: "assistant-text", text: ev.delta.text });
          } else if (ev.delta.type === "thinking_delta" && typeof ev.delta.thinking === "string" && ev.delta.thinking.length) {
            session.sink({ type: "thinking", text: ev.delta.thinking });
          }
        }
        continue;
      }

      if (msg.type === "assistant" || msg.type === "user") {
        // assistant → tool_use frames (text/thinking already streamed live via deltas — don't
        // double-emit); user → tool_result frames (the user's own prompt came from the client).
        // Shared with history replay via the single translateSdkMessage source of truth.
        for (const frame of translateSdkMessage(msg, { live: true })) session.sink(frame);
        continue;
      }

      if (msg.type === "result") {
        session.sink({
          type: "result",
          isError: msg.is_error === true,
          numTurns: typeof msg.num_turns === "number" ? msg.num_turns : 0,
          // Hide cost on a subscription login (notional, not billed); only show it for real
          // API-key billing. Driven by Claude Code's own apiKeySource, not an app decision.
          costUsd:
            session.apiKeySource === "none" || typeof msg.total_cost_usd !== "number"
              ? null
              : msg.total_cost_usd,
        });
        session.sink({ type: "done" });
        continue;
      }
      // Other message kinds (status/retry/hooks/etc.) carry no UI frame — ignore.
    }
  } catch (e) {
    drainError = (e as Error).message;
  } finally {
    // If closeChat() tore the session down it was already removed from the registry, so reaching
    // here with the session STILL registered means the drain ended on its OWN — the `claude` child
    // exited (or threw). Evict it (so the next sendMessage re-spawns a fresh session) and tell the
    // client; otherwise a queued turn would push into a dead input queue and the UI would hang
    // forever with no frame. A throw surfaces as `error`; a clean end as `exit`.
    if (sessions.get(session.id) === session) {
      sessions.delete(session.id);
      if (session.closeTimer) clearTimeout(session.closeTimer);
      for (const resolve of session.pending.values()) {
        try {
          resolve({ behavior: "deny" });
        } catch {
          /* */
        }
      }
      session.pending.clear();
      try {
        session.input.close();
      } catch {
        /* */
      }
      session.sink(
        drainError
          ? { type: "error", code: "error", message: drainError }
          : { type: "error", code: "exit", message: "The Claude Code session ended — send another message to start a new one." },
      );
    }
  }
}

/** Answer a pending "permission" frame. No-op if the id is unknown (already answered / stale). */
export function respondPermission(
  chatId: string,
  id: string,
  behavior: "allow" | "deny",
  always?: boolean,
): void {
  const s = sessions.get(chatId);
  if (!s) return;
  const resolve = s.pending.get(id);
  if (!resolve) return;
  s.pending.delete(id);
  resolve({ behavior, always });
}

/** Switch the permission mode live (default | plan | acceptEdits | bypassPermissions). */
export function setPermissionMode(chatId: string, mode: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  try {
    s.q.setPermissionMode(mode as Parameters<Query["setPermissionMode"]>[0])?.catch(() => {});
  } catch {
    /* session not ready / already closed */
  }
}

/** Switch the model live. Fully wired end-to-end (server `set_model` route → ChatView's `setModel`),
 *  but NOT yet surfaced in the UI: the manifest exposes the active model read-only, and there's no
 *  reliable available-models list from the SDK to populate a picker. Intentionally kept available
 *  for when a model chooser is added — the header shows the current model today. */
export function setModel(chatId: string, model: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  try {
    s.q.setModel(model)?.catch(() => {});
  } catch {
    /* session not ready / already closed */
  }
}

/** Interrupt the in-flight turn, leaving the session resumable for the next sendMessage. */
export function abortTurn(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  try {
    s.q.interrupt()?.catch(() => {});
  } catch {
    /* nothing in flight / already closed */
  }
}

/** Tear a session down entirely: interrupt + close the generator, reject pending prompts, drop it. */
export function closeChat(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  if (s.closeTimer) clearTimeout(s.closeTimer);
  sessions.delete(chatId);
  // Reject every pending permission as a deny so canUseTool promises don't dangle.
  for (const resolve of s.pending.values()) {
    try {
      resolve({ behavior: "deny" });
    } catch {
      /* */
    }
  }
  s.pending.clear();
  // Close the input queue first so the multi-turn stream ends gracefully, then tear the query down.
  // Swallow the control-request rejection close()/interrupt() can raise when a turn is mid-flight
  // ("Query closed before response received") — this is teardown, the error is expected.
  try {
    s.input.close();
  } catch {
    /* */
  }
  try {
    s.q.interrupt?.()?.catch(() => {});
  } catch {
    /* */
  }
  try {
    // close() is synchronous (returns void), unlike interrupt().
    s.q.close?.();
  } catch {
    /* */
  }
}

/**
 * Schedule a session teardown after `ms` of no reconnect. A transient WS drop (a reload, a network
 * blip) should NOT nuke the conversation — the next sendMessage for this chatId cancels the timer
 * and resumes the same `claude` session. Used by the server's WS close handler for abnormal closes;
 * a clean tab-close calls closeChat() directly for an immediate teardown.
 */
export function scheduleClose(chatId: string, ms: number): void {
  const s = sessions.get(chatId);
  if (!s) return;
  if (s.closeTimer) clearTimeout(s.closeTimer);
  s.closeTimer = setTimeout(() => closeChat(chatId), ms);
}

/** Re-point a live session's frame sink at a freshly-reconnected socket (and cancel any pending
 *  grace-period teardown). The server calls this on a chat WS `open` so a reconnect mid-turn resumes
 *  the SAME session and its in-flight frames flow to the new socket — without this, the drain loop
 *  keeps writing to the dead socket and the turn's tail (incl. `done`) is lost, wedging the UI.
 *  Returns true if a session existed for `chatId` (the reconnect rebound it). */
export function rebindSink(chatId: string, sink: ChatSink): boolean {
  const s = sessions.get(chatId);
  if (!s) return false;
  if (s.closeTimer) {
    clearTimeout(s.closeTimer);
    s.closeTimer = undefined;
  }
  s.sink = sink;
  return true;
}

export function chatSessionCount(): number {
  return sessions.size;
}

// Tear down every chat session (kills the spawned `claude` children) so headless runs don't outlive
// a backend restart, mirroring terminal.ts. process.on("exit") is synchronous-only and can't await
// the SDK's async teardown, so we ALSO handle the graceful termination signals: there we run the
// teardown and give the SDK a tick to kill its child `claude` processes before exiting, which a
// bare "exit" handler can't do. (A hard SIGKILL is unavoidable — nothing can run then.)
let chatShuttingDown = false;
function shutdownAllChats(): void {
  if (chatShuttingDown) return;
  chatShuttingDown = true;
  for (const id of Array.from(sessions.keys())) closeChat(id);
}
process.on("exit", shutdownAllChats);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    shutdownAllChats();
    setTimeout(() => process.exit(0), 200);
  });
}
