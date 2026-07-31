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

/** Cap on frames buffered while detached — enough for any realistic turn's tail. A runaway turn
 *  during a long outage evicts its OLDEST buffered frame first (FIFO) rather than growing
 *  unbounded, so the buffer always holds the most RECENT MAX_BUFFERED_FRAMES: the terminal frames
 *  that matter for UI consistency — result/done/permission — arrive last, so keeping the tail (not
 *  the head) is what lets a reconnect unwedge the client instead of replaying stale text deltas and
 *  still missing the frame that would stop the spinner. */
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
 *  producer (drain loop, canUseTool, teardown notices) funnels through this. While detached, the
 *  buffer is FIFO-capped: once full, the OLDEST buffered frame is evicted before the new one is
 *  pushed, so a long outage keeps the most recent tail (where result/done/permission live) instead
 *  of a stale head. */
export function emit(session: SessionSink, frame: ChatFrame): void {
  if (session.detached) {
    if (session.buffer.length >= MAX_BUFFERED_FRAMES) session.buffer.shift();
    session.buffer.push(frame);
    return;
  }
  session.sink(frame);
}

/** Re-point a live session's frame sink at a freshly-reconnected socket (cancelling any pending
 *  grace-period teardown), flushing everything buffered while the socket was down so mid-turn
 *  deltas, tool results, and permission prompts lost to the gap reach the reconnected client in
 *  order. If the new sink itself throws mid-flush (the "reconnected" socket was already dead),
 *  the un-flushed tail — INCLUDING the frame that just failed, since a `sink(f)` throw does not
 *  prove `f` was never delivered — is put back on `s.buffer` and the session stays `detached`, so
 *  the next real rebind gets another shot at it instead of silently losing it (a possible duplicate
 *  frame on a later successful flush is far less harmful than a lost `done`/`permission` frame). A
 *  between-turns rebind that flushes cleanly then pushes a synthetic `done`: the terminating
 *  result/done may have been fired into the dying socket before the close was detected (nothing
 *  buffers that window), which would wedge the client's streaming spinner forever — a synthetic
 *  `done` is idempotent client-side, so push one whenever no turn is in flight AND the flush
 *  succeeded (a flush that just proved the sink dead skips it — writing to a proven-dead sink again
 *  is pointless). Provider wrappers do the `sessions.get(chatId)` lookup and return whether a
 *  session existed. */
export function rebindSessionSink(s: SessionSink, sink: ChatSink): void {
  if (s.closeTimer) {
    clearTimeout(s.closeTimer);
    s.closeTimer = undefined;
  }
  s.sink = sink;
  let flushFailed = false;
  if (s.buffer.length) {
    const buffered = s.buffer;
    s.buffer = [];
    for (let i = 0; i < buffered.length; i++) {
      try {
        sink(buffered[i]);
      } catch {
        // sink() threw before confirming delivery of buffered[i] — keep it (slice(i), not
        // slice(i + 1)) plus everything after for the next rebind attempt, and treat this socket
        // as dead again rather than marking the session attached under a sink that just failed.
        s.buffer = buffered.slice(i);
        flushFailed = true;
        break;
      }
    }
  }
  s.detached = flushFailed;
  if (!flushFailed && !s.turnActive) {
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
