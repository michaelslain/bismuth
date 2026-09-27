// app/src/daemon/daemonChatArm.ts
// Whether the daemon page's chat is armed — plain app state, never persisted, so a relaunch
// or a restored layout always comes back unarmed. The rules live in daemon/daemonChatArming.ts;
// this is only the signal. DaemonPageHost arms it from a trusted gesture on the composer; App
// reads it to decide whether `::chat:daemon` joins the retained chat-session set
// (chat/chatSessions.ts), and disarms it when the last daemon leaf closes. Same module-level
// singleton pattern as chatActivity.ts.
import { createSignal } from 'solid-js'
import { isArmingGesture, type ArmingEvent } from './daemonChatArming'

const [armed, setArmed] = createSignal(false)

/** Reactive: whether the daemon chat is armed. */
export const daemonChatArmed = armed

/** Arm the daemon chat from a gesture. Returns true when this event armed it (an untrusted or
 *  non-arming event, or an already-armed chat, returns false). */
export function armDaemonChat(e: ArmingEvent): boolean {
    if (armed() || !isArmingGesture(e)) return false
    setArmed(true)
    return true
}

/** Disarm: the next mount of the daemon chat needs a fresh gesture. */
export function disarmDaemonChat(): void {
    if (armed()) setArmed(false)
}

/** Arm from a real drop onto the daemon page. A drop is a user gesture app control cannot forge:
 *  an HTML5 drop is checked `isTrusted` by the caller, a native drop comes from the OS through
 *  Tauri's webview (never the `/ui` channel), and an in-app pointer drag ends on a trusted
 *  pointerup. Callers are exactly those three paths. */
export function armDaemonChatForDrop(): void {
    if (!armed()) setArmed(true)
}
