// core/src/chatProviders/index.ts
// The chat PROVIDER router: one seam that lets each chat session run on any backend in the
// registry (./backends.ts) — Claude Code (core/src/chat.ts, the Agent-SDK driver), opencode
// (./opencode.ts, the per-turn `opencode run --format json` driver), and whatever is added next —
// all speaking the same ChatFrame wire protocol so ChatView renders any of them unchanged.
//
// Routing rule: a chatId that already has a live session anywhere routes to THAT backend
// (conversation continuity beats a stale provider field); otherwise the creation verbs
// (open/send/resume) honor the requested provider.
//
// Interactive verbs (permissions, questions, permission mode, effort) dispatch to the owning
// backend and are simply DROPPED when that backend doesn't implement them — the graceful
// degradation a non-interactive CLI needs, now declared as data (`capabilities.permissionModes` /
// `.effort` in agentBackends/catalog.ts) instead of implied by a `provider === "claude"` check.
//
// Public signatures are unchanged from the two-backend era, so core/src/server.ts needs no edits.
import type { ChatFrame, ChatImage, ChatSink } from "../chat";
import { CHAT_BACKENDS, CHAT_BACKEND_LIST, type ChatBackend } from "./backends";
import { BACKEND_IDS, DEFAULT_BACKEND, resolveBackendId, type BackendId } from "../agentBackends/catalog";

/** Kept as an alias so existing imports (server.ts, tests, docs) keep working — the ids now come
 *  from the backend catalog, which is also what the `chat.provider` settings enum derives from. */
export type ChatProviderId = BackendId;
export const CHAT_PROVIDERS: readonly ChatProviderId[] = BACKEND_IDS;
export const DEFAULT_CHAT_PROVIDER: ChatProviderId = DEFAULT_BACKEND;

/**
 * Pure: resolve which provider a chat should run on. `requested` is what the client sent on the
 * wire (open/user/resume frames); `fallback` is the vault's `chat.provider` setting. Anything
 * unrecognized (absent, a typo, a future provider this build doesn't know) degrades to the next
 * tier, bottoming out at Claude — never throws, never spawns the wrong binary on garbage input.
 */
export const resolveChatProvider = resolveBackendId;

/** The backend holding a live session for this chat id, or null. Iterates CHAT_BACKEND_LIST, whose
 *  order preserves the original opencode-then-claude ownership resolution. */
function owningBackend(chatId: string): ChatBackend | null {
  for (const b of CHAT_BACKEND_LIST) if (b.hasSession(chatId)) return b;
  return null;
}

/** Which backend currently owns this chatId, if any. */
function owner(chatId: string): ChatProviderId | null {
  return owningBackend(chatId)?.id ?? null;
}

/** The backend a chat should run on: whoever already owns a live session for it, else the
 *  requested/default one. One lookup, replacing the per-verb if/else chain. */
function target(chatId: string, provider: ChatProviderId): ChatBackend {
  return owningBackend(chatId) ?? CHAT_BACKENDS[resolveChatProvider(provider)];
}

/** The backend for a chatId with no live session — where an unowned verb lands. Matches the old
 *  behaviour, where an unowned id fell through to Claude's own no-op-on-unknown-id handling. */
function fallbackBackend(chatId: string): ChatBackend {
  return owningBackend(chatId) ?? CHAT_BACKENDS[DEFAULT_CHAT_PROVIDER];
}

export function openSession(
  chatId: string,
  cwd: string,
  sink: ChatSink,
  memoryDir: string | undefined,
  computerUse: boolean,
  provider: ChatProviderId,
): void {
  target(chatId, provider).openSession({ chatId, cwd, sink, memoryDir, computerUse });
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
  target(chatId, provider).sendMessage({ chatId, text, cwd, sink, images, memoryDir, computerUse });
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
  // provider's store). Tear down any OTHER backend's session for this chat id first; the chosen
  // backend tears down its own (each driver's resumeSession is idempotent).
  const chosen = CHAT_BACKENDS[resolveChatProvider(provider)];
  for (const b of CHAT_BACKEND_LIST) if (b !== chosen && b.hasSession(chatId)) b.closeChat(chatId);
  chosen.resumeSession({ chatId, sessionId, cwd, sink, memoryDir, computerUse });
}

/** Replay a past session as ChatFrames — dispatched by the id's PROVIDER (each backend's store is
 *  its own id namespace, and the caller tells us explicitly which one this id came from). */
export async function sessionHistoryFrames(
  sessionId: string,
  cwd: string,
  provider: ChatProviderId,
): Promise<ChatFrame[]> {
  return CHAT_BACKENDS[resolveChatProvider(provider)].sessionHistoryFrames(sessionId, cwd);
}

export function abortTurn(chatId: string): void {
  fallbackBackend(chatId).abortTurn(chatId);
}

export function setModel(chatId: string, model: string): void {
  fallbackBackend(chatId).setModel(chatId, model);
}

// Interactive verbs: routed to the OWNING backend, dropped when it doesn't implement them. A
// non-interactive backend never raises the frames these answer, so there is nothing to answer.
export function respondPermission(
  chatId: string,
  id: string,
  behavior: "allow" | "deny",
  always?: boolean,
): void {
  fallbackBackend(chatId).respondPermission?.(chatId, id, behavior, always);
}

export function respondQuestion(chatId: string, id: string, answers: Record<string, string> | null): void {
  fallbackBackend(chatId).respondQuestion?.(chatId, id, answers);
}

export function setPermissionMode(chatId: string, mode: string): void {
  fallbackBackend(chatId).setPermissionMode?.(chatId, mode);
}

export function setEffort(chatId: string, effort: string): void {
  fallbackBackend(chatId).setEffort?.(chatId, effort);
}

export function closeChat(chatId: string): void {
  // Every backend that holds this id, not just the first owner: a resume can leave a torn-down
  // session behind, and closing twice is a no-op per driver.
  for (const b of CHAT_BACKEND_LIST) if (b.hasSession(chatId)) b.closeChat(chatId);
}

export function scheduleClose(chatId: string, ms: number): void {
  fallbackBackend(chatId).scheduleClose(chatId, ms);
}

export function rebindSink(chatId: string, sink: ChatSink): boolean {
  return fallbackBackend(chatId).rebindSink(chatId, sink);
}

export function detachSink(chatId: string): void {
  fallbackBackend(chatId).detachSink(chatId);
}

export { owner };
export { newChatId } from "../chat";
