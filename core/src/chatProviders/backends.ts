// core/src/chatProviders/backends.ts
// The chat-backend REGISTRY: one uniform `ChatBackend` per driver, so ./index.ts can route by
// lookup instead of the hand-written two-arm if/else chain it used to be (which repeated
// `if (target === "opencode") … else …` in eleven verbs and could not absorb a third backend).
//
// The two drivers keep their own module-level signatures untouched — chat.ts still takes
// (chatId, text, cwd, sink, images, memoryDir, computerUse) and opencode.ts still takes the
// subset it understands. The adapters below are the only place that difference is expressed: each
// receives the SAME context object and picks what it needs. That keeps this refactor provably
// behaviour-preserving (no edits inside either driver) while giving every future backend one
// interface to implement.
import * as claude from "../chat";
import * as opencode from "./opencode";
import {
  ACP_BACKEND_LIST,
  claudeCodeAcpBackend,
  clineBackend,
  codexAcpBackend,
  geminiBackend,
  gooseBackend,
  openclawBackend,
} from "./acp/driver";
import type { ChatFrame, ChatImage, ChatSink } from "../chat";
import type { BackendId } from "../agentBackends/catalog";

/** Everything a backend might need to open/continue a chat. A driver ignores what it can't use —
 *  e.g. opencode has no memory injection or computer-use, so it reads neither field. */
export interface ChatTurnContext {
  chatId: string;
  cwd: string;
  sink: ChatSink;
  /** This vault's `.daemon/memory` when the daemon is enabled; gates memory injection. */
  memoryDir?: string;
  /** The `--chrome` browser/computer-use toggle. */
  computerUse: boolean;
  /** The user's text for a turn (sendMessage only). */
  text?: string;
  /** Image attachments for a turn (sendMessage only). */
  images?: ChatImage[];
  /** The backend's own durable session id (resumeSession only). */
  sessionId?: string;
}

/**
 * One chat backend. Every verb the /chat WebSocket can dispatch, in the shape ./index.ts routes.
 *
 * Required members are the ones every backend must implement to host a conversation at all.
 * Optional members are INTERACTIVE surfaces a non-interactive CLI genuinely cannot have — a
 * backend that omits them advertises the matching `false` capability in the catalog, so the
 * frontend hides the control rather than sending a verb into a void.
 */
export interface ChatBackend {
  id: BackendId;
  /** Does this backend currently own a live session for this chat id? */
  hasSession(chatId: string): boolean;
  /** Spawn eagerly, before the first turn, so header frames (manifest/models) land early. */
  openSession(ctx: ChatTurnContext): void;
  /** Run one turn. Creates the session on first use. */
  sendMessage(ctx: ChatTurnContext & { text: string }): void;
  /** Bind this chat to an existing session id so the next turn continues it. */
  resumeSession(ctx: ChatTurnContext & { sessionId: string }): void;
  /** Replay a past session's transcript as frames. Tolerant: any failure yields []. */
  sessionHistoryFrames(sessionId: string, cwd: string): Promise<ChatFrame[]>;
  /** Interrupt the in-flight turn. */
  abortTurn(chatId: string): void;
  /** Switch the model for future turns. */
  setModel(chatId: string, model: string): void;
  closeChat(chatId: string): void;
  scheduleClose(chatId: string, ms: number): void;
  rebindSink(chatId: string, sink: ChatSink): boolean;
  detachSink(chatId: string): void;

  // --- optional: interactive surfaces a non-interactive CLI cannot offer -------------------
  /** Answer a `permission` frame. Present iff capabilities.permissionModes. */
  respondPermission?(chatId: string, id: string, behavior: "allow" | "deny", always?: boolean): void;
  /** Answer a `question` frame (AskUserQuestion). Present iff capabilities.permissionModes. */
  respondQuestion?(chatId: string, id: string, answers: Record<string, string> | null): void;
  /** Switch permission mode live. Present iff capabilities.permissionModes. */
  setPermissionMode?(chatId: string, mode: string): void;
  /** Switch reasoning effort live. Present iff capabilities.effort. */
  setEffort?(chatId: string, effort: string): void;
}

/** Claude Code — core/src/chat.ts (one long-lived Agent-SDK `query()` per chat). */
const claudeBackend: ChatBackend = {
  id: "claude",
  hasSession: claude.hasSession,
  openSession: (c) => void claude.openSession(c.chatId, c.cwd, c.sink, c.memoryDir, c.computerUse),
  sendMessage: (c) => void claude.sendMessage(c.chatId, c.text, c.cwd, c.sink, c.images, c.memoryDir, c.computerUse),
  resumeSession: (c) => void claude.resumeSession(c.chatId, c.sessionId, c.cwd, c.sink, c.memoryDir, c.computerUse),
  sessionHistoryFrames: claude.sessionHistoryFrames,
  abortTurn: claude.abortTurn,
  setModel: claude.setModel,
  closeChat: claude.closeChat,
  scheduleClose: claude.scheduleClose,
  rebindSink: claude.rebindSink,
  detachSink: claude.detachSink,
  respondPermission: claude.respondPermission,
  respondQuestion: claude.respondQuestion,
  setPermissionMode: claude.setPermissionMode,
  setEffort: claude.setEffort,
};

/** opencode — core/src/chatProviders/opencode.ts (one `opencode run --format json` per turn). */
const opencodeBackend: ChatBackend = {
  id: "opencode",
  hasSession: opencode.hasSession,
  openSession: (c) => opencode.openSession(c.chatId, c.cwd, c.sink),
  sendMessage: (c) => opencode.sendMessage(c.chatId, c.text, c.cwd, c.sink, c.images),
  resumeSession: (c) => opencode.resumeSession(c.chatId, c.sessionId, c.cwd, c.sink),
  sessionHistoryFrames: opencode.sessionHistoryFrames,
  abortTurn: opencode.abortTurn,
  setModel: opencode.setModel,
  closeChat: opencode.closeChat,
  scheduleClose: opencode.scheduleClose,
  rebindSink: opencode.rebindSink,
  detachSink: opencode.detachSink,
  // No permission/question/effort verbs: `opencode run` is non-interactive (`--auto`), which is
  // exactly what capabilities.permissionModes / .effort = false advertise to the frontend.
};

/**
 * Every chat backend, keyed by id.
 *
 * ORDER MATTERS for ownership resolution (see ./index.ts `owner()`): the old code asked opencode
 * first and Claude second, and that order is preserved so a chat id somehow live in both registries
 * resolves the same way it always did. The six ACP backends (chatProviders/acp/driver.ts) are new
 * ids nothing pre-dates, so where they land in the resolution order can't disturb that history —
 * appended after opencode/claude.
 */
export const CHAT_BACKENDS: Record<BackendId, ChatBackend> = {
  opencode: opencodeBackend,
  claude: claudeBackend,
  cline: clineBackend,
  gemini: geminiBackend,
  goose: gooseBackend,
  openclaw: openclawBackend,
  "claude-code-acp": claudeCodeAcpBackend,
  "codex-acp": codexAcpBackend,
};

/** In ownership-resolution order (opencode first, then claude, then every ACP backend) — see
 *  CHAT_BACKENDS. */
export const CHAT_BACKEND_LIST: readonly ChatBackend[] = [opencodeBackend, claudeBackend, ...ACP_BACKEND_LIST];
