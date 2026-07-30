import { describe, expect, it, test } from "bun:test";
import {
  computeAlwaysOnSet,
  renderedPixelRadius,
  selectVisibleLabels,
  fileLabelBudget,
  fileLabelAlpha,
  clusterLabelAlpha,
  clusterLabelText,
  CLUSTER_LABEL_MAX_CHARS,
  eyebrowWidthCells,
  clusterLevelAlphas,
  levelBoundaries,
  FILE_LABEL_REVEAL_T,
  FILE_LABEL_FADE_SPAN,
  FILE_LABEL_FULL_T,
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

// ---------------------------------------------------------------------------
// Zoom-driven cluster-name → file-name crossfade (labels appear later and fewer than the naive
// linear-from-zero budget the old code used).
// ---------------------------------------------------------------------------

describe("fileLabelBudget", () => {
  it("is zero at t = 0 (fully zoomed out) — no file names at all", () => {
    expect(fileLabelBudget(0, 500)).toBe(0);
  });

  it("is zero everywhere at/below the reveal threshold", () => {
    expect(fileLabelBudget(FILE_LABEL_REVEAL_T, 500)).toBe(0);
    expect(fileLabelBudget(FILE_LABEL_REVEAL_T - 0.1, 500)).toBe(0);
  });

  it("is zero when there are no candidates, regardless of t", () => {
    expect(fileLabelBudget(1, 0)).toBe(0);
  });

  it("stays small for a while right after the reveal point (only genuine hubs)", () => {
    const justPast = fileLabelBudget(FILE_LABEL_REVEAL_T + 0.05, 1000);
    // A slow-start curve: nowhere near proportional to how far past reveal we are.
    expect(justPast).toBeLessThan(50);
  });

  it("grows monotonically with t", () => {
    const ts = [0, 0.1, FILE_LABEL_REVEAL_T, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    let prev = -1;
    for (const t of ts) {
      const b = fileLabelBudget(t, 800);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it("reaches (essentially) every candidate by FILE_LABEL_FULL_T and stays there through t = 1", () => {
    expect(fileLabelBudget(FILE_LABEL_FULL_T, 400)).toBe(400);
    expect(fileLabelBudget(1, 400)).toBe(400);
  });

  it("is much less aggressive than a naive linear-from-zero ramp partway through", () => {
    // At the old code's LABEL_MIN=6-style low end, a linear budget would already be well past
    // zero; the new curve should still be holding back hard at, say, t = 0.5.
    const total = 1000;
    const linear = total * 0.5;
    expect(fileLabelBudget(0.5, total)).toBeLessThan(linear * 0.25);
  });
});

describe("fileLabelAlpha / clusterLabelAlpha", () => {
  it("file alpha is 0 and cluster alpha is 1 at t = 0", () => {
    expect(fileLabelAlpha(0)).toBe(0);
    expect(clusterLabelAlpha(0)).toBe(1);
  });

  it("file alpha is 0 and cluster alpha is 1 at/below the reveal threshold", () => {
    expect(fileLabelAlpha(FILE_LABEL_REVEAL_T)).toBe(0);
    expect(clusterLabelAlpha(FILE_LABEL_REVEAL_T)).toBe(1);
  });

  it("crossfade completes (file=1, cluster=0) by revealT + fadeSpan", () => {
    const doneT = FILE_LABEL_REVEAL_T + FILE_LABEL_FADE_SPAN;
    expect(fileLabelAlpha(doneT)).toBe(1);
    expect(clusterLabelAlpha(doneT)).toBe(0);
    expect(fileLabelAlpha(1)).toBe(1);
    expect(clusterLabelAlpha(1)).toBe(0);
  });

  it("the two always sum to 1 (a true crossfade, not independent fades)", () => {
    for (const t of [0, 0.1, 0.25, 0.3, 0.35, 0.45, 0.52, 0.7, 1]) {
      expect(fileLabelAlpha(t) + clusterLabelAlpha(t)).toBeCloseTo(1, 10);
    }
  });

  it("file alpha rises monotonically across the fade span", () => {
    let prev = -1;
    for (let t = FILE_LABEL_REVEAL_T; t <= FILE_LABEL_REVEAL_T + FILE_LABEL_FADE_SPAN; t += 0.02) {
      const a = fileLabelAlpha(t);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
  });
});

describe("clusterLabelText", () => {
  it("upper-cases the community name", () => {
    expect(clusterLabelText("reading list")).toBe("READING LIST");
  });

  it("is a no-op on an already-uppercase name", () => {
    expect(clusterLabelText("PROJECTS")).toBe("PROJECTS");
  });

  it("leaves a name at/under the cap unchanged besides casing", () => {
    expect(clusterLabelText("reading")).toBe("READING");
    const exact = "A".repeat(CLUSTER_LABEL_MAX_CHARS);
    expect(clusterLabelText(exact)).toBe(exact);
  });

  it("caps a long name at a WORD boundary, never mid-word, and never with an ellipsis", () => {
    const long = "A Very Long Cluster Name About Reading";
    const capped = clusterLabelText(long);
    expect(capped.length).toBeLessThanOrEqual(CLUSTER_LABEL_MAX_CHARS);
    expect(capped).toBe("A VERY LONG CLUSTER");
    expect(capped.endsWith("..")).toBe(false);
    // Every dropped trailing word is dropped WHOLE — the cut never lands inside a word.
    expect("A VERY LONG CLUSTER NAME ABOUT READING".startsWith(capped)).toBe(true);
  });

  it("never emits an ellipsis, ASCII or unicode", () => {
    const capped = clusterLabelText("A Very Long Cluster Name About Reading And Writing Things");
    expect(capped.includes("…")).toBe(false);
    expect(capped.includes("..")).toBe(false);
  });

  it("renders a single word whole when it alone exceeds the cap (rare)", () => {
    const capped = clusterLabelText("Supercalifragilisticexpialidocious");
    expect(capped).toBe("SUPERCALIFRAGILISTICEXPIALIDOCIOUS");
    expect(capped.length).toBeGreaterThan(CLUSTER_LABEL_MAX_CHARS);
  });

  it("is deterministic across calls", () => {
    const name = "Some Long Cluster Title That Definitely Needs Truncating";
    expect(clusterLabelText(name)).toBe(clusterLabelText(name));
  });

  it("respects a custom maxChars, still cutting at a word boundary with no ellipsis", () => {
    const capped = clusterLabelText("Reading List Projects", 10);
    expect(capped.length).toBeLessThanOrEqual(10);
    expect(capped).toBe("READING");
    expect(capped.endsWith("..")).toBe(false);
  });
});

describe("eyebrowWidthCells", () => {
  it("matches the design's reference numbers: 20 chars at 0.14em/11.5px/6.3px cell -> 26", () => {
    expect(eyebrowWidthCells(20, 0.14, 11.5, 6.3)).toBe(26);
  });

  it("is monotone (non-decreasing) in len", () => {
    let prev = 0;
    for (let len = 1; len <= 30; len++) {
      const w = eyebrowWidthCells(len, 0.14, 11.5, 6.3);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it("is always >= len (tracking only ever widens, never narrows)", () => {
    expect(eyebrowWidthCells(10, 0, 11.5, 6.3)).toBeGreaterThanOrEqual(10);
    expect(eyebrowWidthCells(10, 0.14, 11.5, 6.3)).toBeGreaterThanOrEqual(10);
    expect(eyebrowWidthCells(0, 0.14, 11.5, 6.3)).toBeGreaterThanOrEqual(0);
  });

  it("falls back to len for a degenerate cellW", () => {
    expect(eyebrowWidthCells(20, 0.14, 11.5, 0)).toBe(20);
    expect(eyebrowWidthCells(20, 0.14, 11.5, -1)).toBe(20);
    expect(eyebrowWidthCells(20, 0.14, 11.5, NaN)).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// N-level cluster-name ladder — generalizing the two-state cluster/file crossfade above to walk a
// graph's full communityPath depth (1..4 levels) as the camera zooms from 0 to FILE_LABEL_REVEAL_T.
// ---------------------------------------------------------------------------

describe("levelBoundaries", () => {
  it("splits [0, revealT) into levelCount even segments, ending exactly at revealT", () => {
    const b = levelBoundaries(4, FILE_LABEL_REVEAL_T);
    expect(b.length).toBe(5);
    expect(b[0]).toBe(0);
    expect(b[4]).toBeCloseTo(FILE_LABEL_REVEAL_T, 10);
    for (let i = 1; i < b.length; i++) expect(b[i] - b[i - 1]).toBeCloseTo(FILE_LABEL_REVEAL_T / 4, 10);
  });

  it("clamps a level count below 1 up to a single segment", () => {
    expect(levelBoundaries(0, FILE_LABEL_REVEAL_T)).toEqual([0, FILE_LABEL_REVEAL_T]);
  });
});

describe("clusterLevelAlphas", () => {
  it("a 1-level graph behaves exactly like the original two-tier crossfade: always fully 'current' below revealT", () => {
    expect(clusterLevelAlphas(0, 1)).toEqual([1]);
    expect(clusterLevelAlphas(0.29, 1)).toEqual([1]);
    expect(clusterLevelAlphas(0.5, 1)).toEqual([1]); // past revealT too — clusterLabelAlpha (not this fn) owns the overall fade-out
  });

  it("clamps a level count below 1 up to 1", () => {
    expect(clusterLevelAlphas(0, 0)).toEqual([1]);
  });

  it("is a true partition of unity below revealT, for any level count (a crossfade, never independent fades)", () => {
    for (const n of [1, 2, 3, 4]) {
      for (const t of [0, 0.02, 0.08, 0.15, 0.22, 0.29]) {
        const sum = clusterLevelAlphas(t, n).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 8);
      }
    }
  });

  it("opens on the coarsest level and closes on the finest as t sweeps toward revealT", () => {
    const n = 3;
    const b = levelBoundaries(n, FILE_LABEL_REVEAL_T);
    expect(clusterLevelAlphas(0, n)).toEqual([1, 0, 0]);
    const midLevel1 = (b[1] + b[2]) / 2; // comfortably inside level 1's own segment
    const a = clusterLevelAlphas(midLevel1, n);
    expect(a[1]).toBeGreaterThan(a[0]);
    expect(a[1]).toBeGreaterThan(a[2]);
    expect(clusterLevelAlphas(b[n] - 1e-6, n)[n - 1]).toBeCloseTo(1, 3); // finest owns it right at the reveal point
  });

  it("at/after revealT, only the finest level is nonzero — the outer file crossfade owns the handoff from there", () => {
    expect(clusterLevelAlphas(FILE_LABEL_REVEAL_T, 3)).toEqual([0, 0, 1]);
    expect(clusterLevelAlphas(1, 4)).toEqual([0, 0, 0, 1]);
  });
});
