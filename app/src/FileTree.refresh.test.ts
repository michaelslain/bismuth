// app/src/FileTree.refresh.test.ts
//
// Regression for B3: the file-tree's SSE-driven refresh must not clobber an
// optimistic move/rename/create/delete with a stale /tree snapshot taken before
// the mutation landed on the server. FileTree gates the refetch on editing /
// dragging / `pendingOps` (count of in-flight optimistic ops). While any holds,
// the decision is to DEFER — return refetch:false WITHOUT advancing `lastSeen`,
// so the change is re-applied once the guard clears (the effect re-runs because
// those signals are tracked).
//
// We test the pure decision function `decideTreeRefresh` directly, threading
// `lastSeen` the way the effect does, so the assertions don't depend on Solid's
// (asynchronous) effect scheduling.
//
// FileTree → serverVersion.ts opens an EventSource at module load, which is
// undefined in Bun's test runtime; stub it before dynamically importing.
import { describe, expect, it, beforeAll } from "bun:test";

let decideTreeRefresh: typeof import("./FileTree").decideTreeRefresh;

beforeAll(async () => {
  if (!(globalThis as { EventSource?: unknown }).EventSource) {
    (globalThis as { EventSource?: unknown }).EventSource = class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      close() {}
    };
  }
  ({ decideTreeRefresh } = await import("./FileTree"));
});

const idle = { editing: false, dragging: false, pendingOps: 0 };

describe("decideTreeRefresh (B3 gating)", () => {
  it("refetches on a fresh structural change when idle, advancing lastSeen", () => {
    const d = decideTreeRefresh({ change: { version: 1 }, lastSeen: 0, ...idle });
    expect(d).toEqual({ refetch: true, nextLastSeen: 1 });
  });

  it("ignores a version it has already seen", () => {
    const d = decideTreeRefresh({ change: { version: 3 }, lastSeen: 3, ...idle });
    expect(d).toEqual({ refetch: false, nextLastSeen: 3 });
  });

  it("DEFERS while an optimistic op is in flight (no refetch, lastSeen unchanged)", () => {
    const d = decideTreeRefresh({ change: { version: 1 }, lastSeen: 0, ...idle, pendingOps: 1 });
    expect(d).toEqual({ refetch: false, nextLastSeen: 0 });
  });

  it("catches up exactly once after the op settles, using the deferred version", () => {
    // Mid-flight: stale snapshot arrives, deferred (lastSeen stays 0).
    const mid = decideTreeRefresh({ change: { version: 1 }, lastSeen: 0, ...idle, pendingOps: 1 });
    expect(mid).toEqual({ refetch: false, nextLastSeen: 0 });
    // Op settles → effect re-runs with the SAME change; now it refetches.
    const after = decideTreeRefresh({ change: { version: 1 }, lastSeen: mid.nextLastSeen, ...idle });
    expect(after).toEqual({ refetch: true, nextLastSeen: 1 });
    // A spurious re-run on the now-consumed version must not refetch again.
    const again = decideTreeRefresh({ change: { version: 1 }, lastSeen: after.nextLastSeen, ...idle });
    expect(again).toEqual({ refetch: false, nextLastSeen: 1 });
  });

  it("still defers while editing and while dragging (pre-existing behavior)", () => {
    expect(decideTreeRefresh({ change: { version: 1 }, lastSeen: 0, ...idle, editing: true }))
      .toEqual({ refetch: false, nextLastSeen: 0 });
    expect(decideTreeRefresh({ change: { version: 1 }, lastSeen: 0, ...idle, dragging: true }))
      .toEqual({ refetch: false, nextLastSeen: 0 });
  });

  it("skips a content-only change (dirty.tree === false) but consumes the version", () => {
    const d = decideTreeRefresh({ change: { version: 1, dirty: { tree: false } }, lastSeen: 0, ...idle });
    expect(d).toEqual({ refetch: false, nextLastSeen: 1 });
  });

  it("refetches when dirty is absent (poll/reconnect: extent unknown)", () => {
    const d = decideTreeRefresh({ change: { version: 2 }, lastSeen: 1, ...idle });
    expect(d).toEqual({ refetch: true, nextLastSeen: 2 });
  });

  it("refetches a structural change (dirty.tree === true)", () => {
    const d = decideTreeRefresh({ change: { version: 2, dirty: { tree: true } }, lastSeen: 1, ...idle });
    expect(d).toEqual({ refetch: true, nextLastSeen: 2 });
  });
});
