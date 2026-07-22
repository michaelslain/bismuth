// core/src/chatProviders/sessionSink.ts
// Transport-agnostic session-frame buffering, shared by the two chat providers (core/src/chat.ts's
// Claude sessions and chatProviders/opencode.ts's opencode sessions). Both register sessions keyed
// by a client chat id and, on an abnormal WS drop, BUFFER outgoing ChatFrames (capped) instead of
// firing them into the dead socket; on reconnect they flush the buffer to the new socket and, when
// between turns, push a synthetic `done`. This module is the pure, provider-independent slice of
// that lifecycle — the generic pieces both copies held verbatim — parameterized over the session
// object via structural typing, so each provider keeps its own registry + provider-specific
// teardown (closeChat) at the call site.
import type { ChatFrame, ChatSink } from "../chat";

/** Cap on frames buffered while detached — enough for any realistic turn's tail; a runaway turn
 *  during a long outage drops the middle rather than growing unbounded (the terminal frames that
 *  matter for UI consistency — result/done/permission — are tiny and near the end). */
export const MAX_BUFFERED_FRAMES = 2000;

/** The slice of a chat session the buffering helpers touch. Both ChatSession (Claude) and
 *  OpencodeSession satisfy it structurally, so each provider passes its own session object. */
export interface SessionSink {
  sink: ChatSink;
  detached: boolean;
  buffer: ChatFrame[];
  turnActive: boolean;
  closeTimer?: ReturnType<typeof setTimeout>;
}

/** Route a frame to the session's sink, or into the reconnect buffer while detached. Every frame
 *  producer (drain loop, canUseTool, teardown notices) funnels through this. */
export function emit(session: SessionSink, frame: ChatFrame): void {
  if (session.detached) {
    if (session.buffer.length < MAX_BUFFERED_FRAMES) session.buffer.push(frame);
    return;
  }
  session.sink(frame);
}

/** Re-point a live session's frame sink at a freshly-reconnected socket (cancelling any pending
 *  grace-period teardown), flushing everything buffered while the socket was down so mid-turn
 *  deltas, tool results, and permission prompts lost to the gap reach the reconnected client in
 *  order. A between-turns rebind then pushes a synthetic `done`: the terminating result/done may
 *  have been fired into the dying socket before the close was detected (nothing buffers that
 *  window), which would wedge the client's streaming spinner forever — a synthetic `done` is
 *  idempotent client-side, so push one whenever no turn is in flight. Provider wrappers do the
 *  `sessions.get(chatId)` lookup and return whether a session existed. */
export function rebindSessionSink(s: SessionSink, sink: ChatSink): void {
  if (s.closeTimer) {
    clearTimeout(s.closeTimer);
    s.closeTimer = undefined;
  }
  s.sink = sink;
  if (s.buffer.length) {
    const buffered = s.buffer;
    s.buffer = [];
    for (const f of buffered) {
      try {
        sink(f);
      } catch {
        break; // the new socket died mid-flush — the next rebind gets whatever's next
      }
    }
  }
  s.detached = false;
  if (!s.turnActive) {
    try {
      sink({ type: "done" });
    } catch {
      /* */
    }
  }
}

/** Cancel any pending grace-close timer and arm a fresh one that runs `close` after `ms` of no
 *  reconnect. `close` is the provider's own session teardown (its closeChat bound to the chat id),
 *  kept at the call site because each provider tears its child process down differently. */
export function scheduleSessionClose(s: SessionSink, ms: number, close: () => void): void {
  if (s.closeTimer) clearTimeout(s.closeTimer);
  s.closeTimer = setTimeout(close, ms);
}
