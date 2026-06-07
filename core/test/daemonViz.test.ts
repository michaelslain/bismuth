import { test, expect } from "bun:test";
import { nodeVisualState, type DaemonVisual } from "../src/daemonViz";
import type { DaemonVizState } from "../src/graph";

const NOW = Date.parse("2026-06-05T12:00:00.000Z");

/** Build a DaemonVizState with sensible defaults, overridable per test. */
function state(overrides: Partial<DaemonVizState> = {}): DaemonVizState {
  return { enabled: true, running: false, lastResult: null, lastFiredMs: null, ...overrides };
}

test("disabled → dim base node, NO border (regardless of running / recency)", () => {
  expect(nodeVisualState(state({ enabled: false }), NOW)).toEqual({
    fill: "base",
    border: "none",
    opacity: 0.15,
  });
  // disabled wins even if it's nominally running / just fired
  expect(nodeVisualState(state({ enabled: false, running: true }), NOW)).toEqual({
    fill: "base",
    border: "none",
    opacity: 0.15,
  });
  expect(
    nodeVisualState(state({ enabled: false, lastResult: "success", lastFiredMs: NOW }), NOW),
  ).toEqual({ fill: "base", border: "none", opacity: 0.15 });
});

test("enabled, not running → base-fill node + a crisp palette border ring", () => {
  expect(nodeVisualState(state(), NOW)).toEqual({
    fill: "base",
    border: "palette",
    opacity: 1,
  });
});

test("running → solid palette fill, no border (beats plain enabled)", () => {
  expect(nodeVisualState(state({ running: true }), NOW)).toEqual({
    fill: "palette",
    border: "none",
    opacity: 1,
  });
});

test("lastResult / lastFiredMs are ignored — they no longer drive the encoding", () => {
  // An enabled, not-running node renders identically no matter the recency / past result.
  const fresh = nodeVisualState(state({ lastResult: "failed", lastFiredMs: NOW - 1000 }), NOW);
  const stale = nodeVisualState(state({ lastResult: "success", lastFiredMs: NOW - 99 * 60 * 60 * 1000 }), NOW);
  const never = nodeVisualState(state({ lastResult: null, lastFiredMs: null }), NOW);
  const expected: DaemonVisual = { fill: "base", border: "palette", opacity: 1 };
  expect(fresh).toEqual(expected);
  expect(stale).toEqual(expected);
  expect(never).toEqual(expected);
});

test("idle gets a border ring; running and disabled do not", () => {
  expect(nodeVisualState(state()).border).toBe("palette"); // enabled, not running
  expect(nodeVisualState(state({ running: true })).border).toBe("none");
  expect(nodeVisualState(state({ enabled: false })).border).toBe("none");
});

test("now is optional / unused — same result with or without it", () => {
  expect(nodeVisualState(state({ running: true }))).toEqual(nodeVisualState(state({ running: true }), NOW));
});
