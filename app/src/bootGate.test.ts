// app/src/bootGate.test.ts
import { test, expect } from "bun:test";
import { canDismissBoot, createBootGate } from "./bootGate";

test("canDismissBoot: home tab shows the graph — data alone is NOT enough, needs paint too", () => {
  expect(canDismissBoot({ dataReady: true, graphMounts: true, graphPainted: false, hidden: false, paintWaitExpired: false, timedOut: false })).toBe(false);
  expect(canDismissBoot({ dataReady: true, graphMounts: true, graphPainted: true, hidden: false, paintWaitExpired: false, timedOut: false })).toBe(true);
});

test("canDismissBoot: graph is not the home tab — data-ready alone dismisses", () => {
  expect(canDismissBoot({ dataReady: true, graphMounts: false, graphPainted: false, hidden: false, paintWaitExpired: false, timedOut: false })).toBe(true);
  expect(canDismissBoot({ dataReady: false, graphMounts: false, graphPainted: false, hidden: false, paintWaitExpired: false, timedOut: false })).toBe(false);
});

test("canDismissBoot: a backgrounded launch bypasses the paint wait (nothing visible to strand)", () => {
  expect(canDismissBoot({ dataReady: true, graphMounts: true, graphPainted: false, hidden: true, paintWaitExpired: false, timedOut: false })).toBe(true);
  // Still gated on data readiness even while hidden.
  expect(canDismissBoot({ dataReady: false, graphMounts: true, graphPainted: false, hidden: true, paintWaitExpired: false, timedOut: false })).toBe(false);
});

test("canDismissBoot: paintWaitExpired bypasses the paint wait like hidden does", () => {
  expect(canDismissBoot({ dataReady: true, graphMounts: true, graphPainted: false, hidden: false, paintWaitExpired: true, timedOut: false })).toBe(true);
  // Still gated on data readiness even if the fallback already fired.
  expect(canDismissBoot({ dataReady: false, graphMounts: true, graphPainted: false, hidden: false, paintWaitExpired: true, timedOut: false })).toBe(false);
});

test("canDismissBoot: the timeout backstop overrides every other signal", () => {
  expect(canDismissBoot({ dataReady: false, graphMounts: true, graphPainted: false, hidden: false, paintWaitExpired: false, timedOut: true })).toBe(true);
});

test("createBootGate (a): dismisses only after paint when the graph IS the home tab", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: true, onDismiss: () => calls++ });
  gate.setDataReady(true);
  expect(gate.dismissed).toBe(false);
  expect(calls).toBe(0);
  gate.setGraphPainted(true);
  expect(gate.dismissed).toBe(true);
  expect(calls).toBe(1);
});

test("createBootGate (b): dismisses on data-ready when the graph is NOT the home tab", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: false, onDismiss: () => calls++ });
  expect(gate.dismissed).toBe(false);
  gate.setDataReady(true);
  expect(gate.dismissed).toBe(true);
  expect(calls).toBe(1);
});

test("createBootGate (c): never dismisses twice, however many signals arrive afterward", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: true, onDismiss: () => calls++ });
  gate.setDataReady(true);
  gate.setGraphPainted(true);
  expect(calls).toBe(1);
  // Further signal churn (a re-render, a second paint, a stray timeout) must not re-fire.
  gate.setGraphPainted(false);
  gate.setGraphPainted(true);
  gate.setDataReady(true);
  gate.setTimedOut(true);
  gate.setPaintWaitExpired(true);
  expect(calls).toBe(1);
  expect(gate.dismissed).toBe(true);
});

test("createBootGate (d): the timeout backstop still fires even if data/paint never arrive", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: true, onDismiss: () => calls++ });
  gate.setTimedOut(true);
  expect(gate.dismissed).toBe(true);
  expect(calls).toBe(1);
});

test("createBootGate: a backgrounded launch dismisses on data-ready without ever painting", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: true, onDismiss: () => calls++ });
  gate.setHidden(true);
  gate.setDataReady(true);
  expect(gate.dismissed).toBe(true);
  expect(calls).toBe(1);
});

// --- Regression coverage for the measured defect ------------------------------------------
//
// A real boot showed the splash starting to fade at 465ms over a BLANK canvas (graphNonBg 0),
// with the graph not actually appearing until ~968ms. Root cause: the renderer's early paint of
// the still-empty graph landed BEFORE the fetch resolved, latching graphPainted=true; the instant
// dataReady flipped, canDismissBoot saw graphPainted already true and opened the gate over that
// stale empty frame instead of waiting for a frame painted with the real data.

test("createBootGate: a paint BEFORE dataReady does not dismiss, and does not pre-satisfy the wait", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: true, onDismiss: () => calls++ });
  // The renderer's early empty-graph paint arrives first.
  gate.setGraphPainted(true);
  expect(gate.dismissed).toBe(false);
  expect(calls).toBe(0);
  // dataReady then flips — this must NOT "cash in" the earlier paint. The gate stays closed.
  gate.setDataReady(true);
  expect(gate.dismissed).toBe(false);
  expect(calls).toBe(0);
  // Only a NEW paint, arriving after dataReady, opens the gate.
  gate.setGraphPainted(true);
  expect(gate.dismissed).toBe(true);
  expect(calls).toBe(1);
});

test("createBootGate: a paint AFTER dataReady dismisses immediately", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: true, onDismiss: () => calls++ });
  gate.setDataReady(true);
  expect(gate.dismissed).toBe(false);
  gate.setGraphPainted(true);
  expect(gate.dismissed).toBe(true);
  expect(calls).toBe(1);
});

test("createBootGate: paintWaitExpired dismisses once dataReady is in, even with no paint at all", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: true, onDismiss: () => calls++ });
  gate.setDataReady(true);
  expect(gate.dismissed).toBe(false);
  gate.setPaintWaitExpired(true);
  expect(gate.dismissed).toBe(true);
  expect(calls).toBe(1);
});

test("createBootGate: paintWaitExpired arriving before dataReady still waits for dataReady", () => {
  let calls = 0;
  const gate = createBootGate({ graphMounts: true, onDismiss: () => calls++ });
  gate.setPaintWaitExpired(true);
  expect(gate.dismissed).toBe(false);
  gate.setDataReady(true);
  expect(gate.dismissed).toBe(true);
  expect(calls).toBe(1);
});
