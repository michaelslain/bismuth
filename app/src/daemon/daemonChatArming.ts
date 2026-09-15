// app/src/daemon/daemonChatArming.ts
// The rules for when the daemon page's inline centre-column chat may exist. Pure — no Solid imports — so the
// trust boundary is unit-testable; daemonChatArm.ts holds the signal that applies them.
//
// Why the chat is ARMED rather than mounted with the page: retaining the session (chatSessions.ts)
// opens a live `claude` Agent-SDK connection (core/src/chat.ts openSession, eager on connect). App
// control may open the daemon page (`bismuth app open ::daemon`, `app run open-daemon|open-inbox`)
// but may never open a chat (UI_CONTROL_BLOCKLIST, the `::chat:` open-tab refusal). So an open page
// shows the real ChatComposerBar with no session behind it, and only a TRUSTED user gesture landing
// on that composer arms the real chat. App control reaches the app only through the `/ui` channel,
// which can open tabs and run commands but cannot produce a trusted DOM event; `dispatchEvent`
// yields `isTrusted === false`. One caveat: the focus events a script's own `element.focus()` fires
// ARE trusted, so no app code may programmatically focus the composer before it is armed unless a
// trusted event provoked the call. Exactly one such call exists: ChatComposerBar's
// `onBoxPointerDown` focuses the editor for a press on the box padding / disabled send button, and
// only when `e.isTrusted`. Every other composer focus is unreachable pre-session — the slash pick
// needs `session.slashCommands()`, `createComposerFocus` subscribes only once a session exists, and
// ChatControls' pre-session row is `inert` over no-op stubs (story: DaemonChat UntrustedPressDoesNotArm).

/** The minimal event shape the arming rule reads (a DOM Event satisfies it). */
export type ArmingEvent = { type: string; isTrusted: boolean }

/** The gestures that arm the chat: a press on the composer, or keyboard focus landing in it. */
export const ARMING_EVENT_TYPES: readonly string[] = ['pointerdown', 'focusin']

/** True only for a user-generated (trusted) press or focus. Synthetic events never arm. */
export function isArmingGesture(e: ArmingEvent): boolean {
    return e.isTrusted === true && ARMING_EVENT_TYPES.includes(e.type)
}

export type ArmedContext = {
    /** Whether any `::daemon` leaf is open in any tab. */
    daemonOpen: boolean
    /** `settings.daemon.enabled` — an off daemon renders no chat at all. */
    enabled: boolean
}

/** Whether an armed chat stays armed — and so whether App's `chatContents` memo keeps retaining
 *  the `::chat:daemon` session (chatSessions.ts). Closing the last daemon leaf (or turning the
 *  daemon off) disarms it, so bringing the chat back always takes a fresh gesture. It never ARMS. */
export function stayArmed(armed: boolean, ctx: ArmedContext): boolean {
    return armed && ctx.daemonOpen && ctx.enabled
}
