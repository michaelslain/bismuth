import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ChatAgentSession } from "./agents";
import {
  query,
  listSessions,
  getSessionMessages,
  getSessionInfo,
  type CanUseTool,
  type EffortLevel,
  type HookInput,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { whichClaude } from "./claudeWhich";
import { buildAutoNoteBody, extractText, recallMemory, stripInjectedBlocks, writeNote as writeMemoryNote, type TranscriptEntry } from "@bismuth/memory";
import { buildDenyPaths, buildManagedSettingsDeny, absDenyPaths, denyPathSet, type DenyEntry } from "./visibility";

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
   *  not the wire). The frontend renders it as a user bubble — same as a freshly-sent user item.
   *  `images` carries any persisted image attachments as data: URLs so an image(-only) turn
   *  survives replay instead of vanishing. */
  | { type: "user-message"; text: string; images?: string[] }
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
  /** Claude called the AskUserQuestion tool — 1-4 multiple-choice questions the USER must answer for
   *  the turn to continue. Reaches the host through the SDK's `canUseTool` channel (verified live: the
   *  `onUserDialog` path never fires for a programmatic query()); we intercept it there and surface it
   *  as this frame. The client renders interactive option buttons and answers via
   *  {type:"question_response", id, answers} (or skips), which resolves the parked canUseTool promise. */
  | { type: "question"; id: string; questions: ChatQuestion[] }
  /** A turn ended (the `result` event). */
  | { type: "result"; isError: boolean; numTurns: number; costUsd: number | null }
  /** The turn is fully drained (pushed after `result`). */
  | { type: "done" }
  /** The models this login can run (Query.supportedModels), fetched EAGERLY on session spawn — the
   *  SDK's `initialize` control request resolves the moment the CLI subprocess starts (NOT gated on a
   *  user turn), so this powers the header model picker the instant the chat opens, BEFORE the first
   *  message (set_model is wired end-to-end). Emitted once per session (the list is static per login).
   *  Each model also carries the reasoning-effort levels IT supports (ModelInfo.supportedEffortLevels)
   *  so the header's Effort picker (FEATURE #63) offers exactly what the SELECTED model allows —
   *  never a hardcoded list. Empty for a model/CLI that doesn't expose effort → the picker hides. */
  | { type: "models"; models: { value: string; label: string; description: string; effortLevels: string[] }[] }
  /** The session's conversation summary (Query store via getSessionInfo) — names the chat tab.
   *  Emitted once per session, retried each turn-end until a non-empty summary exists. */
  | { type: "title"; title: string }
  /** The SDK session_id this chat is bound to, emitted the moment it's first learned (and again if
   *  it ever changes — e.g. after a resume). The client persists it keyed by the chat TAB id so a
   *  reopened tab (Cmd+Shift+T) can RESUME the same conversation instead of spawning a blank one —
   *  the session_id is the durable, on-disk identity of the conversation (app/src/chatSessionStore.ts). */
  | { type: "session"; sessionId: string }
  /** Context-window usage after a completed turn (Query.getContextUsage) — the header pill. */
  | { type: "context"; percentage: number; totalTokens: number; maxTokens: number }
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

// --- AskUserQuestion (interactive multiple-choice tool) -------------------------------------
//
// AskUserQuestion (Claude's interactive multiple-choice tool) reaches the host through the SDK's
// `canUseTool` permission channel — NOT the `onUserDialog`/`request_user_dialog` path (that's the
// interactive TUI's renderer; verified live that it never fires for a programmatic query() with a
// canUseTool present). We intercept the AskUserQuestion tool call in canUseTool, surface the
// question(s) as a `question` frame (interactive option buttons), and PARK the permission promise
// until the client answers. The answer is delivered by returning `{ behavior: "allow", updatedInput:
// { ...input, answers } }` where `answers` maps each question's TEXT to the chosen answer string —
// the tool then reads `answers` off its (updated) input to build the output. Verified against CLI
// 2.1.x: the assistant received the returned answer and continued the turn.

/** The Claude Code tool name we intercept in canUseTool to render the interactive question card. */
export const ASK_USER_QUESTION_TOOL = "AskUserQuestion";

/** One selectable option in an AskUserQuestion question. */
export interface ChatQuestionOption {
  label: string;
  description: string;
}

/** One question from an AskUserQuestion tool call (the client renders the options as buttons). */
export interface ChatQuestion {
  /** The full question text — ALSO the key the answer is returned under in the `answers` map. */
  question: string;
  /** Short chip/tag label (≤12 chars) — a compact header shown above the question. */
  header: string;
  /** True → the user may pick SEVERAL options (their labels are comma-joined into one answer). */
  multiSelect: boolean;
  options: ChatQuestionOption[];
}

/**
 * Pure: normalize a `permission_ask_user_question` dialog payload's `questions` into the ChatQuestion[]
 * the client renders. The payload crossed a subprocess/JSON boundary, so this is tolerant — it drops
 * questions with no text or no valid options and coerces missing fields to sane defaults. Returns null
 * when there's no usable question at all (the caller then answers the dialog as cancelled).
 */
export function extractAskUserQuestions(payload: unknown): ChatQuestion[] | null {
  const raw = (payload as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(raw)) return null;
  const out: ChatQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const o = q as Record<string, unknown>;
    const question = typeof o.question === "string" ? o.question.trim() : "";
    if (!question) continue;
    const optsRaw = Array.isArray(o.options) ? o.options : [];
    const options: ChatQuestionOption[] = [];
    for (const opt of optsRaw) {
      if (!opt || typeof opt !== "object") continue;
      const oo = opt as Record<string, unknown>;
      const label = typeof oo.label === "string" ? oo.label : "";
      if (!label) continue;
      options.push({ label, description: typeof oo.description === "string" ? oo.description : "" });
    }
    if (!options.length) continue;
    out.push({
      question,
      header: typeof o.header === "string" ? o.header : "",
      multiSelect: o.multiSelect === true,
      options,
    });
  }
  return out.length ? out : null;
}

/** The canUseTool result that answers (or skips) an AskUserQuestion tool call — always an `allow`
 *  (denying would surface a tool error): the answers ride in `updatedInput`. */
export interface AskUserQuestionAnswer {
  behavior: "allow";
  updatedInput: Record<string, unknown>;
}

/**
 * Pure: build the canUseTool PermissionResult that answers an AskUserQuestion tool call. The tool's
 * updated input is its ORIGINAL input with an `answers` map merged in — `{ [questionText]:
 * answerString }`, multi-select answers comma-joined by the client — which the tool reads to build
 * its output. A null `answers` (the user SKIPPED) allows the tool through UNCHANGED, so it produces
 * its own "no answer selected" result and the turn continues gracefully (rather than a hard deny that
 * would read as a tool error). Verified against CLI 2.1.x: `{ behavior: "allow", updatedInput: {
 * ...input, answers } }` — the assistant received the answer and continued.
 */
export function buildAskUserQuestionAnswer(
  toolInput: Record<string, unknown>,
  answers: Record<string, string> | null,
): AskUserQuestionAnswer {
  if (!answers) return { behavior: "allow", updatedInput: toolInput };
  return { behavior: "allow", updatedInput: { ...toolInput, answers } };
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

/** A parked AskUserQuestion tool call: `resolve` settles the canUseTool promise once the client
 *  answers/skips (or the turn tears down); `toolInput` is the tool's original input, spread into the
 *  answer's `updatedInput` so the tool sees `{ ...input, answers }`. */
interface PendingDialog {
  resolve: (result: SdkPermissionResult) => void;
  toolInput: Record<string, unknown>;
}

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
  /** In-flight AskUserQuestion tool calls keyed by toolUseID — resolved by respondQuestion(). Kept
   *  separate from `pending` (ordinary allow/deny permissions): these are parked canUseTool promises
   *  whose resolution carries the user's ANSWER in `updatedInput`, not an allow/deny decision. */
  pendingDialogs: Map<string, PendingDialog>;
  /** Tool names the user chose to always allow this session (canUseTool short-circuits these). */
  alwaysAllow: Set<string>;
  /** The latest Claude Code session id seen on the wire (for diagnostics + a visibility respawn's
   *  `resume`, so refreshing the deny list mid-conversation keeps the history). */
  sessionId: string | null;
  /** The resolved `claude` binary — kept so a visibility respawn can rebuild query() without
   *  re-resolving it. */
  bin: string;
  /** The reasoning-effort level the user chose in the header (FEATURE #63), applied LIVE via
   *  Query.applyFlagSettings. Also stashed here so a visibility respawn (spawnChatQuery rebuilds
   *  query() from scratch) re-applies it through the spawn `effort` option — otherwise the respawn
   *  would silently reset effort to the model default. Undefined until the user picks one. */
  effort?: string;
  /** The model the user selected (Bug #89). Stored here so a visibility respawn (spawnChatQuery
   *  rebuilds query() from scratch) re-applies it — the SDK's query() options don't accept a base
   *  model, so setModel() is called again after the new query is created. Undefined = default. */
  model?: string;
  /** LIVE chat-visibility deny set (both path forms), read by canUseTool at call time so a
   *  mid-session visibility change takes effect without a stale captured copy. Rebuilt on respawn. */
  deniedPathSet: Set<string>;
  /** Enable Claude's --chrome (browser/computer-use) capability. Read from settings at spawn —
   *  respawns preserve the flag via this field (like effort). */
  computerUse?: boolean;
  /** Set by invalidateChatVisibility when the vault's visibility settings change: the next
   *  sendMessage tears down + respawns query() with a fresh deny list (managedSettings/sandbox are
   *  spawn-fixed and can't be updated live, so a respawn is the only way to re-gate them). */
  visibilityDirty?: boolean;
  /** From init: "none" when the user is on a Claude subscription login (no API key) — in that case
   *  the SDK's total_cost_usd is a notional API-equivalent figure the user does NOT pay, so we hide
   *  it. Any other value means real API-key billing, where the cost is meaningful. */
  apiKeySource: string;
  /** A pending grace-period teardown (set on an abnormal WS drop, cleared on reconnect). */
  closeTimer?: ReturnType<typeof setTimeout>;
  /** True while a user turn is in flight (set on push, cleared after result+done / drain end).
   *  Read by rebindSink: a reconnect that finds NO active turn pushes a synthetic `done` so a
   *  terminating frame lost to a dead socket can't wedge the client's streaming state forever. */
  turnActive: boolean;
  /** Set by detachSink on an abnormal WS drop: frames buffer here (capped) instead of being
   *  fired into a dead socket, and rebindSink flushes them to the reconnected one — the chat
   *  analogue of terminal.ts's PTY detach/attach output buffering. */
  detached: boolean;
  buffer: ChatFrame[];
  /** Once-per-session latches: the supported-models list is static per login (fetched EAGERLY on
   *  spawn, so the picker is usable before the first turn — see emitSupportedModels); the title
   *  latches only when a NON-EMPTY summary exists (a brand-new session has none on turn 1, so the
   *  drain retries at each turn-end until one appears). */
  modelsSent?: boolean;
  titleSent?: boolean;
  /** Latch for the EAGER synthetic manifest (emitInitManifest): true once ANY manifest — the
   *  spawn-time synthetic one OR a real per-turn `system/init` — has been emitted, so a slow eager
   *  control-request fetch can never clobber a real per-turn manifest that raced ahead (BUG #14). */
  manifestSent?: boolean;
  /** The vault's 3rd-brain dir when the daemon is enabled — a finished chat's conversation is
   *  captured there as an auto note (like the relay SessionEnd hook does for terminals), so
   *  the dream cron consolidates in-app chats too. Undefined = daemon off = no capture. */
  memoryDir?: string;
  /** Completed turns this session — a conversation with none isn't worth a memory note. */
  turnCount: number;
  /** The conversation summary once known (maybeEmitTitle) — the agents-graph node label. Falls back
   *  to the cwd basename in the snapshot until a summary exists. */
  title?: string;
  /** ms epoch of the last turn activity (set on spawn, bumped on each push + turn-end). Drives the
   *  chat node's awake/idle state in the agents graph, like a relay session's lastSeen. */
  lastActivityAt: number;
  /** Subagents spawned via the SDK Task tool this session, keyed by the Task tool_use id. Populated
   *  in the drain loop (tool-use → add, tool-result → mark done); done ones linger a TTL then sweep,
   *  mirroring the relay's DONE_SUBAGENT_TTL. Surfaced as depth-1 children in the agents graph. */
  chatSubagents: Map<string, { agentId: string; agentType: string; done: boolean; doneAt?: number }>;
  /** Latch so a grace-timeout close after an explicit close can't write the note twice. */
  captured?: boolean;
  /** Set by abortTurn() right before interrupt(), cleared when the NEXT `result` message is
   *  handled. The SDK reports a user-interrupted turn as an error result (is_error: true,
   *  subtype "error_during_execution") — indistinguishable on the wire from a real failure — so
   *  without this a deliberate Escape/Stop surfaces as "The turn ended with an error." in the UI.
   *  This flag lets the drain loop recognize "we asked for this" and report isError: false. */
  aborting?: boolean;
}

/** Cap on frames buffered while detached — enough for any realistic turn's tail; a runaway turn
 *  during a long outage drops the middle rather than growing unbounded (the terminal frames that
 *  matter for UI consistency — result/done/permission — are tiny and near the end). */
const MAX_BUFFERED_FRAMES = 2000;

/** Route a frame to the session's sink, or into the reconnect buffer while detached. Every frame
 *  producer (drain loop, canUseTool, teardown notices) funnels through this. */
function emit(session: ChatSession, frame: ChatFrame): void {
  if (session.detached) {
    if (session.buffer.length < MAX_BUFFERED_FRAMES) session.buffer.push(frame);
    return;
  }
  session.sink(frame);
}

const sessions = new Map<string, ChatSession>();
// createSession is async (it awaits the visibility deny-list build), so a chatId with no
// session yet needs a guard against two concurrent sendMessage/resumeSession calls both
// racing to create one (the second would silently orphan the first's process). Callers
// share the SAME in-flight promise instead of starting a second creation.
const inFlightCreates = new Map<string, Promise<ChatSession | null>>();

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
    // the client). In history we also surface the prose — and any persisted image attachments —
    // as a user-message bubble; an image-only turn (no text blocks) must not vanish from replay.
    if (!opts.live) {
      const text = userMessageText(content);
      const images: string[] = [];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type !== "image") continue;
          const src = b.source as { type?: string; media_type?: string; data?: string } | undefined;
          if (src && src.type === "base64" && typeof src.media_type === "string" && typeof src.data === "string") {
            images.push(`data:${src.media_type};base64,${src.data}`);
          }
        }
      }
      // Pure tool_result carrier messages have neither — keep skipping those (no empty bubbles).
      if (text.length || images.length) frames.push({ type: "user-message", text, ...(images.length ? { images } : {}) });
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
 * The assistant text/thinking frames that must be emitted DIRECTLY from a final `assistant` message
 * because they never arrived as `stream_event` deltas (BUG #19). A normal streamed reply produces
 * deltas first (streamedTextLen/streamedThinkingLen > 0), so the live drain loop skips its final
 * blocks to avoid double-emitting. But a locally-executed built-in slash command (/context, /help,
 * /cost, …) delivers its whole output as one assistant text block with NO deltas — so when nothing
 * streamed for a given block kind, that kind's blocks are returned here and emitted verbatim. Pure
 * (no session/side-effects) so the de-dupe rule is unit-tested independent of a live `claude`.
 */
export function unstreamedAssistantFrames(
  msg: { message?: { content?: unknown } },
  streamedTextLen: number,
  streamedThinkingLen: number,
): ChatFrame[] {
  const frames: ChatFrame[] = [];
  if (streamedTextLen > 0 && streamedThinkingLen > 0) return frames; // everything already streamed
  const content = msg.message?.content;
  if (!Array.isArray(content)) return frames;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (streamedTextLen === 0 && b.type === "text" && typeof b.text === "string" && b.text.length) {
      frames.push({ type: "assistant-text", text: b.text });
    } else if (streamedThinkingLen === 0 && b.type === "thinking" && typeof b.thinking === "string" && b.thinking.length) {
      frames.push({ type: "thinking", text: b.thinking });
    }
  }
  return frames;
}

/**
 * BUG #39: matches ONLY the bare "/mcp" command (optional surrounding whitespace, case-insensitive,
 * no arguments) — the one built-in slash command this chat intercepts locally instead of forwarding
 * to the CLI subprocess. Verified against a live session: run programmatically (this app never runs
 * the interactive TUI), the SDK's OWN "/mcp" stubs out to a synthetic assistant reply "'/mcp' isn't
 * available in this environment." — it's a TUI-only interactive picker with no headless output, so
 * forwarding the text is never useful. Every OTHER slash command (recognized or not) is left to the
 * SDK, which already answers visibly on its own: an unrecognized command comes back as a synthetic
 * "Unknown command: /x", and every other TUI-only command gets the same "isn't available" stub — so
 * this is the only stub actually worth replacing with real data (see docs/chat/overview.md).
 */
export function isMcpCommand(text: string): boolean {
  return /^\/mcp\s*$/i.test(text.trim());
}

/**
 * BUG #39: the composer's slash autocomplete is driven VERBATIM from the init manifest's
 * `slash_commands`, which the SDK deliberately limits to headless-usable commands — it OMITS
 * TUI-only ones like "/mcp". But this chat answers "/mcp" LOCALLY (isMcpCommand/answerMcpCommand),
 * so it IS a usable command here — it just never appeared in the popover. Splice the locally-handled
 * command names into the manifest's list so the autocomplete lists them. Deduped (a future SDK that
 * DOES surface "/mcp" won't double it) and order-stable (SDK commands first, synthetics appended) so
 * the popover ordering stays deterministic. Pure → unit-tested in core/test/chat.test.ts.
 */
export const LOCAL_SLASH_COMMANDS = ["mcp"] as const;
export function withLocalSlashCommands(commands: string[]): string[] {
  const out = [...commands];
  for (const c of LOCAL_SLASH_COMMANDS) if (!out.includes(c)) out.push(c);
  return out;
}

/** The minimal per-server shape formatMcpStatus needs — a projection of the SDK's McpServerStatus
 *  (name/status/tools[]) down to a tool COUNT, so the pure formatter needs no SDK types at all. */
export interface ChatMcpServerSummary {
  name: string;
  status: string;
  toolCount?: number;
}

/**
 * Pure: render the "/mcp" reply body from a snapshot of MCP server statuses — the same data
 * Query.mcpServerStatus() returns (also what powers the header's connected/total count), just
 * projected to name + status + tool count. Mirrors the Claude Code CLI's own /mcp panel (which
 * server, is it connected, how many tools) as a plain markdown list rendered like any assistant
 * reply, rather than the SDK's non-interactive stub. No servers configured is reported plainly
 * instead of an empty list.
 */
export function formatMcpStatus(servers: ChatMcpServerSummary[]): string {
  if (!servers.length) return "No MCP servers are configured for this session.";
  const lines = servers.map((s) => {
    const tools = typeof s.toolCount === "number" ? ` — ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}` : "";
    return `- **${s.name}** — ${s.status}${tools}`;
  });
  return `**MCP Servers** (${servers.length})\n\n${lines.join("\n")}`;
}

/**
 * Answer "/mcp" LOCALLY from the SDK's own control-plane (Query.mcpServerStatus(), the same call
 * emitInitManifest already makes for the header's connected/total count) instead of forwarding the
 * text into the input queue — see isMcpCommand for why. Emits the SAME frame shape a normal turn
 * produces (assistant-text, then result, then done) so the client's streaming/turn-end handling
 * (including the mid-turn queued-message dispatch, which fires on `done`) needs no special case.
 * Deliberately bypasses the real input queue/session transcript: this is introspection of already-
 * live session state, not a conversational turn, so turnCount/context-usage/title are left untouched
 * and a resumed session replay simply won't show it (like emitInitManifest's own synthetic manifest).
 */
async function answerMcpCommand(session: ChatSession): Promise<void> {
  session.turnActive = true;
  let text: string;
  try {
    const servers = await session.q.mcpServerStatus();
    text = formatMcpStatus(servers.map((s) => ({ name: s.name, status: s.status, toolCount: s.tools?.length })));
  } catch (e) {
    text = `Couldn't read MCP server status: ${(e as Error).message}`;
  }
  emit(session, { type: "assistant-text", text });
  emit(session, { type: "result", isError: false, numTurns: 0, costUsd: null });
  emit(session, { type: "done" });
  session.turnActive = false;
}

/**
 * Send a user turn. The FIRST call for a chatId creates the session: it builds the input queue and
 * starts a single long-lived query() (the user's `claude`, machine-login auth, partial messages on
 * for live streaming), then spawns a background drain loop. Every call (first and subsequent)
 * pushes `text` into the queue so the CLI runs it as the next turn. If `claude` isn't installed,
 * pushes {error, code:"no-claude"} and returns — NEVER calls any API.
 */
export async function sendMessage(chatId: string, text: string, cwd: string, sink: ChatSink, images?: ChatImage[], memoryDir?: string, computerUse?: boolean): Promise<void> {
  const existing = sessions.get(chatId);
  if (existing) {
    // Existing session: a turn arriving cancels any pending grace-teardown (we reconnected), keeps
    // the sink fresh (a reconnect installs a new socket), and queues the turn.
    if (existing.closeTimer) {
      clearTimeout(existing.closeTimer);
      existing.closeTimer = undefined;
    }
    existing.sink = sink;
    existing.detached = false;
    existing.cwd = cwd;
    existing.lastActivityAt = Date.now();
    // Visibility settings changed since this session spawned → respawn query() with a fresh deny
    // list BEFORE running the turn (managedSettings/sandbox are spawn-fixed; a stale session would
    // keep reading a since-hidden file). Resumes the same conversation, so history survives.
    if (existing.visibilityDirty) await refreshVisibility(existing);
    // BUG #39: "/mcp" is answered locally instead of forwarded — see isMcpCommand/answerMcpCommand.
    // (images.length guard mirrors ChatView's own "slash commands can't carry images" send-time rule.)
    if (isMcpCommand(text) && !images?.length) {
      await answerMcpCommand(existing);
      return;
    }
    existing.turnActive = true;
    existing.input.push(text, images);
    return;
  }

  const session = await getOrCreateSession(chatId, cwd, sink, undefined, memoryDir, computerUse);
  if (!session) return; // no-claude / spawn error already pushed to the sink

  // BUG #39: same local "/mcp" interception for a chat's very FIRST turn.
  if (isMcpCommand(text) && !images?.length) {
    await answerMcpCommand(session);
    return;
  }

  // The session's drain loop is already running (createSession starts it on spawn), so this just
  // pushes the first turn into the generator, which was parked on the empty input queue for it.
  session.turnActive = true;
  session.input.push(text, images);
}

/** createSession, de-duplicated against a concurrent in-flight call for the same chatId (see
 *  inFlightCreates) — createSession is async (awaits the visibility deny-list build), so two
 *  calls racing before the first registers its session would otherwise both spawn a `claude`
 *  process and the second registration would orphan the first. */
async function getOrCreateSession(
  chatId: string,
  cwd: string,
  sink: ChatSink,
  resume: string | undefined,
  memoryDir: string | undefined,
  computerUse?: boolean,
): Promise<ChatSession | null> {
  let creating = inFlightCreates.get(chatId);
  if (!creating) {
    creating = createSession(chatId, cwd, sink, resume, memoryDir, computerUse);
    inFlightCreates.set(chatId, creating);
  }
  try {
    return await creating;
  } finally {
    // Only the owner clears its own entry — a stale delete could drop a NEWER in-flight
    // create for the same chatId started after this one finished (unlikely, but cheap to guard).
    if (inFlightCreates.get(chatId) === creating) inFlightCreates.delete(chatId);
  }
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
export async function resumeSession(chatId: string, sessionId: string, cwd: string, sink: ChatSink, memoryDir?: string, computerUse?: boolean): Promise<void> {
  if (sessions.has(chatId)) closeChat(chatId);
  // No initial turn — query() resumes the existing session; createSession starts the drain loop on
  // spawn, which streams its init manifest + models frame straight to the header.
  await getOrCreateSession(chatId, cwd, sink, sessionId, memoryDir, computerUse);
}

/**
 * OPEN a brand-new chat's session eagerly — the session-spawn twin of resumeSession, but for a fresh
 * conversation (no `resume` id, no initial turn). Called when a chat WS connects / a ChatView mounts
 * (server's `{type:"open"}` handler), so the `init` manifest + `models` frame + permission mode
 * stream to the header the INSTANT the chat opens, BEFORE the first message (BUG #14) — createSession
 * starts the drain loop on spawn and the generator parks on the empty input queue until the first
 * sendMessage() pushes a turn.
 *
 * No-op when a session already exists for this chatId (a reconnect already rebound its sink via
 * rebindSink) so an open can't spawn a duplicate; concurrent open/first-turn calls share the same
 * inFlightCreates promise. A null return means no-claude / spawn error — already pushed to the sink.
 */
export async function openSession(chatId: string, cwd: string, sink: ChatSink, memoryDir?: string, computerUse?: boolean): Promise<void> {
  if (sessions.has(chatId)) return;
  await getOrCreateSession(chatId, cwd, sink, undefined, memoryDir, computerUse);
}

/**
 * Build + register a chat session (the user's `claude`, machine-login auth, live partial messages),
 * wiring the canUseTool permission flow and the claude_code preset. Returns the registered session,
 * or null after pushing a friendly error frame (no `claude` on PATH, or query() spawn failure).
 *
 * When `resume` is given, query() resumes that existing Claude Code session (keeps its history +
 * session_id) instead of starting fresh — the ONLY difference from a brand-new session.
 *
 * Async: it awaits buildDenyPaths(cwd, "chat") (core/src/visibility.ts) to gate every tool call
 * against the vault's visibility settings, RECOMPUTED fresh on every new session (never cached) so
 * a visibility edit takes effect on the very next chat message — see docs/vault/visibility.md.
 */
async function createSession(chatId: string, cwd: string, sink: ChatSink, resume?: string, memoryDir?: string, computerUse?: boolean): Promise<ChatSession | null> {
  const bin = whichClaude();
  if (!bin) {
    sink({ type: "error", code: "no-claude", message: "The `claude` CLI was not found. Install Claude Code to use chat." });
    return null;
  }

  // Visibility gate (core/src/visibility.ts): resolve every note's effective visibility for the
  // "chat" channel and deny the restricted subset. Per-file paths, not folder globs — an explicit
  // file-level override inside a restricted folder is honored automatically (buildDenyPaths never
  // emits a deny for it).
  const denyEntries = await buildDenyPaths(cwd, "chat");

  const input = makeInputQueue();
  const session: ChatSession = {
    id: chatId,
    cwd,
    input,
    // q is assigned by spawnChatQuery below; the canUseTool closure only runs after query()
    // returns, so the forward reference through `session` is safe.
    q: undefined as unknown as Query,
    sink,
    pending: new Map(),
    pendingDialogs: new Map(),
    alwaysAllow: new Set(),
    sessionId: null,
    bin,
    deniedPathSet: denyPathSet(denyEntries),
    computerUse,
    apiKeySource: "none",
    turnActive: false,
    detached: false,
    buffer: [],
    memoryDir,
    turnCount: 0,
    lastActivityAt: Date.now(),
    chatSubagents: new Map(),
  };

  if (!spawnChatQuery(session, denyEntries, resume)) return null; // spawn error already pushed
  sessions.set(chatId, session);
  // Populate the header model picker EAGERLY — Query.supportedModels() resolves off the SDK's
  // `initialize` control request, which the SDK fires the instant the `claude` subprocess spawns
  // (NOT gated on the first user turn), so the picker is usable + switchable the moment the chat
  // opens, before any message is sent. The drain loop's `init` handler re-tries as a fallback if
  // this eager fetch couldn't resolve. Fire-and-forget; latched by session.modelsSent.
  emitSupportedModels(session);
  // Populate the header manifest (slash commands + MCP servers) EAGERLY too — the SDK does NOT emit
  // a `system`/`init` MESSAGE for a turn-less fresh session (only the first turn produces one), so
  // without this the header stays bare on open; instead we synthesize it from the SDK's control
  // requests, which resolve off the `initialize` handshake with no user turn (BUG #14).
  emitInitManifest(session);
  // Start draining the SDK generator NOW, on spawn — NOT gated on a user turn (BUG #14). This is
  // what lets a chat OPEN (openSession) bring up a live session whose `init` manifest + `models`
  // frame + permission mode stream to the header BEFORE the first message; the generator simply
  // parks on the empty input queue until sendMessage() pushes the first turn. Started here — exactly
  // once per session creation, de-duped by inFlightCreates + the `sessions.set` above — so no
  // caller (openSession, sendMessage's first turn, resumeSession) can race two concurrent drains
  // over the same generator. (refreshVisibility respawns its own query() + drain out of band.)
  void drain(session);
  return session;
}

/**
 * Build query() for a session from a fresh deny list and assign `session.q`. Extracted so a
 * mid-conversation visibility change can respawn (see refreshVisibility) — managedSettings +
 * sandbox are fixed at spawn and cannot be updated on a running query(), so re-gating them means
 * a new query(). Returns false (after pushing a spawn error to the sink) if query() throws.
 */
function spawnChatQuery(session: ChatSession, denyEntries: DenyEntry[], resume?: string): boolean {
  // canUseTool fires ONLY for tools not already allowed by the user's settings (pre-allowed tools
  // run silently — correct Claude Code behavior). It reads session.deniedPathSet LIVE so a respawn
  // that swapped the set takes effect immediately.
  const canUseTool = (
    toolName: string,
    toolInput: Record<string, unknown>,
    opts: { toolUseID?: string },
  ): Promise<SdkPermissionResult> => {
    // Path-aware visibility auto-deny (same-process layer, belt-and-suspenders with managedSettings):
    // denies OUTRIGHT — no prompt, no "always allow" override — when the tool targets a restricted
    // file. Read/Edit/Write carry it as `file_path`; NotebookEdit as `notebook_path`; Grep/Glob as
    // `path` (but those are additionally hard-disabled below when any deny exists). Both relative
    // and absolute forms are in deniedPathSet (the model isn't consistent — see denyPathSet).
    for (const key of ["file_path", "notebook_path", "path"] as const) {
      const p = toolInput[key];
      if (typeof p === "string" && session.deniedPathSet.has(p)) {
        return Promise.resolve({ behavior: "deny", message: "This file is marked hidden from chat (visibility)." });
      }
    }
    // AskUserQuestion (Claude's interactive multiple-choice tool) reaches us HERE, through canUseTool
    // — not as a normal permission (no allow/deny), but as a question the user must ANSWER. Surface
    // it as a `question` frame (interactive option buttons) and PARK the canUseTool promise until the
    // client answers via respondQuestion(): a pending question naturally blocks the turn from ending.
    // A malformed input (no usable question) is allowed straight through so the tool emits its own
    // error rather than hanging forever on a card that can't render.
    if (toolName === ASK_USER_QUESTION_TOOL) {
      const questions = extractAskUserQuestions(toolInput);
      if (!questions) return Promise.resolve({ behavior: "allow", updatedInput: toolInput });
      const id = opts.toolUseID ?? randomUUID();
      return new Promise<SdkPermissionResult>((resolve) => {
        session.pendingDialogs.set(id, { resolve, toolInput });
        emit(session, { type: "question", id, questions });
      });
    }
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
      emit(session, { type: "permission", id, toolName, input: toolInput });
    });
  };

  // Blocks the CLI-bridge MCP tool's file-read escape hatch (bismuth_cli can target ANY vault via
  // its own --vault/--dir flags) — always. When ANY file is restricted, ALSO hard-disable Grep and
  // Glob: their per-file managedSettings deny only matches a call whose OWN `path` argument is the
  // denied file, but an UNSCOPED Grep(pattern, path: undefined) scans the whole vault (including a
  // hidden file) and returns its matching lines — the per-file deny can't stop that, so the only
  // reliable gate for a broad scan is to forbid the tools outright (an honesty boundary: no
  // vault-wide scan can reach a hidden file). Cost: a restricted vault's chat loses grep/glob.
  const disallowedTools = denyEntries.length > 0
    ? ["mcp__bismuth__bismuth_cli", "Grep", "Glob"]
    : ["mcp__bismuth__bismuth_cli"];

  let q: Query;
  try {
    q = query({
      prompt: session.input,
      options: {
        pathToClaudeCodeExecutable: session.bin,
        cwd: session.cwd,
        includePartialMessages: true,
        // resume an existing Claude Code session (keeps its history + session_id) when asked; a
        // brand-new session simply omits it.
        ...(resume ? { resume } : {}),
        // permissionMode is intentionally NOT set HERE: omitting it (like settingSources) makes the
        // SDK resolve the STARTING mode from the user's OWN Claude Code config, which is the right
        // default for headless / direct callers (CLI, tests). The in-app chat's app-level default
        // (Bypass) is applied CLIENT-SIDE instead — ChatView sends {set_permission_mode:
        // bypassPermissions} on each session's first manifest (see BUG #14) — so the app default
        // can't leak into non-UI callers and the live permission tests keep exercising the real
        // canUseTool prompt flow (bypassPermissions suppresses canUseTool entirely). Still switchable
        // live in the header.
        //
        // BUG #60 ("bypass doesn't work in chat"): `bypassPermissions` — whether set at spawn OR via
        // the runtime setPermissionMode control request — is GATED behind this capability flag. The
        // SDK only passes `--allow-dangerously-skip-permissions` to the CLI when it's true; without
        // it the CLI silently refuses to enter bypass mode, so canUseTool kept firing and every tool
        // call still prompted even after the client selected Bypass. Enabling the capability does NOT
        // change the starting mode (still resolved from config above) — it only lets the client's
        // set_permission_mode actually take effect. Visibility stays enforced under bypass: the
        // managedSettings deny + sandbox denyRead are policy-tier and survive the permission mode.
        allowDangerouslySkipPermissions: true,
        // Reasoning effort (FEATURE #63) is applied LIVE via applyFlagSettings, but a visibility
        // respawn rebuilds query() from scratch — so thread the session's chosen effort through the
        // spawn `effort` option too so the respawn preserves it (this path also covers levels the
        // runtime flag layer rejects, e.g. 'max'). Omitted until the user picks a level.
        ...(session.effort ? { effort: session.effort as EffortLevel } : {}),
        // Browser/computer-use capability (--chrome): passes `--chrome` (a boolean flag, hence
        // `null`) so the spawned claude process can launch and control a Chromium browser.
        ...(session.computerUse ? { extraArgs: { chrome: null } } : {}),
        // Use Claude Code's own preset system prompt — this is a VISUAL CLAUDE CODE, so it must
        // behave like the TUI: the preset injects the `<env>` context + loads CLAUDE.md, skills, and
        // the full tool guidance. Without it the SDK ships a bare prompt with NO cwd context, so
        // relative paths resolve against $HOME instead of `cwd`.
        systemPrompt: { type: "preset", preset: "claude_code" },
        // The SDK CanUseTool type carries many optional fields we don't read; cast our narrow
        // closure to it. (canUseTool ALSO carries the AskUserQuestion interactive-question flow — see
        // the ASK_USER_QUESTION_TOOL branch above.)
        canUseTool: canUseTool as unknown as CanUseTool,
        // Visibility gate, continued: `managedSettings` is the SDK's restrictive-only policy tier —
        // it layers UNDER the user's own config (deny outranks any pre-existing "always allow") and
        // survives this session's permission mode (Step-0 spike). `sandbox` additionally blocks a
        // Bash `cat`/`grep` at the OS level (verified on macOS). Omitted entirely when nothing is
        // restricted, so a vault with no visibility settings behaves exactly as before.
        ...(denyEntries.length > 0
          ? {
              managedSettings: { permissions: { deny: buildManagedSettingsDeny(denyEntries) } },
              sandbox: { enabled: true, failIfUnavailable: false, filesystem: { denyRead: absDenyPaths(denyEntries) } },
            }
          : {}),
        // Memory auto-recall (daemon-gated). The visual chat is an SDK session with NO relay
        // plugin, so the relay's terminal-tab UserPromptSubmit recall hook never fires here — the
        // app's PRIMARY Claude surface saw none of the 3rd brain. Mirror that hook in-process: when
        // this vault's daemon is enabled (session.memoryDir is set), on every user turn recall the
        // memory relevant to the prompt and inject it as `additionalContext`. Read session.memoryDir
        // via the closure so a refreshVisibility respawn keeps recall wired. captureToMemory already
        // strips the injected `# Memories` block (stripInjectedBlocks) before collecting, so recall
        // never amplifies through the recall→collect→recall loop. recallMemory is budgeted + never
        // throws, so a bloated/slow graph degrades to "no recall" rather than stalling the turn.
        ...(session.memoryDir
          ? {
              hooks: {
                UserPromptSubmit: [
                  {
                    hooks: [
                      async (input: HookInput) => {
                        const dir = session.memoryDir;
                        if (!dir || input.hook_event_name !== "UserPromptSubmit") return {};
                        const context = await recallMemory(dir, input.prompt);
                        return context
                          ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit" as const, additionalContext: context } }
                          : {};
                      },
                    ],
                  },
                ],
              },
            }
          : {}),
        disallowedTools,
      },
    });
  } catch (e) {
    session.sink({ type: "error", code: "spawn", message: (e as Error).message });
    return false;
  }
  session.q = q;
  // Re-apply the user's chosen model on respawn. The SDK's query() options don't accept a base
  // model (unlike effort which has a spawn option), so we call setModel() again after the new
  // query is created (Bug #89).
  if (session.model) {
    try { q.setModel(session.model)?.catch(() => {}); } catch { /* */ }
  }
  return true;
}

/**
 * Flag every live chat session so its next turn respawns query() with a freshly-built deny list.
 * Called by the server when this vault's visibility settings change (folder-visibility route, or a
 * `visibility:` frontmatter edit). One core server serves one vault, so all sessions share it.
 */
export function invalidateChatVisibility(): void {
  for (const s of sessions.values()) s.visibilityDirty = true;
}

/**
 * Rebuild a session's deny list and respawn query() with fresh managedSettings/sandbox, resuming
 * the SAME Claude Code session so the conversation history survives. Tears the old query() down
 * WITHOUT firing captureToMemory (the conversation continues — capture happens only on a real
 * close). Best-effort: on a spawn failure the old (now-closed) query is gone, so the next turn
 * will surface the error; we clear the dirty flag regardless to avoid a respawn loop.
 */
async function refreshVisibility(session: ChatSession): Promise<void> {
  session.visibilityDirty = false;
  const denyEntries = await buildDenyPaths(session.cwd, "chat");
  session.deniedPathSet = denyPathSet(denyEntries);
  // Tear down the old query() (interrupt any in-flight, then close) — NOT closeChat, which would
  // capture-to-memory and drop the session from the registry.
  try { session.q.interrupt?.()?.catch(() => {}); } catch { /* */ }
  try { session.q.close?.(); } catch { /* */ }
  // Respawn against the same conversation (resume) with the fresh gate, then re-drain.
  if (spawnChatQuery(session, denyEntries, session.sessionId ?? undefined)) void drain(session);
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

// --- Session content search (the history picker's search box) -------------------------------
//
// The Agent SDK exposes NO native session search (only listSessions + getSessionMessages), so this
// FILTERS the SDK's OWN session data rather than maintaining a parallel index: for each past
// session we read its transcript, project it to searchable text (title + each human-readable
// message), and match the query against that. On-demand, driven by the picker's search box.

/** A short excerpt from `text` centered on the first case-insensitive occurrence of `query`, with
 *  `…` markers where it's clipped and whitespace collapsed to a single line for display. Returns
 *  null when `query` doesn't occur in `text`. Pure + unit-tested. */
export function chatSnippet(text: string, query: string, radius = 60): string | null {
  if (!text || !query) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  let snip = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snip = `…${snip}`;
  if (end < text.length) snip = `${snip}…`;
  return snip;
}

/** One search hit: a past session whose title or message text matched, plus a snippet of where. */
export interface ChatSearchHit {
  sessionId: string;
  summary: string;
  lastModified: number; // ms epoch
  /** A short excerpt around the match (the title or a message) for the picker row's second line. */
  snippet: string;
  /** True when the match was in the session's title/summary rather than its message body. */
  inTitle: boolean;
}

/** The searchable projection of one session: its title + every human-readable message text. */
export interface ChatSearchDoc {
  sessionId: string;
  summary: string;
  lastModified: number;
  texts: string[];
}

/** Split a query into lowercased, non-empty whitespace tokens. */
function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Pure match test: does `doc` match `query`? EVERY query token must appear (case-insensitive)
 * somewhere in the session's title OR message text — an AND across tokens, so "auth login" finds a
 * session that mentions both even when they're not adjacent. The returned snippet is centered on the
 * FIRST token, preferring the title when it contains it, else the first message that does. Returns
 * null when the session doesn't match. Unit-tested so the search rule needs no live `claude`.
 */
export function matchChatSession(doc: ChatSearchDoc, query: string): ChatSearchHit | null {
  const tokens = queryTokens(query);
  if (!tokens.length) return null;
  // AND across tokens over the combined title + messages. A token carries no whitespace, so it can
  // never straddle the "\n" join boundary — a token that passes therefore lives within one field.
  const combined = [doc.summary, ...doc.texts].join("\n").toLowerCase();
  if (!tokens.every((t) => combined.includes(t))) return null;
  const meta = { sessionId: doc.sessionId, summary: doc.summary, lastModified: doc.lastModified };
  const first = tokens[0]!;
  const titleSnip = chatSnippet(doc.summary, first);
  if (titleSnip) return { ...meta, snippet: titleSnip, inTitle: true };
  for (const text of doc.texts) {
    const snip = chatSnippet(text, first);
    if (snip) return { ...meta, snippet: snip, inTitle: false };
  }
  // Unreachable given the AND test guarantees `first` is in the title or a message, but fall back
  // to the title rather than assert.
  return { ...meta, snippet: doc.summary, inTitle: true };
}

/** Build a session's searchable doc from its SDK transcript: the title plus each user/assistant
 *  message's plain text (tool payloads dropped by extractText; machine-injected preambles stripped
 *  by stripInjectedBlocks, so search matches what the human actually wrote/read). Tolerant — an
 *  unreadable session yields an empty text list (title-only search still works). */
async function buildSearchDoc(
  session: { sessionId: string; summary: string; lastModified: number },
  cwd: string,
): Promise<ChatSearchDoc> {
  let messages: SessionMessage[] = [];
  try {
    messages = await getSessionMessages(session.sessionId, { dir: cwd });
  } catch {
    messages = [];
  }
  const texts: string[] = [];
  for (const msg of messages) {
    if (!msg || (msg.type !== "user" && msg.type !== "assistant")) continue;
    const text = stripInjectedBlocks(extractText((msg as { message?: TranscriptEntry["message"] }).message));
    if (text) texts.push(text);
  }
  return { sessionId: session.sessionId, summary: session.summary, lastModified: session.lastModified, texts };
}

/**
 * Search the user's past Claude Code sessions (terminal + in-app, one unified store) for `cwd` by
 * CONTENT. The SDK has no native session search, so this filters the SDK's OWN session data
 * (listSessions + getSessionMessages) — never a parallel index. Each session's title + message text
 * is matched (see matchChatSession); hits come back newest-first with a snippet of where they
 * matched. Tolerant: returns [] if the store can't be read. `limit` caps how many (newest) sessions
 * are scanned so a huge history can't make one search read unbounded transcripts.
 */
export async function searchChatSessions(cwd: string, query: string, limit = 100): Promise<ChatSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  let sessionList: Awaited<ReturnType<typeof listSessions>>;
  try {
    sessionList = await listSessions({ dir: cwd, limit });
  } catch {
    return [];
  }
  const hits: ChatSearchHit[] = [];
  // Read each session's transcript on demand and filter — the SDK's own data, no index.
  await Promise.all(
    sessionList.map(async (s) => {
      const doc = await buildSearchDoc({ sessionId: s.sessionId, summary: s.summary, lastModified: s.lastModified }, cwd);
      const hit = matchChatSession(doc, q);
      if (hit) hits.push(hit);
    }),
  );
  // listSessions is newest-first but Promise.all resolves out of order — restore newest-first.
  hits.sort((a, b) => b.lastModified - a.lastModified);
  return hits;
}

/**
 * Fetch this login's supported models (Query.supportedModels) and emit them as a `models` frame for
 * the header model picker. Called EAGERLY on session spawn (createSession): supportedModels() awaits
 * the SDK's `initialize` control request, which the SDK fires the moment the CLI subprocess starts —
 * NOT gated on a user turn — so the picker is populated and switchable the instant the chat opens,
 * before the first message. The drain loop's `init` handler calls this again as a fallback in case
 * the eager fetch couldn't resolve (e.g. a slow/failed spawn). Latched by session.modelsSent so it
 * emits exactly once per session (the list is static per login); the post-resolve re-check makes the
 * eager-vs-fallback race a no-op instead of a double emit. Fire-and-forget — a failure leaves the
 * fallback to retry, never surfacing as a chat error.
 */
function emitSupportedModels(session: ChatSession): void {
  if (session.modelsSent || !session.q) return;
  session.q
    .supportedModels()
    .then((ms) => {
      if (session.modelsSent) return; // eager + fallback raced — whoever resolved first already sent
      session.modelsSent = true;
      emit(session, {
        type: "models",
        // supportedEffortLevels rides along per model (FEATURE #63) so the header's Effort picker
        // tracks the SELECTED model's real levels — the SDK reports it, we never hardcode it.
        models: ms.map((m) => ({ value: m.value, label: m.displayName, description: m.description, effortLevels: m.supportedEffortLevels ?? [] })),
      });
    })
    .catch(() => {});
}

/**
 * Synthesize + emit the header `manifest` EAGERLY on session spawn, from the SDK's control requests
 * (initializationResult → slash commands; mcpServerStatus → MCP servers). These resolve off the
 * `initialize` handshake — NOT gated on a user turn — whereas the SDK does NOT emit a `system`/`init`
 * MESSAGE for a turn-less fresh session (verified: only the FIRST turn produces one). So without this,
 * opening a chat left the header's command list + MCP count empty until the first message (BUG #14).
 *
 * Best-effort + latched by session.manifestSent so a SLOW eager fetch (mcpServerStatus can take
 * seconds while it probes connections) can never clobber a REAL per-turn manifest that already
 * landed: once the drain loop's `init` handler has emitted (setting manifestSent), this no-ops.
 *
 * The active model, tool list, and permission mode aren't exposed as control requests, so they're
 * left blank here — the model picker rides its own `models` frame (emitSupportedModels) + the client's
 * persisted last-model, tools fill in from the first real per-turn manifest, and permissionMode is
 * reported as the spawn default ("default"): the client's first-manifest handler then pushes the app
 * default (Bypass) because it differs, so Bypass takes effect ON OPEN, before the first turn.
 */
function emitInitManifest(session: ChatSession): void {
  if (session.manifestSent || !session.q) return;
  const q = session.q;
  void (async () => {
    const init = await q.initializationResult().catch(() => null);
    const mcp = await q.mcpServerStatus().catch(() => []);
    if (session.manifestSent) return; // a real per-turn manifest already landed — don't clobber it
    session.manifestSent = true;
    emit(session, {
      type: "manifest",
      manifest: {
        model: "",
        permissionMode: "default",
        slashCommands: withLocalSlashCommands((init?.commands ?? []).map((c) => c.name)),
        tools: [],
        mcpServers: (mcp ?? []).map((m) => ({ name: m.name, status: m.status })),
      },
    });
  })();
}

/** Fetch the session's conversation summary once and emit it as a `title` frame. Latches ONLY on
 *  a non-empty summary (turn 1 usually has none yet), so callers retry at each turn-end until the
 *  store has one. Fire-and-forget; failures just retry later. */
function maybeEmitTitle(session: ChatSession): void {
  if (session.titleSent || !session.sessionId) return;
  getSessionInfo(session.sessionId, { dir: session.cwd })
    .then((info) => {
      const title = info?.summary?.trim();
      if (!title || session.titleSent) return;
      session.titleSent = true;
      session.title = title; // also the agents-graph node label
      emit(session, { type: "title", title });
    })
    .catch(() => {});
}

/** The Claude Code tool that spawns a subagent — its tool_use starts one, its tool_result ends it. */
const TASK_TOOL = "Task";
/** How long a finished chat subagent lingers in the snapshot before being swept (mirrors the
 *  relay's DONE_SUBAGENT_TTL_MS) so brief subagents stay visible for a beat after they complete. */
const DONE_CHAT_SUBAGENT_TTL_MS = 60_000;

/**
 * Track the SDK Task-tool subagent lifecycle off the drain loop's frames so a visual chat's
 * subagents appear as depth-1 children in the agents graph (matching the relay session→subagent
 * shape). A `tool-use` named "Task" starts one (keyed by its tool_use id, typed from the tool's
 * `subagent_type`); the matching `tool-result` marks it done. Non-Task frames are ignored.
 */
function trackChatSubagent(session: ChatSession, frame: ChatFrame): void {
  if (frame.type === "tool-use" && frame.name === TASK_TOOL) {
    const input = (frame.input ?? {}) as { subagent_type?: unknown; description?: unknown };
    const agentType =
      (typeof input.subagent_type === "string" && input.subagent_type) ||
      (typeof input.description === "string" && input.description) ||
      "subagent";
    session.chatSubagents.set(frame.id, { agentId: frame.id, agentType, done: false });
  } else if (frame.type === "tool-result") {
    const sub = session.chatSubagents.get(frame.id);
    if (sub && !sub.done) {
      sub.done = true;
      sub.doneAt = Date.now();
    }
  }
}

/** Drop finished chat subagents past their done-TTL (called at snapshot time). */
function sweepDoneChatSubagents(session: ChatSession, now: number): void {
  for (const [id, sub] of session.chatSubagents) {
    if (sub.done && sub.doneAt !== undefined && now - sub.doneAt > DONE_CHAT_SUBAGENT_TTL_MS) {
      session.chatSubagents.delete(id);
    }
  }
}

/**
 * Snapshot the live visual-chat sessions for the agents graph (core/src/agents.ts). Each registered
 * chat is a first-class session node hanging off "you"; a chat dropped from the registry (tab closed
 * / session ended → closeChat) simply isn't here, so the agents graph prunes it with no extra work.
 * Finished subagents past their TTL are swept as this runs. Pure read over the module registry.
 */
export function chatAgentSnapshot(now: number = Date.now()): ChatAgentSession[] {
  const out: ChatAgentSession[] = [];
  for (const s of sessions.values()) {
    sweepDoneChatSubagents(s, now);
    out.push({
      chatId: s.id,
      label: s.title || basename(s.cwd) || "Chat",
      active: s.turnActive,
      lastActivityAt: s.lastActivityAt,
      subagents: [...s.chatSubagents.values()].map((sub) => ({
        agentId: sub.agentId,
        agentType: sub.agentType,
        done: sub.done,
      })),
    });
  }
  return out;
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
  // Per-message streaming accounting for the assistant-block de-dupe (BUG #19). A NORMAL reply
  // arrives as `stream_event` text/thinking deltas FOLLOWED BY a final assistant message whose
  // text/thinking blocks we skip below (already shown live). But a LOCALLY-executed built-in slash
  // command (/context, /help, /cost, …) delivers its output as a COMPLETE assistant text block with
  // NO deltas at all — so if we streamed nothing for a message, its text/thinking must be emitted
  // here or the command silently shows nothing. Reset after each assistant message so a multi-message
  // tool-loop turn accounts per message.
  let streamedTextLen = 0;
  let streamedThinkingLen = 0;
  // The last session_id we told the client about, so we emit a `session` frame only when it's first
  // learned or actually changes (a resume can hand us a new id), not on every message.
  let sentSessionId = session.sessionId;
  try {
    for await (const msg of session.q as AsyncIterable<SDKMessage>) {
      // Capture the session id wherever it appears.
      const anyMsg = msg as { session_id?: string };
      if (typeof anyMsg.session_id === "string" && anyMsg.session_id) {
        session.sessionId = anyMsg.session_id;
        // Tell the client the durable session_id the moment it's known so it can persist it keyed by
        // the chat TAB (chatSessionStore.ts) — reopening the tab then resumes THIS conversation.
        if (anyMsg.session_id !== sentSessionId) {
          sentSessionId = anyMsg.session_id;
          emit(session, { type: "session", sessionId: anyMsg.session_id });
        }
      }

      if (msg.type === "system" && msg.subtype === "init") {
        // "none" => the user is on a Claude subscription login (no API key), so the reported cost
        // is notional and we hide it. Read from Claude Code's own init — the app doesn't decide this.
        session.apiKeySource = (msg as { apiKeySource?: string }).apiKeySource ?? session.apiKeySource;
        // The REAL per-turn manifest — the self-updating source of truth. Latch manifestSent so a
        // still-pending eager emitInitManifest fetch (BUG #14) can't overwrite this fuller one.
        session.manifestSent = true;
        emit(session, {
          type: "manifest",
          manifest: {
            model: msg.model,
            permissionMode: msg.permissionMode,
            slashCommands: withLocalSlashCommands(msg.slash_commands ?? []),
            tools: msg.tools ?? [],
            mcpServers: (msg.mcp_servers ?? []).map((m) => ({ name: m.name, status: m.status })),
          },
        });
        // The models this login can run, for the header model picker. Already fetched EAGERLY on
        // session spawn (createSession → emitSupportedModels) so the picker works before the first
        // turn; this is a FALLBACK for the case where that eager fetch couldn't resolve. No-op once
        // session.modelsSent is latched, so it can't double-emit.
        emitSupportedModels(session);
        // A RESUMED session already has a summary — name the tab right away rather than only
        // after the next turn completes. No-op (and retried at turn-end) for a fresh session.
        maybeEmitTitle(session);
        continue;
      }

      if (msg.type === "system" && msg.subtype === "local_command_output") {
        // A slash command whose output is produced LOCALLY (e.g. /compact, /context, or a custom
        // command that only prints) arrives solely as this system message — it never becomes an
        // assistant turn. Surface its text as assistant prose so the command's output is visible
        // instead of the turn appearing to do nothing.
        const out = msg.content;
        if (typeof out === "string" && out.length) emit(session, { type: "assistant-text", text: out });
        continue;
      }

      if (msg.type === "stream_event") {
        // Live deltas (only present with includePartialMessages). Prefer these for streaming.
        const ev = msg.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
        if (ev?.type === "content_block_delta" && ev.delta) {
          if (ev.delta.type === "text_delta" && typeof ev.delta.text === "string" && ev.delta.text.length) {
            streamedTextLen += ev.delta.text.length;
            emit(session, { type: "assistant-text", text: ev.delta.text });
          } else if (ev.delta.type === "thinking_delta" && typeof ev.delta.thinking === "string" && ev.delta.thinking.length) {
            streamedThinkingLen += ev.delta.thinking.length;
            emit(session, { type: "thinking", text: ev.delta.thinking });
          }
        }
        continue;
      }

      if (msg.type === "assistant" || msg.type === "user") {
        // BUG #19: a locally-executed built-in slash command (/context, /help, …) delivers its
        // output as a complete assistant text block with NO preceding deltas. The live=true de-dupe
        // below assumes text/thinking already streamed and emits ONLY tool_use, so that output would
        // be silently dropped. When nothing streamed for THIS assistant message, emit its text /
        // thinking blocks here so the command's result is actually shown.
        if (msg.type === "assistant") {
          for (const frame of unstreamedAssistantFrames(msg, streamedTextLen, streamedThinkingLen)) {
            emit(session, frame);
          }
          // Reset the per-message delta accounting for the next assistant message in this turn.
          streamedTextLen = 0;
          streamedThinkingLen = 0;
        }
        // assistant → tool_use frames (text/thinking handled above); user → tool_result frames (the
        // user's own prompt came from the client). Shared with history replay via translateSdkMessage.
        for (const frame of translateSdkMessage(msg, { live: true })) {
          trackChatSubagent(session, frame); // Task tool_use/result → agents-graph subagent lifecycle
          emit(session, frame);
        }
        continue;
      }

      if (msg.type === "result") {
        // A result following our OWN interrupt() is a deliberate Stop, not a failure — report it
        // as such regardless of what the SDK's is_error says (see ChatSession.aborting).
        const wasAborting = session.aborting === true;
        session.aborting = false;
        emit(session, {
          type: "result",
          isError: wasAborting ? false : msg.is_error === true,
          numTurns: typeof msg.num_turns === "number" ? msg.num_turns : 0,
          // Hide cost on a subscription login (notional, not billed); only show it for real
          // API-key billing. Driven by Claude Code's own apiKeySource, not an app decision.
          costUsd:
            session.apiKeySource === "none" || typeof msg.total_cost_usd !== "number"
              ? null
              : msg.total_cost_usd,
        });
        emit(session, { type: "done" });
        session.turnCount++;
        session.lastActivityAt = Date.now(); // keep the agents-graph node awake through this turn
        // The turn is fully over — a reconnect from here until the next push finds no active
        // turn and gets a synthetic `done` from rebindSink (see ChatSession.turnActive).
        session.turnActive = false;
        // Turn-end refreshes: the tab title (retries until a summary exists) and the
        // context-window usage pill. Both fire-and-forget; a failed fetch just waits a turn.
        maybeEmitTitle(session);
        session.q
          .getContextUsage()
          .then((u) => {
            emit(session, { type: "context", percentage: u.percentage, totalTokens: u.totalTokens, maxTokens: u.maxTokens });
          })
          .catch(() => {});
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
      captureToMemory(session); // the conversation ended (child exit/throw) — same capture as closeChat
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
      cancelPendingDialogs(session); // settle any parked AskUserQuestion dialog so it can't dangle
      try {
        session.input.close();
      } catch {
        /* */
      }
      emit(session, 
        drainError
          ? { type: "error", code: "error", message: drainError }
          : { type: "error", code: "exit", message: "The Claude Code session ended — send another message to start a new one." },
      );
    }
  }
}

/**
 * Answer a pending AskUserQuestion "question" frame. `answers` maps each question's TEXT to the
 * user's chosen answer string (the client comma-joins a multi-select, and free-text "Other" rides in
 * as its own answer). A null `answers` = the user closed/skipped the question → the dialog is
 * cancelled and the CLI applies the tool's default. No-op if the id is unknown (already answered /
 * stale / turn torn down).
 */
export function respondQuestion(chatId: string, id: string, answers: Record<string, string> | null): void {
  const s = sessions.get(chatId);
  if (!s) return;
  const pending = s.pendingDialogs.get(id);
  if (!pending) return;
  s.pendingDialogs.delete(id);
  pending.resolve(buildAskUserQuestionAnswer(pending.toolInput, answers));
}

/** Cancel every parked AskUserQuestion tool call (deny them so no canUseTool promise dangles) —
 *  shared by teardown (drain end / closeChat) and a deliberate Stop (abortTurn), mirroring how pending
 *  permissions are auto-denied. The turn is ending here, so a deny is right (unlike a user SKIP, which
 *  allows the tool through to produce its own "no answer" result). */
function cancelPendingDialogs(s: ChatSession): void {
  for (const [id, pending] of Array.from(s.pendingDialogs.entries())) {
    s.pendingDialogs.delete(id);
    try {
      pending.resolve({ behavior: "deny", message: "The question was dismissed." });
    } catch {
      /* */
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

/** Switch the model live. Wired end-to-end: the header's model picker (populated by the `models`
 *  frame from Query.supportedModels) sends `set_model` → this. */
export function setModel(chatId: string, model: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  s.model = model;
  try {
    s.q.setModel(model)?.catch(() => {});
  } catch {
    /* session not ready / already closed */
  }
}

/** Switch the reasoning-effort level live (FEATURE #63 — "can't select effort in chat"). Mirrors
 *  setModel: the header's Effort picker (options come from the selected model's supportedEffortLevels
 *  in the `models` frame) sends `set_effort` → this. There's no dedicated effort control request, so
 *  it rides Query.applyFlagSettings (the SDK's runtime flag-settings layer — `effortLevel` sits above
 *  user/project config, below managed policy). Also stored on the session so a mid-conversation
 *  visibility respawn re-applies it via spawnChatQuery's `effort` option. */
export function setEffort(chatId: string, effort: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  s.effort = effort;
  try {
    // Cast past Settings.effortLevel's narrower type ('low'|'medium'|'high'|'xhigh') — the model may
    // advertise 'max'; the flag layer validates server-side and no-ops an unsupported level, and the
    // stored session.effort still re-applies it through the spawn `effort` option on the next respawn.
    s.q.applyFlagSettings({ effortLevel: effort } as Parameters<Query["applyFlagSettings"]>[0])?.catch(() => {});
  } catch {
    /* session not ready / already closed */
  }
}

/** Interrupt the in-flight turn, leaving the session resumable for the next sendMessage. */
export function abortTurn(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  // Release any parked permission FIRST (mirrors closeChat): interrupt() alone leaves
  // session.pending populated, so the parked canUseTool promise would keep the turn blocked,
  // a stale still-clickable card could later resolve a moot promise, and "always allow" could
  // even get poisoned by a tool the user never really approved on an aborted turn.
  for (const resolve of s.pending.values()) {
    try {
      resolve({ behavior: "deny" });
    } catch {
      /* */
    }
  }
  s.pending.clear();
  // Any parked AskUserQuestion tool call is moot once we interrupt — cancel it so its canUseTool
  // promise resolves (same belt-and-suspenders as the pending-permission deny above).
  cancelPendingDialogs(s);
  // Mark this turn as a deliberate Stop BEFORE interrupting — the drain loop's `result` handler
  // reads this to keep the SDK's error-shaped interrupt result from surfacing as a chat error.
  s.aborting = true;
  try {
    s.q.interrupt()?.catch(() => {});
  } catch {
    /* nothing in flight / already closed */
  }
}

/** Pull file paths referenced in a message's `<editor-context>` preamble (Active file / Open
 *  tabs / selection source — see app/src/chatEditorContext.ts, the exact format this mirrors) so
 *  captureToMemory can check whether any of them the daemon isn't allowed to see was part of the
 *  conversation. Best-effort text scan of that one fixed format, not a general parser. */
export function extractEditorContextPaths(text: string): string[] {
  const block = text.match(/<editor-context>([\s\S]*?)<\/editor-context>/)?.[1];
  if (!block) return [];
  const out: string[] = [];
  const active = block.match(/^Active file: (.+)$/m);
  if (active) out.push(active[1]!.trim());
  const tabs = block.match(/^Open tabs: (.+)$/m);
  if (tabs) out.push(...tabs[1]!.split(",").map((s) => s.trim()).filter(Boolean));
  const refs = block.match(/^Referenced files: (.+)$/m);
  if (refs) out.push(...refs[1]!.split(",").map((s) => s.trim()).filter(Boolean));
  const sel = block.match(/^Current selection \(from (.+)\):$/m);
  if (sel) out.push(sel[1]!.trim());
  return out;
}

/**
 * Capture a finished chat's conversation into the vault's 3rd brain as an auto note — the
 * in-app twin of the relay SessionEnd hook, sharing the same pure transcript pipeline
 * (@bismuth/memory), so the dream cron consolidates visual chats too. Fire-and-forget,
 * latched by `captured`, gated on the daemon being enabled (memoryDir set) and the session
 * having done real work (>=1 completed turn). Never blocks or fails teardown.
 *
 * Visibility gate: skips the WHOLE capture if any file referenced in the session's own
 * <editor-context> preambles is restricted from the daemon (isVisibleToDaemon false — i.e.
 * "chat-only" OR "hidden"). Hidden files never reach this preamble in the first place
 * (ChatView.tsx's buildEditorContext already drops them), but a "chat-only" file is legitimately
 * visible to chat and would otherwise land in a memory note the daemon later recalls — this is
 * the load-bearing enforcement point for that tier, not a fast-follow. Coarse (whole-session, not
 * per-turn) by design: simpler and fails toward NOT capturing rather than partially leaking.
 */
function captureToMemory(s: ChatSession): void {
  if (!s.memoryDir || !s.sessionId || s.turnCount < 1 || s.captured) return;
  s.captured = true;
  const sessionId = s.sessionId;
  const { cwd, memoryDir } = s;
  void (async () => {
    try {
      const messages = await getSessionMessages(sessionId, { dir: cwd });
      const entries = messages as TranscriptEntry[];
      // denyPathSet carries BOTH the vault-relative form (matches editor-context paths + a
      // relative tool file_path) AND the canonical-absolute form (matches the SDK's own absolute
      // path reporting), so a check against either form is safe.
      const restricted = denyPathSet(await buildDenyPaths(cwd, "daemon"));
      const touchedRestricted = entries.some((e) => {
        // (1) Any daemon-restricted file NAMED in the fixed <editor-context> preamble.
        const text = extractText(e.message);
        if (text && extractEditorContextPaths(text).some((p) => restricted.has(p))) return true;
        // (2) Any daemon-restricted file the model actually OPENED via a tool call — a chat-only
        // file discussed by name (not in a tab) is legitimately readable by chat, but its content
        // must never land in a daemon-recalled memory note. Scan assistant tool_use blocks for
        // the file-path-shaped inputs, plus Bash command strings that mention a restricted path
        // (a chat-only file has no chat-side sandbox deny, so a `cat` of it is possible). Cast
        // past TranscriptEntry's narrow message type to reach the raw content blocks.
        const content = (e.message as { content?: unknown } | undefined)?.content;
        if (!Array.isArray(content)) return false;
        return content.some((block) => {
          if (!block || typeof block !== "object") return false;
          const b = block as Record<string, unknown>;
          if (b.type !== "tool_use") return false;
          const input = (b.input ?? {}) as Record<string, unknown>;
          for (const key of ["file_path", "notebook_path", "path"]) {
            const v = input[key];
            if (typeof v === "string" && restricted.has(v)) return true;
          }
          const cmd = input.command; // Bash: best-effort substring match on the restricted paths
          if (typeof cmd === "string") {
            for (const p of restricted) if (p && cmd.includes(p)) return true;
          }
          return false;
        });
      });
      if (touchedRestricted) return; // a chat-only/hidden file was discussed or opened — never capture
      const body = buildAutoNoteBody(entries);
      if (body === null) return; // trivial
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      await writeMemoryNote(`auto-${ts}-${sessionId.slice(0, 8)}`, { type: "auto", tags: ["auto", "raw", "chat"], created: date, updated: date }, body, memoryDir);
    } catch {
      /* best-effort — memory capture must never surface as a chat error */
    }
  })();
}

/** Tear a session down entirely: interrupt + close the generator, reject pending prompts, drop it. */
export function closeChat(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  captureToMemory(s);
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
  cancelPendingDialogs(s); // and settle any parked AskUserQuestion dialog
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
  // Replay everything emitted while the socket was down (detachSink buffered it) — the chat
  // analogue of terminal.ts's attachSink flush — so mid-turn deltas, tool results, and
  // permission prompts lost to the gap reach the reconnected client in order.
  if (s.buffer.length) {
    const buffered = s.buffer;
    s.buffer = [];
    for (const f of buffered) {
      try {
        sink(f);
      } catch {
        break; // the new socket died mid-flush — the next rebind gets whatever's next
      }
    }
  }
  s.detached = false;
  // Reconcile turn state: if NO turn is in flight, the terminating result/done may have been
  // fired into the dying socket BEFORE the close was even detected (nothing buffers that
  // window), which would wedge the client's streaming spinner forever. A synthetic `done` is
  // idempotent client-side, so push one whenever the session is between turns.
  if (!s.turnActive) {
    try {
      sink({ type: "done" });
    } catch {
      /* */
    }
  }
  return true;
}

/** Mark a session's sink detached after an abnormal WS drop: frames buffer for the reconnect
 *  (rebindSink flushes them) instead of being fired into the dead socket and lost. Paired with
 *  scheduleClose by the server's close handler. */
export function detachSink(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  s.detached = true;
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
