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

/** Frames that have already been given one retry after a failed `sink()` call — see `flushToSink`.
 *  Module-level and keyed by object identity, not per-session: a given frame object only ever lives
 *  in one session's buffer at a time, and once it's delivered or dropped nothing references it any
 *  more, so membership is naturally GC'able. Deliberately just a boolean "have we already retried
 *  this one" test, not a counter — the bound is exactly one extra attempt, nothing fancier. */
const retriedOnce = new WeakSet<ChatFrame>();

/** Re-point `s.sink` at `sink`, cancel any pending grace-close timer, and flush everything buffered
 *  while detached, in order. A `sink(f)` throw proves only that THIS WRITE failed — not that the
 *  socket itself is dead: an oversized frame, a `JSON.stringify` cycle, or an unrelated backpressure
 *  `RangeError` can all throw on an otherwise-healthy socket, and the WS close handler (`detachSink`
 *  below the call sites), not a catch block here, is the authority on whether the socket is actually
 *  gone. So a failure here does NOT re-detach the session (that would leave it detached with no
 *  grace-close timer armed — nothing left to re-arm it, since the real close event may never fire —
 *  buffering into the void with no one watching). Instead the failed frame gets exactly ONE retry on
 *  the next flush (retried ahead of everything queued after it); if it fails a SECOND time it is
 *  dropped and the flush continues past it, so one deterministically-broken frame can't wedge every
 *  future flush behind it forever. Retrying is not free: a duplicate `tool-use` leaves a
 *  permanently-pending tool chip in ChatView (worse than the original gap — resolved only by the
 *  first delivery of a given tool-call id), a duplicate `permission`/`question` pushes a second,
 *  unanswerable card, and duplicate text visibly stutters the transcript. Bounding the retry to one
 *  attempt is what keeps that cost from compounding indefinitely. Any frame emitted (re-entrantly)
 *  into `s.buffer` DURING this flush is preserved, not clobbered, by the retained-tail write below. */
function flushToSink(s: SessionSink, sink: ChatSink): void {
  if (s.closeTimer) {
    clearTimeout(s.closeTimer);
    s.closeTimer = undefined;
  }
  s.sink = sink;
  if (s.buffer.length) {
    const buffered = s.buffer;
    s.buffer = [];
    for (let i = 0; i < buffered.length; i++) {
      const f = buffered[i];
      try {
        sink(f);
      } catch {
        if (retriedOnce.has(f)) continue; // already retried once and failed again — drop just this frame
        retriedOnce.add(f);
        // Keep the failed frame plus everything after it for the next flush — concat (not
        // overwrite) so anything a re-entrant emit() already pushed onto the fresh s.buffer during
        // THIS pass survives, appended after the retained tail.
        s.buffer = buffered.slice(i).concat(s.buffer);
        break;
      }
    }
  }
  s.detached = false;
}

/** Re-point a live session's frame sink at a freshly-reconnected socket and flush the buffer (see
 *  `flushToSink`). Additionally, whenever no turn is in flight, pushes a synthetic `done`: the
 *  terminating result/done may have been fired into the dying socket before the close was detected
 *  (nothing buffers that window), which would wedge the client's streaming spinner forever. This is
 *  always attempted when `!turnActive` — even if a frame earlier in this same flush failed — because
 *  that failure proved nothing about THIS write; the write is already inside its own try/catch, so
 *  attempting it against a genuinely dead sink costs nothing, while skipping it recreates the exact
 *  wedge the synthetic `done` exists to prevent. Provider wrappers do the `sessions.get(chatId)`
 *  lookup and return whether a session existed. */
export function rebindSessionSink(s: SessionSink, sink: ChatSink): void {
  flushToSink(s, sink);
  if (!s.turnActive) {
    try {
      sink({ type: "done" });
    } catch {
      /* */
    }
  }
}

/** Re-point a live session's frame sink and flush the buffer (see `flushToSink`) — the OTHER path
 *  that can hand a session a live sink besides a WS reconnect: `sendMessage` reopening an existing
 *  session when the user types a new turn before (or instead of) the socket ever reconnecting. Every
 *  provider's reopen path used to just do `sink = sink; detached = false` inline, WITHOUT flushing
 *  `buffer` — stranding anything buffered during a drop if the user's next action was typing rather
 *  than a plain reconnect. Shared here so there's exactly one flush implementation for all nine
 *  backends, not one per driver. No synthetic `done` here (unlike `rebindSessionSink`): a new turn
 *  starts right after this call and its own frames supersede any wedged spinner, so pushing one
 *  would only risk the client's `dispatchQueued()` firing an extra, unwanted time. */
export function reattachSessionSink(s: SessionSink, sink: ChatSink): void {
  flushToSink(s, sink);
}

/** Cancel any pending grace-close timer and arm a fresh one that runs `close` after `ms` of no
 *  reconnect. `close` is the provider's own session teardown (its closeChat bound to the chat id),
 *  kept at the call site because each provider tears its child process down differently. */
export function scheduleSessionClose(s: SessionSink, ms: number, close: () => void): void {
  if (s.closeTimer) clearTimeout(s.closeTimer);
  s.closeTimer = setTimeout(close, ms);
}
