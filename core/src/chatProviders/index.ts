// core/src/chatProviders/index.ts
// The chat PROVIDER router: one seam that lets each chat session run on Claude Code
// (core/src/chat.ts — the Agent-SDK driver) OR opencode (./opencode.ts — the per-turn
// `opencode run --format json` driver), both speaking the same ChatFrame wire protocol.
//
// Routing rule: a chatId that already has a live session anywhere routes to THAT backend
// (conversation continuity beats a stale provider field); otherwise the creation verbs
// (open/send/resume) honor the requested provider. Claude-only verbs (permissions, questions,
// permission mode, effort) go straight to chat.ts — they no-op for a chatId it doesn't own,
// which is exactly the graceful degradation an opencode session needs.
import * as claude from "../chat";
import * as opencode from "./opencode";
import type { ChatFrame, ChatImage, ChatSink } from "../chat";

export type ChatProviderId = "claude" | "opencode";
export const CHAT_PROVIDERS: readonly ChatProviderId[] = ["claude", "opencode"] as const;
export const DEFAULT_CHAT_PROVIDER: ChatProviderId = "claude";

/**
 * Pure: resolve which provider a chat should run on. `requested` is what the client sent on the
 * wire (open/user/resume frames); `fallback` is the vault's `chat.provider` setting. Anything
 * unrecognized (absent, a typo, a future provider this build doesn't know) degrades to the next
 * tier, bottoming out at Claude — never throws, never spawns the wrong binary on garbage input.
 */
export function resolveChatProvider(requested: unknown, fallback?: unknown): ChatProviderId {
  if (requested === "claude" || requested === "opencode") return requested;
  if (fallback === "claude" || fallback === "opencode") return fallback;
  return DEFAULT_CHAT_PROVIDER;
}

/** Which backend currently owns this chatId, if any. */
function owner(chatId: string): ChatProviderId | null {
  if (opencode.hasSession(chatId)) return "opencode";
  if (claude.hasSession(chatId)) return "claude";
  return null;
}

export function openSession(
  chatId: string,
  cwd: string,
  sink: ChatSink,
  memoryDir: string | undefined,
  computerUse: boolean,
  provider: ChatProviderId,
): void {
  const target = owner(chatId) ?? provider;
  if (target === "opencode") opencode.openSession(chatId, cwd, sink);
  else void claude.openSession(chatId, cwd, sink, memoryDir, computerUse);
}

export function sendMessage(
  chatId: string,
  text: string,
  cwd: string,
  sink: ChatSink,
  images: ChatImage[] | undefined,
  memoryDir: string | undefined,
  computerUse: boolean,
  provider: ChatProviderId,
): void {
  const target = owner(chatId) ?? provider;
  if (target === "opencode") opencode.sendMessage(chatId, text, cwd, sink, images);
  else void claude.sendMessage(chatId, text, cwd, sink, images, memoryDir, computerUse);
}

export function resumeSession(
  chatId: string,
  sessionId: string,
  cwd: string,
  sink: ChatSink,
  memoryDir: string | undefined,
  computerUse: boolean,
  provider: ChatProviderId,
): void {
  // A resume is a deliberate re-bind — the REQUESTED provider wins (the session id belongs to that
  // provider's store); each backend tears down any existing session for the chatId itself.
  if (provider === "opencode") {
    if (claude.hasSession(chatId)) claude.closeChat(chatId);
    opencode.resumeSession(chatId, sessionId, cwd, sink);
  } else {
    if (opencode.hasSession(chatId)) opencode.closeChat(chatId);
    void claude.resumeSession(chatId, sessionId, cwd, sink, memoryDir, computerUse);
  }
}

/** Replay a past session as ChatFrames — dispatched by the id's PROVIDER (the two stores are
 *  disjoint; an opencode id is `ses_…` but the caller tells us explicitly). */
export async function sessionHistoryFrames(sessionId: string, cwd: string, provider: ChatProviderId): Promise<ChatFrame[]> {
  return provider === "opencode"
    ? opencode.sessionHistoryFrames(sessionId, cwd)
    : claude.sessionHistoryFrames(sessionId, cwd);
}

export function abortTurn(chatId: string): void {
  if (owner(chatId) === "opencode") opencode.abortTurn(chatId);
  else claude.abortTurn(chatId);
}

export function setModel(chatId: string, model: string): void {
  if (owner(chatId) === "opencode") opencode.setModel(chatId, model);
  else claude.setModel(chatId, model);
}

// Claude-only verbs: chat.ts no-ops on a chatId it doesn't own, so routing straight through is
// already the graceful degradation for opencode sessions (which never raise these frames).
export const respondPermission = claude.respondPermission;
export const respondQuestion = claude.respondQuestion;
export const setPermissionMode = claude.setPermissionMode;
export const setEffort = claude.setEffort;

export function closeChat(chatId: string): void {
  if (opencode.hasSession(chatId)) opencode.closeChat(chatId);
  if (claude.hasSession(chatId)) claude.closeChat(chatId);
}

export function scheduleClose(chatId: string, ms: number): void {
  if (opencode.hasSession(chatId)) opencode.scheduleClose(chatId, ms);
  else claude.scheduleClose(chatId, ms);
}

export function rebindSink(chatId: string, sink: ChatSink): boolean {
  if (opencode.hasSession(chatId)) return opencode.rebindSink(chatId, sink);
  return claude.rebindSink(chatId, sink);
}

export function detachSink(chatId: string): void {
  if (opencode.hasSession(chatId)) opencode.detachSink(chatId);
  else claude.detachSink(chatId);
}

export { newChatId } from "../chat";
