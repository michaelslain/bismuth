// app/src/graph/lod.test.ts
//
// Pure LOD math: the per-level aggregate structure (buildLodIndex), the aggregate-edge weight
// scale, the entity mass form (sqrt-scaled radii, ramp glyphs), and — most load-bearing — the
// LEVEL MAPPING of the zoom ladder (lodMix): which hierarchy level owns the field at each stop,
// and where the leaves take over. AsciiGraphRenderer.test.ts covers the same behaviour end to end
// through the raster buffers; this file pins the arithmetic directly.
import { describe, expect, it } from "bun:test";
import {
  AGG_EDGE_DOUBLE_W, aggEdgeWeight, buildLodIndex, LOD_MIN_CLUSTER, lodMix, massCellAlpha, massCellCode, massRadii,
} from "./lod";
import { FILE_LABEL_REVEAL_T } from "./labelSelection";
import { CELL_H, CELL_W } from "./asciiGrid";

/** Two-level fixture: TOP 0 = {a0..a3 at x≈-100} + {b0,b1 at x≈-60}, TOP 1 = {c0..c2 at x≈100}.
 *  Cross-links: 3 between the tops (a–c), 2 inside TOP 0 (a–b).
 *  NOTE its sub-clusters are 2-4 members, i.e. below the shipped `LOD_MIN_CLUSTER`, so the grouping
 *  tests below pass `minCluster: 1` explicitly — they pin the grouping/centroid/edge ARITHMETIC, which
 *  is independent of the "don't summarize a 1-note cluster" product gate (tested separately). */
function nodes() {
  const out = [];
  for (let i = 0; i < 4; i++) out.push({ id: `a${i}`, path: [0, 0], x: -100, y: i * 10 });
  for (let i = 0; i < 2; i++) out.push({ id: `b${i}`, path: [0, 1], x: -60, y: i * 10 });
  for (let i = 0; i < 3; i++) out.push({ id: `c${i}`, path: [1, 2], x: 100, y: i * 10 });
  return out;
}
const edges = [
  { from: "a0", to: "c0" }, { from: "a1", to: "c1" }, { from: "a2", to: "c2" }, // 3 cross-top
  { from: "a0", to: "b0" }, { from: "a1", to: "b1" },                            // 2 intra-top, cross-sub
  { from: "a0", to: "a1" },                                                      // 1 intra-sub (no aggregate)
];

describe("buildLodIndex — aggregate entities", () => {
  it("groups per level with correct counts and member ids, largest cluster first", () => {
    const levels = buildLodIndex(nodes(), edges, 1);
    expect(levels.length).toBe(2);
    // Level 0: TOP 0 (6 members) before TOP 1 (3).
    expect(levels[0].clusters.map((c) => [c.community, c.count])).toEqual([[0, 6], [1, 3]]);
    expect(new Set(levels[0].clusters[0].memberIds)).toEqual(new Set(["a0", "a1", "a2", "a3", "b0", "b1"]));
    // Level 1: sub 0 (4) then sub 2 (3) then sub 1 (2).
    expect(levels[1].clusters.map((c) => [c.community, c.count])).toEqual([[0, 4], [2, 3], [1, 2]]);
  });

  it("positions every entity at its members' centroid", () => {
    const levels = buildLodIndex(nodes(), edges, 1);
    const top0 = levels[0].clusters.find((c) => c.community === 0)!;
    // (4×-100 + 2×-60) / 6
    expect(top0.wx).toBeCloseTo((4 * -100 + 2 * -60) / 6, 10);
    const sub2 = levels[1].clusters.find((c) => c.community === 2)!;
    expect(sub2.wx).toBeCloseTo(100, 10);
    expect(sub2.wy).toBeCloseTo(10, 10);
  });

  it("aggregates inter-cluster links per level with real counts (intra-cluster links never count)", () => {
    const levels = buildLodIndex(nodes(), edges, 1);
    // Level 0: ONE connector — the 3 a–c links; the a–b and a–a links live inside TOP 0.
    expect(levels[0].edges.length).toBe(1);
    expect(levels[0].edges[0].count).toBe(3);
    expect(levels[0].edges[0].w).toBe(1); // the level's heaviest connector reads full
    // Level 1: sub0–sub2 (3 links) and sub0–sub1 (2 links); a0–a1 stays inside sub 0.
    const l1 = levels[1].edges.map((e) => e.count).sort((x, y) => y - x);
    expect(l1).toEqual([3, 2]);
    const heavy = levels[1].edges.find((e) => e.count === 3)!;
    const light = levels[1].edges.find((e) => e.count === 2)!;
    expect(heavy.w).toBe(1);
    expect(light.w).toBeCloseTo(Math.log1p(2) / Math.log1p(3), 10);
    expect(light.w).toBeLessThan(heavy.w);
  });

  it("returns an empty structure when no node carries a hierarchy (LOD off)", () => {
    expect(buildLodIndex([{ id: "x", x: 0, y: 0 }], [])).toEqual([]);
  });

  it("omits communities under LOD_MIN_CLUSTER — a summary view is not a scatter of 1-note dots", () => {
    // The reference vault has 143 fully-isolated notes; as singleton communities at every level they
    // turned the coarsest stop into 15 real masses plus 143 unnamed, indistinguishable dots.
    const many = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `big${i}`, path: [0, 0], x: 0, y: i })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `orphan${i}`, path: [i + 1, i + 1], x: 500, y: i })),
    ];
    const gated = buildLodIndex(many, []);
    expect(gated[0].clusters.map((c) => c.count)).toEqual([8]);
    // ...and the gate is exactly the shipped constant, not an ad-hoc number.
    expect(LOD_MIN_CLUSTER).toBe(4);
    // With the gate opened, every singleton comes back — so the omission really is the gate.
    expect(buildLodIndex(many, [], 1)[0].clusters.length).toBe(21);
  });

  it("drops aggregate edges whose endpoint community was gated out", () => {
    const ns = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, path: [0], x: 0, y: i })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, path: [1], x: 100, y: i })),
      { id: "lonely", path: [2], x: 200, y: 0 },
    ];
    const es = [{ from: "a0", to: "b0" }, { from: "a1", to: "lonely" }];
    const levels = buildLodIndex(ns, es);
    expect(levels[0].clusters.length).toBe(2);   // "lonely" is not summarized
    expect(levels[0].edges.length).toBe(1);      // ...so neither is its connector
    expect(levels[0].edges[0].count).toBe(1);
  });
});

describe("aggEdgeWeight", () => {
  it("is log-scaled into 0..1 against the level's heaviest connector", () => {
    expect(aggEdgeWeight(0, 10)).toBe(0);
    expect(aggEdgeWeight(10, 10)).toBe(1);
    expect(aggEdgeWeight(1, 1)).toBe(1);
    const w3 = aggEdgeWeight(3, 100), w30 = aggEdgeWeight(30, 100);
    expect(w3).toBeGreaterThan(0);
    expect(w30).toBeGreaterThan(w3);
    expect(w30).toBeLessThan(1);
  });

  it("the doubling threshold sits strictly inside the scale (some edges double, some do not)", () => {
    expect(AGG_EDGE_DOUBLE_W).toBeGreaterThan(0);
    expect(AGG_EDGE_DOUBLE_W).toBeLessThan(1);
  });
});

describe("massRadii — sqrt-scaled entity size", () => {
  it("grows ~with sqrt(count), never below the 1-row/2-col minimum", () => {
    const tiny = massRadii(1, CELL_W, CELL_H);
    expect(tiny.rowR).toBe(1);
    expect(tiny.colR).toBeGreaterThanOrEqual(2);
    const mid = massRadii(120, CELL_W, CELL_H);
    const big = massRadii(480, CELL_W, CELL_H);
    expect(mid.rowR).toBeGreaterThan(tiny.rowR);
    // 4x the members ≈ 2x the radius (sqrt scaling, ±1 cell of rounding), nowhere near 4x.
    expect(Math.abs(big.rowR - mid.rowR * 2)).toBeLessThanOrEqual(1);
  });

  it("stretches the column radius by the cell aspect so the mass reads round", () => {
    const { rowR, colR } = massRadii(200, CELL_W, CELL_H);
    expect(colR).toBeGreaterThan(rowR); // cells are ~2.9x taller than wide
  });
});

describe("mass form — the degree-ramp vocabulary, core to fringe", () => {
  it("uses '@' core, 'o' body, '.' fringe by normalized radius", () => {
    expect(String.fromCharCode(massCellCode(0))).toBe("@");
    expect(String.fromCharCode(massCellCode(0.5))).toBe("o");
    expect(String.fromCharCode(massCellCode(0.9))).toBe(".");
  });

  it("fades alpha outward (solid core, soft fringe)", () => {
    expect(massCellAlpha(0)).toBe(1);
    expect(massCellAlpha(0.5)).toBeLessThan(1);
    expect(massCellAlpha(0.9)).toBeLessThan(massCellAlpha(0.5));
  });
});

describe("lodMix — the ladder-onto-levels mapping (level selection per stop)", () => {
  /** The dominant level at progress t, or "leaves". */
  function owner(t: number, levelCount: number): string {
    const { levelAlphas, leafAlpha } = lodMix(t, levelCount);
    let best = -1, bestA = leafAlpha;
    for (let i = 0; i < levelAlphas.length; i++) if (levelAlphas[i] > bestA) { best = i; bestA = levelAlphas[i]; }
    return best === -1 ? "leaves" : `L${best}`;
  }

  it("walks coarsest → finest → leaves across the stops, for the reference 3-level shape", () => {
    // Stops are t = 0, 0.1, …, 1 (10% each). With FILE_LABEL_REVEAL_T = 0.6 and 3 levels the
    // segments are 0.2 wide: L0 owns 100–90%, L1 80–70%, L2 60–40%, leaves ~30%–0%.
    expect(owner(0.0, 3)).toBe("L0");   // 100%
    expect(owner(0.1, 3)).toBe("L0");   // 90%
    expect(owner(0.2, 3)).toBe("L1");   // 80%
    expect(owner(0.3, 3)).toBe("L1");   // 70%
    expect(owner(0.4, 3)).toBe("L2");   // 60%
    expect(owner(0.5, 3)).toBe("L2");   // 50%
    expect(owner(0.6, 3)).toBe("L2");   // 40% — the reveal point itself still belongs to entities
    expect(owner(0.8, 3)).toBe("leaves"); // 20%
    expect(owner(1.0, 3)).toBe("leaves"); // 0%
  });

  it("entities own everything below the reveal point and are fully gone once leaves saturate", () => {
    for (const t of [0, 0.2, 0.4, FILE_LABEL_REVEAL_T]) {
      const { levelAlphas, leafAlpha } = lodMix(t, 3);
      expect(leafAlpha).toBe(0);
      expect(levelAlphas.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    }
    const deep = lodMix(1, 3);
    expect(deep.leafAlpha).toBe(1);
    expect(deep.levelAlphas.every((a) => a === 0)).toBe(true);
  });

  it("total drawn weight is conserved through every crossfade (entities + leaves sum to 1)", () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const { levelAlphas, leafAlpha } = lodMix(t, 4);
      const total = levelAlphas.reduce((a, b) => a + b, 0) + leafAlpha;
      expect(total).toBeCloseTo(1, 8);
    }
  });

  it("a 1-level graph is a single entity tier crossfading straight into leaves", () => {
    expect(lodMix(0, 1)).toEqual({ levelAlphas: [1], leafAlpha: 0 });
    const deep = lodMix(1, 1);
    expect(deep.levelAlphas[0]).toBe(0);
    expect(deep.leafAlpha).toBe(1);
  });
});
