// core/src/chatProviders/index.ts
// The chat PROVIDER router: one seam that lets each chat session run on any backend in the nine-backend
// registry (./backends.ts: claude, opencode, codex and six ACP agents), all speaking the same
// ChatFrame wire protocol so ChatView renders any of them unchanged. The drivers live in
// core/src/chat.ts (Claude), ./opencode/, ./codex/ and ./acp/.
//
// Routing rule: a chatId that already has a live session anywhere routes to THAT backend
// (conversation continuity beats a stale provider field); otherwise the creation verbs
// (open/send/resume) honor the requested provider.
//
// Interactive verbs (permissions, questions, permission mode, effort) dispatch to the owning
// backend and are simply DROPPED when that backend doesn't implement them — the graceful
// degradation a non-interactive CLI needs, declared as data (`capabilities.permissionModes` /
// `.effort` in agentBackends/catalog.ts).
import type { ChatFrame, ChatImage, ChatSink } from '../chat'
import { CHAT_BACKENDS, CHAT_BACKEND_LIST, type ChatBackend } from './backends'
import {
    DEFAULT_BACKEND,
    resolveBackendId,
    type BackendId,
} from '../agentBackends/catalog'
import { resolveVisibilityGate } from '../agentBackends/visibilityGate'

/** The backend holding a live session for this chat id, or null. Iterates CHAT_BACKEND_LIST, whose
 *  order preserves the original opencode-then-claude ownership resolution. */
function owningBackend(chatId: string): ChatBackend | null {
    for (const b of CHAT_BACKEND_LIST) if (b.hasSession(chatId)) return b
    return null
}

/** The backend a chat should run on: whoever already owns a live session for it, else the
 *  requested/default one. One lookup, replacing the per-verb if/else chain. */
function target(chatId: string, provider: BackendId): ChatBackend {
    return owningBackend(chatId) ?? CHAT_BACKENDS[resolveBackendId(provider)]
}

/** The backend for a chatId with no live session — where an unowned verb lands. Matches the old
 *  behaviour, where an unowned id fell through to Claude's own no-op-on-unknown-id handling. */
function fallbackBackend(chatId: string): ChatBackend {
    return owningBackend(chatId) ?? CHAT_BACKENDS[DEFAULT_BACKEND]
}

/** Test seam: the gate the router consults. Swapped only by dispatchGate.test.ts. */
export const gate = { resolve: resolveVisibilityGate }

/**
 * THE visibility chokepoint for chat. Every session-CREATING verb passes through here before a
 * backend is spawned, so a backend with no verified enforcement mechanism cannot start against a
 * vault that hides notes — it gets a `visibility-refused` frame instead.
 *
 * This lives in the router, not in the drivers, deliberately. The seven non-Claude drivers were each
 * written separately and not one of them checked visibility; the docs said "refused" while the code
 * would have run ungated. One gate here means a NEW backend is refused by default (its catalog entry
 * starts at "none") rather than silently unprotected until someone remembers.
 *
 * Async by necessity (it reads the vault), while the verbs it guards are fire-and-forget `void`. So
 * it resolves first and dispatches in the continuation: on refusal nothing is ever spawned, and the
 * caller's synchronous contract is unchanged.
 *
 * The id passed in is the backend that will actually RUN (the chat's live owner when it has one),
 * never the raw requested provider: judging one backend and spawning another would let a restricted
 * backend run ungated.
 *
 * The channel is always "chat" here — the daemon's equivalent gate is resolveDaemonBackend
 * (daemon/src/daemon/session.ts), which refuses on the stricter daemon tier.
 */
function withVisibilityGate(
    backendId: BackendId,
    cwd: string,
    sink: ChatSink,
    dispatch: () => void,
): void {
    void gate.resolve(backendId, 'chat', cwd).then(verdict => {
        if (verdict.allowed) {
            dispatch()
            return
        }
        sink({
            type: 'error',
            code: 'visibility-refused',
            binary: backendId,
            message: verdict.message,
        })
    })
}

export function openSession(
    chatId: string,
    cwd: string,
    sink: ChatSink,
    memoryDir: string | undefined,
    provider: BackendId,
): void {
    const b = target(chatId, provider)
    withVisibilityGate(b.id, cwd, sink, () =>
        b.openSession({
            chatId,
            cwd,
            sink,
            memoryDir,
        }),
    )
}

export function sendMessage(
    chatId: string,
    text: string,
    cwd: string,
    sink: ChatSink,
    images: ChatImage[] | undefined,
    memoryDir: string | undefined,
    provider: BackendId,
): void {
    const b = target(chatId, provider)
    withVisibilityGate(b.id, cwd, sink, () =>
        b.sendMessage({
            chatId,
            text,
            cwd,
            sink,
            images,
            memoryDir,
        }),
    )
}

export function resumeSession(
    chatId: string,
    sessionId: string,
    cwd: string,
    sink: ChatSink,
    memoryDir: string | undefined,
    provider: BackendId,
): void {
    // A resume is a deliberate re-bind — the REQUESTED provider wins (the session id belongs to that
    // provider's store). Tear down any OTHER backend's session for this chat id, but only once the
    // gate allows: a refused resume must leave the user's live session untouched. The chosen backend
    // tears down its own (each driver's resumeSession is idempotent).
    const chosen = CHAT_BACKENDS[resolveBackendId(provider)]
    withVisibilityGate(chosen.id, cwd, sink, () => {
        for (const b of CHAT_BACKEND_LIST)
            if (b !== chosen && b.hasSession(chatId)) b.closeChat(chatId)
        chosen.resumeSession({
            chatId,
            sessionId,
            cwd,
            sink,
            memoryDir,
        })
    })
}

/** Replay a past session as ChatFrames — dispatched by the id's PROVIDER (each backend's store is
 *  its own id namespace, and the caller tells us explicitly which one this id came from). */
export async function sessionHistoryFrames(
    sessionId: string,
    cwd: string,
    provider: BackendId,
): Promise<ChatFrame[]> {
    return CHAT_BACKENDS[resolveBackendId(provider)].sessionHistoryFrames(
        sessionId,
        cwd,
    )
}

export function abortTurn(chatId: string): void {
    fallbackBackend(chatId).abortTurn(chatId)
}

export function setModel(chatId: string, model: string): void {
    fallbackBackend(chatId).setModel(chatId, model)
}

// Interactive verbs: routed to the OWNING backend, dropped when it doesn't implement them. A
// non-interactive backend never raises the frames these answer, so there is nothing to answer.
export function respondPermission(
    chatId: string,
    id: string,
    behavior: 'allow' | 'deny',
    always?: boolean,
): void {
    fallbackBackend(chatId).respondPermission?.(chatId, id, behavior, always)
}

export function respondQuestion(
    chatId: string,
    id: string,
    answers: Record<string, string> | null,
): void {
    fallbackBackend(chatId).respondQuestion?.(chatId, id, answers)
}

export function setPermissionMode(chatId: string, mode: string): void {
    fallbackBackend(chatId).setPermissionMode?.(chatId, mode)
}

export function setEffort(chatId: string, effort: string): void {
    fallbackBackend(chatId).setEffort?.(chatId, effort)
}

export function closeChat(chatId: string): void {
    // Every backend that holds this id, not just the first owner: a resume can leave a torn-down
    // session behind, and closing twice is a no-op per driver.
    for (const b of CHAT_BACKEND_LIST)
        if (b.hasSession(chatId)) b.closeChat(chatId)
}

export function scheduleClose(chatId: string, ms: number): void {
    fallbackBackend(chatId).scheduleClose(chatId, ms)
}

export function rebindSink(chatId: string, sink: ChatSink): boolean {
    return fallbackBackend(chatId).rebindSink(chatId, sink)
}

export function detachSink(chatId: string, sink: ChatSink): boolean {
    return fallbackBackend(chatId).detachSink(chatId, sink)
}

export { newChatId } from '../chat'
