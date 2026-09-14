// app/src/chatFocusRequest.ts
// A pending "focus this chat's composer" request, keyed by chat id. For a caller that makes a chat
// exist and wants the composer focused once it does — the daemon page arming its docked chat — where
// the ChatView mounts later (a lazy chunk, then ChatComposer's CodeMirror) than the gesture that
// asked for it. ChatView consumes its own id's request as soon as its composer is ready.
// Same module-level singleton pattern as chatActivity.ts.
import { createSignal } from 'solid-js'

const [pending, setPending] = createSignal<ReadonlySet<string>>(new Set())

/** Ask the chat `chatId` to focus its composer (now if mounted, else when it mounts). */
export function requestChatFocus(chatId: string): void {
    setPending(s => (s.has(chatId) ? s : new Set([...s, chatId])))
}

/** Reactive: whether a focus request is pending for `chatId`. */
export function chatFocusRequested(chatId: string): boolean {
    return pending().has(chatId)
}

/** Drop a pending request (consumed, or no longer wanted). */
export function clearChatFocusRequest(chatId: string): void {
    setPending(s => {
        if (!s.has(chatId)) return s
        const next = new Set(s)
        next.delete(chatId)
        return next
    })
}
