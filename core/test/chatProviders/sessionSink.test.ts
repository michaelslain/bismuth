// Tests for the pure session-frame buffering shared by every chat provider
// (core/src/chatProviders/sessionSink.ts). No mock server, no CLI, no subprocess — this is the
// generic reconnect-buffering slice (emit/rebindSessionSink/reattachSessionSink/
// scheduleSessionClose) that both the Claude chat driver (core/src/chat.ts) and the ACP/opencode/
// codex providers hold verbatim, so a bug here silently loses a turn's output or wedges the
// streaming spinner on WHICHEVER backend the user picked, on every reconnect after a WS drop.
import { describe, expect, test } from "bun:test";
import type { ChatFrame, ChatSink } from "../../src/chat";
import {
  emit,
  MAX_BUFFERED_FRAMES,
  reattachSessionSink,
  rebindSessionSink,
  scheduleSessionClose,
  type SessionSink,
} from "../../src/chatProviders/sessionSink";

function makeSession(overrides: Partial<SessionSink> = {}): SessionSink {
  return {
    sink: () => {},
    detached: false,
    buffer: [],
    turnActive: true,
    closeTimer: undefined,
    ...overrides,
  };
}

function textFrame(i: number): ChatFrame {
  return { type: "assistant-text", text: `f${i}` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("emit", () => {
  test("routes a frame straight to the sink while attached (never touches the buffer)", () => {
    const received: ChatFrame[] = [];
    const s = makeSession({ detached: false, sink: (f) => received.push(f) });
    const frame = textFrame(1);

    emit(s, frame);

    expect(received).toEqual([frame]);
    expect(s.buffer).toEqual([]);
  });

  test("buffers a frame instead of calling the sink while detached", () => {
    const received: ChatFrame[] = [];
    const s = makeSession({ detached: true, sink: (f) => received.push(f) });
    const frame = textFrame(1);

    emit(s, frame);

    expect(received).toEqual([]);
    expect(s.buffer).toEqual([frame]);
  });

  test("MAX_BUFFERED_FRAMES caps the buffer: keeps the most recent frames, drops the earliest", () => {
    const s = makeSession({ detached: true });
    const overflowBy = 5;
    const total = MAX_BUFFERED_FRAMES + overflowBy;

    for (let i = 0; i < total; i++) emit(s, textFrame(i));

    // Exact length, not "grew" or "some cap applied" — an off-by-one here (>  vs >=) would show up
    // as MAX_BUFFERED_FRAMES + 1.
    expect(s.buffer.length).toBe(MAX_BUFFERED_FRAMES);
    // Exact identity of what survived: the LAST 2000 (f5..f2004), not the first 2000 — the terminal
    // frames (result/done/permission) arrive near the end of a turn, so eviction must favor them.
    // A wrong-end drop (keeping the head instead) would pass a bare length check but fail this.
    expect(s.buffer[0]).toEqual(textFrame(overflowBy));
    expect(s.buffer[MAX_BUFFERED_FRAMES - 1]).toEqual(textFrame(total - 1));
    const survivingTexts = new Set(s.buffer.map((f) => (f as { text: string }).text));
    for (let i = 0; i < overflowBy; i++) {
      expect(survivingTexts.has(`f${i}`)).toBe(false);
    }
  });
});

describe("rebindSessionSink — re-points the sink", () => {
  test("re-points the session sink so subsequent frames reach the NEW socket", () => {
    const oldSink: ChatFrame[] = [];
    const newSink: ChatFrame[] = [];
    const s = makeSession({ detached: true, sink: (f) => oldSink.push(f) });

    rebindSessionSink(s, (f) => newSink.push(f));
    emit(s, textFrame(9));

    expect(newSink).toEqual([textFrame(9)]);
    expect(oldSink).toEqual([]);
  });
});

describe("rebindSessionSink — flush order", () => {
  test("flushes buffered frames to the new sink in original order, mid-turn (no synthetic done)", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1), textFrame(2)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: true });
    const received: ChatFrame[] = [];

    rebindSessionSink(s, (f) => received.push(f));

    // Exact sequence, not "arrived" — order-sensitive equality catches a reversed/shuffled flush.
    expect(received).toEqual(buffered);
    expect(s.buffer).toEqual([]);
    expect(s.detached).toBe(false);
  });

  test("a sink that throws mid-flush retains the failed frame + tail for one retry, without re-detaching", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1), textFrame(2)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: true });
    const received: ChatFrame[] = [];
    const throwingSink: ChatSink = (f) => {
      received.push(f);
      if ((f as { text: string }).text === "f1") throw new Error("this write failed");
    };

    rebindSessionSink(s, throwingSink);

    // f0 delivered, f1 attempted (and threw), f2 never attempted this round.
    expect(received).toEqual([textFrame(0), textFrame(1)]);
    // The un-flushed tail is retained for one retry on the next flush — INCLUDING f1 itself, since
    // a throw from sink(f1) proves only that THIS write failed, not that f1 was never delivered.
    expect(s.buffer).toEqual([textFrame(1), textFrame(2)]);
    // A single write failing does NOT prove the socket is dead (an oversized frame or an unrelated
    // RangeError throws on an otherwise-healthy socket too) — only the WS close handler decides
    // that. Re-detaching here would leave the session detached with no grace-close timer armed to
    // ever reap it, buffering into the void with nothing watching.
    expect(s.detached).toBe(false);
  });

  test("a frame that fails twice is dropped, and the flush continues past it to the rest", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1), textFrame(2)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: true });

    // First rebind: f1 throws for the FIRST time — retained for its one retry.
    const attempt1: ChatFrame[] = [];
    const throwsOnF1: ChatSink = (f) => {
      attempt1.push(f);
      if ((f as { text: string }).text === "f1") throw new Error("write failed");
    };
    rebindSessionSink(s, throwsOnF1);
    expect(attempt1).toEqual([textFrame(0), textFrame(1)]);
    expect(s.buffer).toEqual([textFrame(1), textFrame(2)]);

    // Second rebind: the SAME f1 (same object identity, carried over via the retained buffer)
    // throws again. Its one retry is now exhausted — it must be dropped, and the flush must
    // continue on to attempt (and deliver) f2 in this very call, rather than re-queuing itself
    // forever and blocking everything after it.
    const attempt2: ChatFrame[] = [];
    const throwsOnF1Again: ChatSink = (f) => {
      attempt2.push(f);
      if ((f as { text: string }).text === "f1") throw new Error("write failed again");
    };
    rebindSessionSink(s, throwsOnF1Again);

    expect(attempt2).toEqual([textFrame(1), textFrame(2)]);
    expect(s.buffer).toEqual([]);
  });

  test("a re-entrant emit during a failed flush is preserved alongside the retained tail, not destroyed", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1), textFrame(2)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: true });
    const received: ChatFrame[] = [];
    const sink: ChatSink = (f) => {
      received.push(f);
      if ((f as { text: string }).text === "f0") emit(s, textFrame(99)); // re-entrant, mid-flush
      if ((f as { text: string }).text === "f1") throw new Error("write failed");
    };

    rebindSessionSink(s, sink);

    expect(received).toEqual([textFrame(0), textFrame(1)]);
    // f1 (retained for retry) + f2 (never attempted) come first — the order the NEXT flush should
    // deliver them in — followed by the re-entrantly emitted f99, which landed in the fresh
    // s.buffer during THIS flush and must not be clobbered by the retained-tail write.
    expect(s.buffer).toEqual([textFrame(1), textFrame(2), textFrame(99)]);
  });

  test("emit() after a failed flush appends after both the retained tail AND any re-entrant frames, in order", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1), textFrame(2)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: true });
    const sink: ChatSink = (f) => {
      if ((f as { text: string }).text === "f0") emit(s, textFrame(50)); // re-entrant, mid-flush
      if ((f as { text: string }).text === "f1") throw new Error("write failed");
    };

    rebindSessionSink(s, sink);
    expect(s.buffer).toEqual([textFrame(1), textFrame(2), textFrame(50)]);

    // A real socket drop AFTER this rebind (the WS close handler's detachSink, not a failed write,
    // is what actually re-detaches a session) — a frame emitted while genuinely detached must land
    // after everything already queued, not reorder ahead of it.
    s.detached = true;
    emit(s, textFrame(99));

    expect(s.buffer).toEqual([textFrame(1), textFrame(2), textFrame(50), textFrame(99)]);
  });

  test("end-to-end: rebind, throw, rebind again, succeed — delivers the retained tail in order and clears detached", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1), textFrame(2)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: true });

    const firstAttempt: ChatFrame[] = [];
    const dyingSink: ChatSink = (f) => {
      firstAttempt.push(f);
      if ((f as { text: string }).text === "f1") throw new Error("dead socket");
    };
    rebindSessionSink(s, dyingSink);
    expect(firstAttempt).toEqual([textFrame(0), textFrame(1)]);
    expect(s.buffer).toEqual([textFrame(1), textFrame(2)]);

    // A genuine reconnect against a healthy sink.
    const secondAttempt: ChatFrame[] = [];
    rebindSessionSink(s, (f) => secondAttempt.push(f));

    expect(secondAttempt).toEqual([textFrame(1), textFrame(2)]);
    expect(s.buffer).toEqual([]);
    expect(s.detached).toBe(false);
  });
});

describe("rebindSessionSink — synthetic done rule", () => {
  test("a rebind between turns (turnActive: false) appends a synthetic done", () => {
    const s = makeSession({ detached: true, buffer: [], turnActive: false });
    const received: ChatFrame[] = [];

    rebindSessionSink(s, (f) => received.push(f));

    expect(received).toEqual([{ type: "done" }]);
  });

  test("a rebind mid-turn (turnActive: true) does NOT append a synthetic done", () => {
    const s = makeSession({ detached: true, buffer: [], turnActive: true });
    const received: ChatFrame[] = [];

    rebindSessionSink(s, (f) => received.push(f));

    expect(received).toEqual([]);
    // Not just "no done frame arrived" — the rebind must have actually succeeded (reattached),
    // otherwise this could pass on a no-op that never called sink at all.
    expect(s.detached).toBe(false);
  });

  test("a between-turns rebind flushes buffered frames THEN appends the synthetic done last", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: false });
    const received: ChatFrame[] = [];

    rebindSessionSink(s, (f) => received.push(f));

    expect(received).toEqual([...buffered, { type: "done" }]);
  });

  test("a between-turns rebind still attempts the synthetic done even when an earlier frame in the same flush failed", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: false });
    const received: ChatFrame[] = [];
    const sink: ChatSink = (f) => {
      received.push(f);
      if ((f as { text: string }).text === "f0") throw new Error("write failed");
    };

    rebindSessionSink(s, sink);

    // f0 attempted (and threw), f1 retained for retry — but the synthetic done must STILL have
    // been attempted: the f0 failure proved nothing about whether this later, unrelated write (a
    // fresh { type: "done" } object) would also fail.
    expect(received).toEqual([textFrame(0), { type: "done" }]);
  });

  test("a sink that throws only on the synthetic done still delivers the buffered frames first", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: false });
    const received: ChatFrame[] = [];
    const doneThrowingSink: ChatSink = (f) => {
      if (f.type === "done") throw new Error("socket died on the very last write");
      received.push(f);
    };

    // The catch around the synthetic-done write must swallow this — it must not propagate out of
    // rebindSessionSink (that would crash whatever WS-open handler called it).
    expect(() => rebindSessionSink(s, doneThrowingSink)).not.toThrow();
    // And the flush that happened BEFORE the failed done write must still have gone through.
    expect(received).toEqual(buffered);
  });
});

describe("rebindSessionSink — re-entrancy during flush", () => {
  test("a frame emitted mid-flush lands in the fresh buffer, not the sink (documented, not a bug)", () => {
    // s.detached is only cleared AFTER the flush loop finishes, so a sink that calls back into
    // emit() while still mid-flush observes detached===true and buffers instead of being written
    // straight through — it will replay on the NEXT rebind, out of order relative to frames the
    // current flush delivers after it. Pinned here so a refactor can't silently change this.
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: true });
    const received: ChatFrame[] = [];
    const reentrantSink: ChatSink = (f) => {
      received.push(f);
      if ((f as { text: string }).text === "f0") emit(s, textFrame(99));
    };

    rebindSessionSink(s, reentrantSink);

    expect(received).toEqual([textFrame(0), textFrame(1)]);
    expect(s.buffer).toEqual([textFrame(99)]);
  });
});

describe("reattachSessionSink", () => {
  test("re-points the sink, flushes the buffered tail, and clears detached — WITHOUT a synthetic done", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: false });
    const received: ChatFrame[] = [];

    reattachSessionSink(s, (f) => received.push(f));

    // This is the exact gap the four sendMessage reopen paths used to leave open: they did
    // `sink = sink; detached = false` inline with NO flush at all, stranding the buffered tail if
    // the user typed a new message instead of the socket reconnecting first.
    expect(received).toEqual(buffered);
    expect(s.buffer).toEqual([]);
    expect(s.detached).toBe(false);
  });

  test("does NOT append a synthetic done even between turns (unlike rebindSessionSink)", () => {
    const s = makeSession({ detached: true, buffer: [], turnActive: false });
    const received: ChatFrame[] = [];

    reattachSessionSink(s, (f) => received.push(f));

    // Same turnActive:false condition that makes rebindSessionSink push a done — reattach must NOT,
    // since a new turn starts right after this call and would supersede it.
    expect(received).toEqual([]);
  });

  test("cancels a pending close timer, same as rebindSessionSink", async () => {
    let closed = false;
    const s = makeSession({ turnActive: true });
    scheduleSessionClose(s, 15, () => {
      closed = true;
    });
    expect(s.closeTimer).toBeDefined();

    reattachSessionSink(s, () => {});

    expect(s.closeTimer).toBeUndefined();
    await sleep(50);
    expect(closed).toBe(false);
  });
});

describe("scheduleSessionClose / timer cancellation", () => {
  test("control: fires close() after the delay when nothing cancels it", async () => {
    let closed = false;
    const s = makeSession();

    scheduleSessionClose(s, 10, () => {
      closed = true;
    });
    await sleep(50);

    expect(closed).toBe(true);
  });

  test("a rebind cancels a pending close timer so a live socket is not torn down", async () => {
    let closed = false;
    const s = makeSession({ turnActive: true });

    scheduleSessionClose(s, 15, () => {
      closed = true;
    });
    expect(s.closeTimer).toBeDefined();

    rebindSessionSink(s, () => {});

    expect(s.closeTimer).toBeUndefined();
    await sleep(50);
    expect(closed).toBe(false);
  });

  test("scheduling a new close cancels a previously pending one (only the latest fires)", async () => {
    const fired: string[] = [];
    const s = makeSession();

    scheduleSessionClose(s, 10, () => fired.push("first"));
    scheduleSessionClose(s, 20, () => fired.push("second"));
    await sleep(60);

    expect(fired).toEqual(["second"]);
  });
});
