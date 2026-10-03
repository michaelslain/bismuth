// app/src/chatSessionStore.ts
// Remembers, per chat TAB (the ::chat:<uuid> content id — the durable tab identity that survives a
// close/reopen round-trip through serializeTabs), the SDK session_id of the Claude Code conversation
// that tab is currently showing.
//
// This is what makes "Reopen closed tab" (Cmd+Shift+T) restore a CHAT tab onto the SAME conversation
// instead of a blank new one: closing a chat tab tears its backend session down (a clean WS close),
// so the reopened tab — revived with the same ::chat:<uuid> id — must RESUME the prior conversation
// by its session_id. The session_id is the durable, on-disk identity of the conversation (the CLI's
// own session store), so this survives a relaunch too, mirroring closedSession.ts.
//
// The client learns each conversation's session_id from the backend's `session` ChatFrame and stores
// it here keyed by the tab id; ChatView reads it on mount to decide resume-vs-fresh.

import { createChatKeyedStore } from './chatKeyedStore'

const KEY = 'bismuth-chat-sessions-v1'
const CAP = 50

/** One chat TAB id → the SDK session_id it currently shows. */
export interface ChatSessionEntry {
    chatId: string
    sessionId: string
}

function isSessionEntry(x: unknown): x is ChatSessionEntry {
    return (
        !!x &&
        typeof x === 'object' &&
        typeof (x as ChatSessionEntry).chatId === 'string' &&
        typeof (x as ChatSessionEntry).sessionId === 'string'
    )
}

const store = createChatKeyedStore<ChatSessionEntry>(KEY, CAP, isSessionEntry)

/** Remember the session_id a chat tab is currently on. No-op on empty args. */
export function rememberChatSession(chatId: string, sessionId: string): void {
    if (!chatId || !sessionId) return
    store.write(store.upsert(store.read(), chatId, { chatId, sessionId }))
}

/** The remembered session_id for a chat tab, or null if it was never seen (a brand-new chat). */
export function recallChatSession(chatId: string): string | null {
    return store.lookup(store.read(), chatId)?.sessionId ?? null
}

/** Drop a tab's remembered session (a provider switch orphans the old conversation — resuming a
 *  Claude session id on opencode, or vice versa, could only error). */
export function forgetChatSession(chatId: string): void {
    if (!chatId) return
    store.write(store.remove(store.read(), chatId))
}
