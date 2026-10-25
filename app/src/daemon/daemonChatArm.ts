// app/src/daemon/daemonChatArm.ts
// Whether the daemon page's chat is armed — plain app state, never persisted, so a relaunch
// or a restored layout always comes back unarmed. The rules live in daemon/daemonChatArming.ts;
// this is only the signal. DaemonPageHost arms it from a trusted gesture on the composer; App
// reads it to decide whether `::chat:daemon` joins the retained chat-session set
// (chat/chatSessions.ts), and disarms it when the last daemon leaf closes. Same module-level
// singleton pattern as chatActivity.ts.
//
// Each arm starts a NEW conversation: the remembered session is forgotten first, so opening the
// daemon page and clicking its bar never resumes the last daemon chat. The one exception is Reopen
// Closed Tab (Cmd+Shift+T): App marks the reopened page with `resumeDaemonChat`, and the next arm
// keeps the remembered session so the conversation comes back with the tab.
import { createSignal } from 'solid-js'
import { isArmingGesture, type ArmingEvent } from './daemonChatArming'
import { forgetChatSession } from '../chat/chatSessionStore'
import { DAEMON_CHAT_ID } from '../tabIds'

const [armed, setArmed] = createSignal(false)
// Set by Reopen Closed Tab; consumed by the next arm, cleared when the daemon page closes unarmed.
let resumeNext = false

/** Reactive: whether the daemon chat is armed. */
export const daemonChatArmed = armed

/** Arm the daemon chat from a gesture. Returns true when this event armed it (an untrusted or
 *  non-arming event, or an already-armed chat, returns false). */
export function armDaemonChat(e: ArmingEvent): boolean {
    if (armed() || !isArmingGesture(e)) return false
    arm()
    return true
}

/** Disarm: the next mount of the daemon chat needs a fresh gesture. */
export function disarmDaemonChat(): void {
    if (armed()) setArmed(false)
}

/** Reopen Closed Tab brought a daemon page back: the next arm resumes the remembered conversation
 *  instead of starting a new one. With a trusted event (the Cmd+Shift+T keydown itself) it arms
 *  now, so the conversation is on screen without a further click; app control's `/ui` channel
 *  cannot produce a trusted event, so its reopen only marks the page. */
export function resumeDaemonChat(e?: { isTrusted: boolean }): void {
    resumeNext = true
    if (e?.isTrusted === true && !armed()) arm()
}

/** The daemon page closed without being armed: a later open is a fresh page, not a reopen. */
export function clearDaemonChatResume(): void {
    resumeNext = false
}

/** Arm from a real drop onto the daemon page. A drop is a user gesture app control cannot forge:
 *  an HTML5 drop is checked `isTrusted` by the caller, a native drop comes from the OS through
 *  Tauri's webview (never the `/ui` channel), and an in-app pointer drag ends on a trusted
 *  pointerup. Callers are exactly those three paths. */
export function armDaemonChatForDrop(): void {
    if (!armed()) arm()
}

function arm(): void {
    if (!resumeNext) forgetChatSession(DAEMON_CHAT_ID)
    resumeNext = false
    setArmed(true)
}
