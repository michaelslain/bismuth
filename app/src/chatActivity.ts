// app/src/chatActivity.ts
// Per-chat busy (streaming a response) + composing (a non-empty draft) signals, published by
// ChatView and read by anything that wants to animate on a chat's liveness — the daemon page's
// face reads chatBusy('daemon')/chatComposing('daemon') to switch between talking/listening states.
// Same tiny reactive-singleton Map-signal pattern as chatOrigin.ts, keyed by chat id.
import { createSignal } from 'solid-js'

const [busyChats, setBusyChats] = createSignal<Map<string, boolean>>(new Map())
const [composingChats, setComposingChats] = createSignal<Map<string, boolean>>(new Map())

/** Whether a chat is currently streaming a response. Reactive; false when unknown. */
export function chatBusy(chatId: string): boolean {
    return busyChats().get(chatId) ?? false
}

/** Whether a chat currently has a non-empty draft. Reactive; false when unknown. */
export function chatComposing(chatId: string): boolean {
    return composingChats().get(chatId) ?? false
}

/** Publish a chat's busy (streaming) state. */
export function publishChatBusy(chatId: string, busy: boolean): void {
    setBusyChats(m => {
        const next = new Map(m)
        next.set(chatId, busy)
        return next
    })
}

/** Publish a chat's composing (non-empty draft) state. */
export function publishChatComposing(chatId: string, composing: boolean): void {
    setComposingChats(m => {
        const next = new Map(m)
        next.set(chatId, composing)
        return next
    })
}

/** Clear both signals for a chat — call on unmount so a closed chat reads as neither. */
export function clearChatActivity(chatId: string): void {
    setBusyChats(m => {
        if (!m.has(chatId)) return m
        const next = new Map(m)
        next.delete(chatId)
        return next
    })
    setComposingChats(m => {
        if (!m.has(chatId)) return m
        const next = new Map(m)
        next.delete(chatId)
        return next
    })
}
