// app/src/connectionState.test.ts
//
// github issue #3: "connection lost — polling" could get stuck forever. Root
// cause: the poll's success path never told connectionState/the toast that
// the backend was actually reachable — only es.onopen did. See
// connectionState.ts's header comment for the full story.
//
// decideConnectionState is a pure function extracted to its own module (same
// pattern as fileTreeRefresh.ts's decideTreeRefresh), so this test imports it
// directly rather than serverVersion.ts, which opens a real EventSource and
// starts a poll `setInterval` at import time.
import { describe, expect, it } from "bun:test";
import { decideConnectionState } from "./connectionState";

describe("decideConnectionState", () => {
  // --- the bug (github issue #3) ------------------------------------------

  it("a poll success while disconnected returns to connected and dismisses the notice", () => {
    const d = decideConnectionState({
      state: "disconnected",
      event: "poll-success",
      everConnected: true,
      toastShown: true,
    });
    expect(d.nextState).toBe("connected");
    expect(d.dismissToast).toBe(true);
    expect(d.showToast).toBe(false);
    expect(d.pollInterval).toBe("normal");
  });

  it("a poll success while reconnecting (mid stalled SSE handshake) also recovers", () => {
    const d = decideConnectionState({
      state: "reconnecting",
      event: "poll-success",
      everConnected: true,
      toastShown: true,
    });
    expect(d.nextState).toBe("connected");
    expect(d.dismissToast).toBe(true);
  });

  // --- preserved behaviors --------------------------------------------------

  it("es.onopen still recovers from disconnected", () => {
    const d = decideConnectionState({
      state: "disconnected",
      event: "sse-open",
      everConnected: true,
      toastShown: true,
    });
    expect(d.nextState).toBe("connected");
    expect(d.dismissToast).toBe(true);
    expect(d.pollInterval).toBe("normal");
  });

  it("es.onopen still recovers from reconnecting", () => {
    const d = decideConnectionState({
      state: "reconnecting",
      event: "sse-open",
      everConnected: true,
      toastShown: true,
    });
    expect(d.nextState).toBe("connected");
    expect(d.dismissToast).toBe(true);
  });

  it("a poll failure while connected goes to disconnected and shows the notice", () => {
    const d = decideConnectionState({
      state: "connected",
      event: "poll-failure",
      everConnected: true,
      toastShown: false,
    });
    expect(d.nextState).toBe("disconnected");
    expect(d.showToast).toBe(true);
    expect(d.pollInterval).toBe("fast");
  });

  it("an sse error while connected goes to disconnected and shows the notice", () => {
    const d = decideConnectionState({
      state: "connected",
      event: "sse-error",
      everConnected: true,
      toastShown: false,
    });
    expect(d.nextState).toBe("disconnected");
    expect(d.showToast).toBe(true);
    expect(d.pollInterval).toBe("fast");
  });

  it("a repeated poll success while already connected does not re-dismiss or re-toast", () => {
    const d = decideConnectionState({
      state: "connected",
      event: "poll-success",
      everConnected: true,
      toastShown: false,
    });
    expect(d.nextState).toBe("connected");
    expect(d.dismissToast).toBe(false);
    expect(d.showToast).toBe(false);
    expect(d.pollInterval).toBe("normal");
  });

  it("a repeated sse error while already disconnected does not re-toast (dedup)", () => {
    const d = decideConnectionState({
      state: "disconnected",
      event: "sse-error",
      everConnected: true,
      toastShown: true,
    });
    expect(d.nextState).toBe("disconnected");
    expect(d.showToast).toBe(false); // already showing — no duplicate
  });

  it("suppresses the toast until the backend has ever been reached (cold-launch warmup)", () => {
    const d = decideConnectionState({
      state: "connected",
      event: "sse-error",
      everConnected: false,
      toastShown: false,
    });
    expect(d.showToast).toBe(false);
    expect(d.nextState).toBe("disconnected"); // still tracks state, just no scary toast
  });

  it("poll-failure also suppresses the toast during cold-launch warmup", () => {
    const d = decideConnectionState({
      state: "connected",
      event: "poll-failure",
      everConnected: false,
      toastShown: false,
    });
    expect(d.showToast).toBe(false);
  });

  it("everConnected becomes true (sticky) on sse-open and poll-success, and is preserved on errors", () => {
    expect(
      decideConnectionState({ state: "disconnected", event: "sse-open", everConnected: false, toastShown: false })
        .everConnected
    ).toBe(true);
    expect(
      decideConnectionState({ state: "disconnected", event: "poll-success", everConnected: false, toastShown: false })
        .everConnected
    ).toBe(true);
    expect(
      decideConnectionState({ state: "connected", event: "sse-error", everConnected: true, toastShown: false })
        .everConnected
    ).toBe(true);
  });
});
