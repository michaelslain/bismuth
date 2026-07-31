// Tests for the pure session-frame buffering shared by every chat provider
// (core/src/chatProviders/sessionSink.ts). No mock server, no CLI, no subprocess — this is the
// generic reconnect-buffering slice (emit/rebindSessionSink/scheduleSessionClose) that both the
// Claude chat driver (core/src/chat.ts) and the ACP/opencode providers hold verbatim, so a bug here
// silently loses a turn's output or wedges the streaming spinner on WHICHEVER backend the user
// picked, on every reconnect after a WS drop.
import { describe, expect, test } from "bun:test";
import type { ChatFrame, ChatSink } from "../../src/chat";
import {
  emit,
  MAX_BUFFERED_FRAMES,
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

  test("MAX_BUFFERED_FRAMES caps the buffer: keeps the earliest frames, drops the overflow", () => {
    const s = makeSession({ detached: true });
    const overflowBy = 5;
    const total = MAX_BUFFERED_FRAMES + overflowBy;

    for (let i = 0; i < total; i++) emit(s, textFrame(i));

    // Exact length, not "grew" or "some cap applied" — an off-by-one here (<=  vs <) would show up
    // as MAX_BUFFERED_FRAMES + 1.
    expect(s.buffer.length).toBe(MAX_BUFFERED_FRAMES);
    // Exact identity of what survived: the FIRST 2000, not the last 2000 (a wrong-end drop would
    // pass a bare length check but fail this).
    expect(s.buffer[0]).toEqual(textFrame(0));
    expect(s.buffer[MAX_BUFFERED_FRAMES - 1]).toEqual(textFrame(MAX_BUFFERED_FRAMES - 1));
    const survivingTexts = new Set(s.buffer.map((f) => (f as { text: string }).text));
    for (let i = MAX_BUFFERED_FRAMES; i < total; i++) {
      expect(survivingTexts.has(`f${i}`)).toBe(false);
    }
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

  test("a sink that throws mid-flush stops the flush and does not re-buffer what's left", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1), textFrame(2)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: true });
    const received: ChatFrame[] = [];
    const throwingSink: ChatSink = (f) => {
      received.push(f);
      if ((f as { text: string }).text === "f1") throw new Error("dead socket");
    };

    rebindSessionSink(s, throwingSink);

    // f0 delivered, f1 attempted (and threw), f2 never attempted.
    expect(received).toEqual([textFrame(0), textFrame(1)]);
    // The un-flushed tail is dropped, not requeued into the buffer.
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
  });

  test("a between-turns rebind flushes buffered frames THEN appends the synthetic done last", () => {
    const buffered: ChatFrame[] = [textFrame(0), textFrame(1)];
    const s = makeSession({ detached: true, buffer: [...buffered], turnActive: false });
    const received: ChatFrame[] = [];

    rebindSessionSink(s, (f) => received.push(f));

    expect(received).toEqual([...buffered, { type: "done" }]);
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
