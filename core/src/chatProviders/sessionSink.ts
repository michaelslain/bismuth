// core/src/chatProviders/sessionSink.ts
// Transport-agnostic session-frame buffering, shared by every chat backend: core/src/chat.ts's
// Claude sessions, chatProviders/opencode/opencode.ts's opencode sessions, chatProviders/acp/driver.ts's six
// ACP-based sessions (cline/gemini/goose/openclaw/hermes/claude-code-acp/codex-acp), and
// chatProviders/codex/driver.ts's codex sessions — nine backends total, each session type
// satisfying SessionSink structurally. Every provider registers sessions keyed by a client chat id
// and, on an abnormal WS drop, BUFFERS outgoing ChatFrames (capped) instead of firing them into the
// dead socket; on reconnect (or reopen — see reattachSessionSink) it flushes the buffer to the new
// socket and, when between turns, pushes a synthetic `done`. This module is the pure, provider-
// independent slice of that lifecycle — the generic pieces every driver held verbatim —
// parameterized over the session object via structural typing, so each provider keeps its own
// registry + provider-specific teardown (closeChat) at the call site.
import type { ChatFrame, ChatSink } from '../chat'

/** Cap on frames buffered while detached — enough for any realistic turn's tail. A runaway turn
 *  during a long outage evicts its OLDEST buffered frame first (FIFO) rather than growing
 *  unbounded, so the buffer always holds the most RECENT MAX_BUFFERED_FRAMES: the terminal frames
 *  that matter for UI consistency — result/done/permission — arrive last, so keeping the tail (not
 *  the head) is what lets a reconnect unwedge the client instead of replaying stale text deltas and
 *  still missing the frame that would stop the spinner. */
export const MAX_BUFFERED_FRAMES = 2000

/** The slice of a chat session the buffering helpers touch. Every driver's own session type
 *  (chat.ts's ChatSession, opencode/opencode.ts's OpencodeSession, the ACP driver's session, codex/driver.ts's
 *  session) satisfies it structurally, so each provider passes its own session object. */
export interface SessionSink {
    sink: ChatSink
    detached: boolean
    buffer: ChatFrame[]
    turnActive: boolean
    closeTimer?: ReturnType<typeof setTimeout>
}

/** Route a frame to the session's sink, or into the reconnect buffer while detached. Every frame
 *  producer (drain loop, canUseTool, teardown notices) funnels through this. While detached, the
 *  buffer is FIFO-capped: once full, the OLDEST buffered frame is evicted before the new one is
 *  pushed, so a long outage keeps the most recent tail (where result/done/permission live) instead
 *  of a stale head. */
export function emit(session: SessionSink, frame: ChatFrame): void {
    if (session.detached) {
        if (session.buffer.length >= MAX_BUFFERED_FRAMES) session.buffer.shift()
        session.buffer.push(frame)
        return
    }
    session.sink(frame)
}

/** Re-point a live session's frame sink and flush everything buffered while detached, in order —
 *  the counterpart to `rebindSessionSink` for `sendMessage`'s "existing session" reopen branch
 *  (every driver: chat.ts, opencode/opencode.ts, acp/driver.ts, codex/driver.ts). It also cancels
 *  any pending grace-close timer. No synthetic `done` here (unlike `rebindSessionSink`): a new turn
 *  starts right after this call and its own frames supersede any wedged spinner.
 *
 *  Invariant: every reachable ChatSink swallows its own write errors, so the catch below is
 *  defence-in-depth — on a throw the failed frame and the rest go back on `s.buffer` and the
 *  session stays ATTACHED (re-detaching would leave no grace-close timer armed). */
export function reattachSessionSink(s: SessionSink, sink: ChatSink): void {
    if (s.closeTimer) {
        clearTimeout(s.closeTimer)
        s.closeTimer = undefined
    }
    s.sink = sink
    if (s.buffer.length) {
        const buffered = s.buffer
        s.buffer = []
        for (let i = 0; i < buffered.length; i++) {
            try {
                sink(buffered[i])
            } catch {
                s.buffer = buffered.slice(i).concat(s.buffer)
                break
            }
        }
    }
    s.detached = false
}

/** Re-point a live session's frame sink at a freshly-reconnected socket and flush the buffer (see
 *  `reattachSessionSink`). Additionally, whenever no turn is in flight, pushes a synthetic `done`: the
 *  terminating result/done may have been fired into the dying socket before the close was detected
 *  (nothing buffers that window), which would wedge the client's streaming spinner forever. This is
 *  always attempted when `!turnActive` — even if a frame earlier in this same flush failed — because
 *  that failure proved nothing about THIS write; the write is already inside its own try/catch, so
 *  attempting it against a genuinely dead sink costs nothing, while skipping it recreates the exact
 *  wedge the synthetic `done` exists to prevent. Provider wrappers do the `sessions.get(chatId)`
 *  lookup and return whether a session existed. */
export function rebindSessionSink(s: SessionSink, sink: ChatSink): void {
    reattachSessionSink(s, sink)
    if (!s.turnActive) {
        try {
            sink({ type: 'done' })
        } catch {
            /* */
        }
    }
}

/** Mark a session detached — the counterpart to rebindSessionSink/reattachSessionSink, called from
 *  server.ts's WS close handler for an ABNORMAL close (a clean tab-close calls the provider's own
 *  closeChat() instead — no detach involved). IDENTITY-GUARDED, mirroring uiControl.ts's
 *  unregisterWindow: on a half-open drop (lid close, wifi loss, NAT timeout) the client's NEW socket
 *  can open and rebind the session to a different sink BEFORE the OLD socket's close event lands —
 *  without the guard, that stale close would re-detach a session that's live under someone else's
 *  (newer) sink: a chat the user is actively watching would silently start buffering into the void.
 *  Returns whether the detach actually happened (`false` on a rejected guard). The caller MUST use
 *  this to gate whatever teardown timer it was about to arm (scheduleSessionClose) — a rejected
 *  detach means the session is live under a newer sink that will arm its OWN timer on its own close;
 *  arming one here anyway would silently kill that live, newer connection 30s later with no frame
 *  sent, even though the guard just correctly said "leave this session alone". */
export function detachSessionSink(s: SessionSink, sink: ChatSink): boolean {
    if (s.sink !== sink) return false
    s.detached = true
    return true
}

/** Cancel any pending grace-close timer and arm a fresh one that runs `close` after `ms` of no
 *  reconnect. `close` is the provider's own session teardown (its closeChat bound to the chat id),
 *  kept at the call site because each provider tears its child process down differently. */
export function scheduleSessionClose(
    s: SessionSink,
    ms: number,
    close: () => void,
): void {
    if (s.closeTimer) clearTimeout(s.closeTimer)
    s.closeTimer = setTimeout(close, ms)
}
