import { describe, expect, it, test } from "bun:test";
import {
  computeAlwaysOnSet,
  renderedPixelRadius,
  selectVisibleLabels,
  type LabelCandidate,
} from "./labelSelection";

type N = { id: string; kind: "note" | "memory" | "agent" | "tag" };
type E = { source: string; target: string };

const node = (id: string, kind: N["kind"] = "note"): N => ({ id, kind });
const edge = (a: string, b: string): E => ({ source: a, target: b });

describe("computeAlwaysOnSet", () => {
  it("returns an empty set for an empty graph", () => {
    const set = computeAlwaysOnSet([], [], null, 10);
    expect(set.size).toBe(0);
  });

  it("returns an empty set when there are no hubs and no active file", () => {
    const nodes: N[] = [node("a"), node("b")];
    const set = computeAlwaysOnSet(nodes, [], null, 0);
    expect(set.size).toBe(0);
  });

  it("includes the active file when present in nodes", () => {
    const nodes: N[] = [node("a"), node("b")];
    const set = computeAlwaysOnSet(nodes, [], "a", 0);
    expect(set.has("a")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("omits an active file id that is not in the node list", () => {
    const nodes: N[] = [node("a"), node("b")];
    const set = computeAlwaysOnSet(nodes, [], "missing", 0);
    expect(set.has("missing")).toBe(false);
  });

  it("picks the top-N nodes by edge degree", () => {
    // a has 3 edges, b has 2, c has 1, d has 0
    const nodes: N[] = [node("a"), node("b"), node("c"), node("d"), node("e")];
    const edges: E[] = [
      edge("a", "b"),
      edge("a", "c"),
      edge("a", "e"),
      edge("b", "e"),
    ];
    const set = computeAlwaysOnSet(nodes, edges, null, 2);
    expect(set.has("a")).toBe(true); // degree 3
    expect(set.has("b")).toBe(true); // degree 2
    expect(set.has("c")).toBe(false);
    expect(set.has("d")).toBe(false);
  });

  it("breaks degree ties deterministically by id (lexicographic)", () => {
    // a and b each have degree 1 (the single a-b edge)
    const nodes: N[] = [node("a"), node("b"), node("c")];
    const edges: E[] = [edge("a", "b")];
    // hubCount = 1 should pick a (lexicographically first) deterministically
    const set = computeAlwaysOnSet(nodes, edges, null, 1);
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
  });

  it("clamps hubCount to total node count", () => {
    const nodes: N[] = [node("a"), node("b")];
    const edges: E[] = [edge("a", "b")];
    const set = computeAlwaysOnSet(nodes, edges, null, 999);
    expect(set.size).toBe(2);
  });

  it("supports edge endpoints as objects (post-d3 resolution)", () => {
    // d3-force replaces source/target with node objects after the first tick
    const nodes: N[] = [node("a"), node("b")];
    const edges = [
      { source: { id: "a" }, target: { id: "b" } } as unknown as E,
    ];
    const set = computeAlwaysOnSet(nodes, edges, null, 1);
    expect(set.has("a") || set.has("b")).toBe(true);
  });
});

const C = (o: Partial<LabelCandidate> & { id: string }): LabelCandidate => ({
  px: 0, py: 0, w: 40, h: 12, renderedPx: 10, forced: false, ...o,
});
const OPTS = { thresholdPx: 6, gridCell: 64, perCell: 1 };

test("rendered size grows with degree-scale and with zoom-in (smaller worldPerPixel)", () => {
  expect(renderedPixelRadius(10, 2, 60, 1)).toBeGreaterThan(renderedPixelRadius(10, 1, 60, 1));
  expect(renderedPixelRadius(10, 1, 60, 0.5)).toBeGreaterThan(renderedPixelRadius(10, 1, 60, 1));
});

test("selection is independent of position/radius-from-center", () => {
  // Two identical nodes, one centered one far off-center, far apart so no grid collision.
  const centered = C({ id: "center", px: 500, py: 500, renderedPx: 10 });
  const rim = C({ id: "rim", px: 40, py: 40, renderedPx: 10 });
  const got = selectVisibleLabels([centered, rim], OPTS);
  expect(got.has("center")).toBe(true);
  expect(got.has("rim")).toBe(true); // position must NOT decide
});

test("below threshold is dropped unless forced", () => {
  const small = C({ id: "small", px: 100, py: 100, renderedPx: 3 });
  expect(selectVisibleLabels([small], OPTS).has("small")).toBe(false);
  const forced = C({ id: "small", px: 100, py: 100, renderedPx: 3, forced: true });
  expect(selectVisibleLabels([forced], OPTS).has("small")).toBe(true);
});

test("grid cap keeps the worthiest (largest renderedPx) in a contested cell", () => {
  const big = C({ id: "big", px: 10, py: 10, renderedPx: 30 });
  const small = C({ id: "small", px: 12, py: 12, renderedPx: 8 });
  const got = selectVisibleLabels([big, small], OPTS);
  expect(got.has("big")).toBe(true);
  expect(got.has("small")).toBe(false);
});

test("forced labels survive a contested cell alongside the worthiest", () => {
  const big = C({ id: "big", px: 10, py: 10, renderedPx: 30 });
  const forcedSmall = C({ id: "f", px: 12, py: 12, renderedPx: 1, forced: true });
  const got = selectVisibleLabels([big, forcedSmall], OPTS);
  expect(got.has("f")).toBe(true);
});
