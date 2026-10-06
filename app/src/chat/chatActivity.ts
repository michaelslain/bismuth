// app/src/chatActivity.ts
// Per-chat busy (streaming a response) + composing (a non-empty draft) + speaking signals, published
// by the chat session and read by anything that wants to animate on a chat's liveness — the daemon
// page's face reads chatBusy('daemon')/chatComposing('daemon') to switch between talking/listening
// states. Keyed by chat id; see createKeyedSignal.ts (an unchanged republish invalidates no reader).
import { createKeyedSignal } from '../createKeyedSignal'

const busyChats = createKeyedSignal<boolean>()
const composingChats = createKeyedSignal<boolean>()
const speakingChats = createKeyedSignal<boolean>()

/** Whether a chat is currently streaming a response. Reactive; false when unknown. */
export function chatBusy(chatId: string): boolean {
    return busyChats.get(chatId) ?? false
}

/** Whether a chat currently has a non-empty draft. Reactive; false when unknown. */
export function chatComposing(chatId: string): boolean {
    return composingChats.get(chatId) ?? false
}

/** Whether a chat is currently streaming assistant TEXT (not just busy with a pending reply).
 *  Reactive; false when unknown. Lets a listener distinguish `thinking` (busy, no text yet) from
 *  `talking` (text streaming) — see daemonFaceModel.ts's `deriveMood`. */
export function chatSpeaking(chatId: string): boolean {
    return speakingChats.get(chatId) ?? false
}

/** Publish a chat's busy (streaming) state. */
export function publishChatBusy(chatId: string, busy: boolean): void {
    busyChats.set(chatId, busy)
}

/** Publish whether a chat is currently streaming assistant text. */
export function publishChatSpeaking(chatId: string, speaking: boolean): void {
    speakingChats.set(chatId, speaking)
}

/** Publish a chat's composing (non-empty draft) state. Republished on every keystroke; unchanged is
 *  a no-op, so every chatComposing() reader (the daemon face's mood) is not invalidated by typing. */
export function publishChatComposing(chatId: string, composing: boolean): void {
    composingChats.set(chatId, composing)
}

/** Clear all signals for a chat — call on unmount so a closed chat reads as neither. */
export function clearChatActivity(chatId: string): void {
    busyChats.clear(chatId)
    composingChats.clear(chatId)
    speakingChats.clear(chatId)
}
