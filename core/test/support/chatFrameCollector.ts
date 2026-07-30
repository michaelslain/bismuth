// core/test/support/chatFrameCollector.ts
// Shared ChatFrame collector for the mocked-CLI integration tests (Tasks 3/4): records every frame a
// chat backend emits and lets a test `await` one matching a predicate, tolerating frames that arrive
// before the wait starts (checks already-collected frames first) as well as ones that arrive after.
//
// Hoisted out of claudeMocked.test.ts/opencodeMocked.test.ts/codexMocked.test.ts/gooseMocked.test.ts/
// geminiMocked.test.ts/clineMocked.test.ts/acpFakeAgent.test.ts, which each carried an identical
// ~30-line copy differing only in their default `timeoutMs` (a code-review finding on this task: any
// fix to the waiter/timeout logic was landing in seven places). One copy, one place to fix it.
import type { ChatFrame } from "../../src/chat";

export interface ChatFrameCollector {
  /** Pass as a chat backend's `sink`. */
  sink: (frame: ChatFrame) => void;
  /** Every frame collected so far, in arrival order — read directly for "did X ever happen"
   *  assertions that don't need to block (e.g. "no assistant-text frame appeared"). */
  frames: ChatFrame[];
  /** Resolves with the first frame (already collected, or arriving later) matching `match`.
   *  Rejects after `timeoutMs` with every frame type seen so far, for a useful failure message. */
  waitFor(match: (f: ChatFrame) => boolean, timeoutMs?: number): Promise<ChatFrame>;
}

export function makeChatFrameCollector(defaultTimeoutMs = 30_000): ChatFrameCollector {
  const frames: ChatFrame[] = [];
  const waiters: { match: (f: ChatFrame) => boolean; resolve: (f: ChatFrame) => void }[] = [];

  const sink = (frame: ChatFrame) => {
    frames.push(frame);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(frame)) {
        waiters[i].resolve(frame);
        waiters.splice(i, 1);
      }
    }
  };

  function waitFor(match: (f: ChatFrame) => boolean, timeoutMs = defaultTimeoutMs): Promise<ChatFrame> {
    const already = frames.find(match);
    if (already) return Promise.resolve(already);
    return new Promise<ChatFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === wrapped);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error("timeout waiting for frame; saw: " + JSON.stringify(frames.map((f) => f.type))));
      }, timeoutMs);
      const wrapped = (f: ChatFrame) => {
        clearTimeout(timer);
        resolve(f);
      };
      waiters.push({ match, resolve: wrapped });
    });
  }

  return { sink, frames, waitFor };
}
