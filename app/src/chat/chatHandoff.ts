// app/src/chat/chatHandoff.ts
// Move a conversation from one chat id to another — the daemon page's `[↗]` open-in-chat icon. The
// LIVE session moves (chatSessions.ts `moveChatSession`): its socket, streaming turn, queued turns
// and transcript go with it, so a hand-off mid-reply keeps the reply going in the new tab. This
// module holds the pure parts: when the icon acts, what the stored per-chat prefs carry over
// (the remembered SDK session_id, the backend the conversation runs on — a Claude session id
// resumed on opencode could only error — and the model it was using), and the backend id a
// freshly created session binds to, which must never be one a moved session still holds.
import { forgetChatSession, rememberChatSession } from './chatSessionStore'
import { modelStorageKeys, type ChatProviderChoice } from './chatProvider'
import { rememberProvider, type StorageLike } from './chatSessionPrefs'

/** Whether the `[↗]` open-in-chat icon can act: a conversation exists. A turn in flight moves with
 *  the session and keeps streaming in the new tab. */
export function canHandOff(items: number): boolean {
    return items > 0
}

/** Carry chat `from`'s stored prefs onto chat `to`: the remembered session id (when the backend has
 *  named the conversation yet — `sessionId` null otherwise), the provider and the per-chat model;
 *  then forget the session under `from`, so `from` starts fresh the next time it opens. */
export function moveConversationPrefs(
    from: string,
    to: string,
    provider: ChatProviderChoice,
    sessionId: string | null,
    storage: StorageLike | null,
): void {
    if (from === to) return
    if (sessionId) rememberChatSession(to, sessionId)
    rememberProvider(storage, to, provider)
    try {
        const model = storage?.getItem(modelStorageKeys(provider, from).perChat)
        if (model)
            storage?.setItem(modelStorageKeys(provider, to).perChat, model)
    } catch {
        /* storage unavailable — the new chat falls back to the global last model */
    }
    forgetChatSession(from)
}

/** The backend chat id a new session for `chatId` binds its socket to: `chatId` itself, unless a
 *  live session (one moved off `chatId` by a hand-off) still holds that backend id — binding to it
 *  would rebind the server's session to the new socket and steal the moved conversation. */
export function initialBackendChatId(
    chatId: string,
    liveBackendIds: ReadonlySet<string>,
    mint: () => string,
): string {
    return liveBackendIds.has(chatId) ? mint() : chatId
}
