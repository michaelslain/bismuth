// app/src/chat/chatHandoff.ts
// Move a conversation from one chat id to another — the daemon page's `[↗]` open-in-chat icon. The
// conversation's durable identity is the SDK session_id remembered per chat id
// (chatSessionStore.ts), so a hand-off copies that id onto the new chat, pins the new chat to the
// backend the conversation runs on (a Claude session id resumed on opencode could only error) with
// the model it was using, then forgets the session under the old id. The new chat id's session then
// resumes the conversation on mount, and the old chat starts fresh the next time it opens.
import {
    forgetChatSession,
    recallChatSession,
    rememberChatSession,
} from './chatSessionStore'
import { modelStorageKeys, type ChatProviderChoice } from './chatProvider'
import { rememberProvider, type StorageLike } from './chatSessionPrefs'

/** What a hand-off needs to know about the live conversation. */
export type HandoffSource = {
    /** Turns in the transcript; nothing to hand off when 0. */
    items: number
    /** A turn (or a queued one) is still streaming; its tail would be cut off mid-reply. */
    streaming: boolean
}

/** Whether the `[↗]` open-in-chat icon can act now: a conversation exists and no turn is in flight. */
export function canHandOff(source: HandoffSource): boolean {
    return source.items > 0 && !source.streaming
}

/** Move chat `from`'s conversation onto chat `to`. Returns false (and changes nothing) when `from`
 *  has no remembered session yet — the backend has not named the conversation, so there is
 *  nothing a new chat could resume. */
export function handOffConversation(
    from: string,
    to: string,
    provider: ChatProviderChoice,
    storage: StorageLike | null,
): boolean {
    const sessionId = recallChatSession(from)
    if (!sessionId || from === to) return false
    rememberChatSession(to, sessionId)
    rememberProvider(storage, to, provider)
    try {
        const model = storage?.getItem(modelStorageKeys(provider, from).perChat)
        if (model)
            storage?.setItem(modelStorageKeys(provider, to).perChat, model)
    } catch {
        /* storage unavailable — the new chat falls back to the global last model */
    }
    forgetChatSession(from)
    return true
}
