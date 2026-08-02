// app/src/graph/lod.test.ts
//
// Pure LOD math: the per-level aggregate structure (buildLodIndex), the aggregate-edge weight
// scale, the entity mass form (sqrt-scaled radii, ramp glyphs), and — most load-bearing — the
// LEVEL MAPPING of the zoom ladder (lodMix): which hierarchy level owns the field at each stop,
// and where the leaves take over. AsciiGraphRenderer.test.ts covers the same behaviour end to end
// through the raster buffers; this file pins the arithmetic directly.
import { describe, expect, it } from "bun:test";
import {
  AGG_EDGE_DOUBLE_W, aggEdgeWeight, buildLodIndex, LOD_MIN_CLUSTER, LOD_REP_POINTS_K, lodMix, massCellAlpha,
  massCellCode, massRadii,
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

  it("records each entity's member SPREAD, not just its centroid — how big the summarized thing is", () => {
    // The phosphor bloom emits an aggregate as a cloud of this size (densityField.ts pushCloud);
    // emitted at the centroid alone it out-peaks the leaves it stands for and blacks out the field.
    const levels = buildLodIndex(nodes(), edges, 1);
    // TOP 0 = 4 members at x=-100 and 2 at x=-60. mean = -86.6…; population variance is computed
    // here from the fixture rather than copied off the implementation.
    const xs = [-100, -100, -100, -100, -60, -60];
    const ys = [0, 10, 20, 30, 0, 10];
    const pop = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length);
    };
    const top0 = levels[0].clusters.find((c) => c.community === 0)!;
    expect(top0.sdx).toBeCloseTo(pop(xs), 8);
    expect(top0.sdy).toBeCloseTo(pop(ys), 8);
    expect(top0.sdx).toBeGreaterThan(0);
    // A cluster whose members share an axis has ZERO spread on it — not a NaN, and not a fudge.
    const sub2 = levels[1].clusters.find((c) => c.community === 2)!; // all three at x = 100
    expect(sub2.sdx).toBe(0);
    expect(sub2.sdy).toBeCloseTo(pop([0, 10, 20]), 8);
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

describe("buildLodIndex — per-cluster representative points (reps)", () => {
  /** Weighted population sd of a rep set, on one axis — same population-variance formula the
   *  `pop()` helper above uses on raw members, just weighted. Used to compare a `reps` set's own
   *  implied spread against the cluster's real member spread (`sdx`/`sdy`), which the "records
   *  each entity's member SPREAD" test above already pins as the correct population sd of the raw
   *  fixture coordinates — so comparing against `c.sdx`/`c.sdy` here is comparing against
   *  independently-verified ground truth, not against this file's own new code. */
  function weightedPopSd(reps: { x: number; y: number; weight: number }[], axis: "x" | "y"): number {
    const W = reps.reduce((a, r) => a + r.weight, 0);
    const m = reps.reduce((a, r) => a + r.weight * r[axis], 0) / W;
    const v = reps.reduce((a, r) => a + r.weight * (r[axis] - m) * (r[axis] - m), 0) / W;
    return Math.sqrt(v);
  }

  it("reproduces the members EXACTLY, as a set with unit weights, once k >= the member count", () => {
    // The shipped default fixture's clusters are 2-6 members — every one is well under
    // LOD_REP_POINTS_K, so this exercises k >= n with the PRODUCT default, not a special-cased k.
    const levels = buildLodIndex(nodes(), edges, 1);
    const raw = nodes();
    for (const level of levels) {
      for (const c of level.clusters) {
        expect(c.count).toBeLessThan(LOD_REP_POINTS_K); // precondition: this really is the k >= n case
        expect(c.reps.length).toBe(c.count);
        expect(c.reps.every((r) => r.weight === 1)).toBe(true);
        const repSet = new Set(c.reps.map((r) => `${r.x},${r.y}`));
        const memberSet = new Set(c.memberIds.map((id) => {
          const n = raw.find((x) => x.id === id)!;
          return `${n.x},${n.y}`;
        }));
        expect(repSet).toEqual(memberSet);
      }
    }
  });

  it("still reproduces exactly at the exact boundary k === n, with an explicit small k", () => {
    // Pin the boundary itself, not just "some k comfortably above n" — a fencepost error (k > n
    // required instead of k >= n) would only show up exactly here.
    const ns = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, path: [0], x: i * 3, y: -i * 5 }));
    const levels = buildLodIndex(ns, [], 1, 7);
    const c = levels[0].clusters[0];
    expect(c.count).toBe(7);
    expect(c.reps.length).toBe(7);
    expect(c.reps.every((r) => r.weight === 1)).toBe(true);
    expect(new Set(c.reps.map((r) => `${r.x},${r.y}`))).toEqual(new Set(ns.map((n) => `${n.x},${n.y}`)));
  });

  it("conserves total weight exactly (no members lost or double-counted) whether k is below, at, or above n", () => {
    const ns = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, path: [0], x: i, y: i * i }));
    for (const k of [3, 7, 10, 24]) {
      const c = buildLodIndex(ns, [], 1, k)[0].clusters[0];
      expect(c.reps.length).toBe(Math.min(10, k));
      const totalWeight = c.reps.reduce((a, r) => a + r.weight, 0);
      expect(totalWeight).toBeCloseTo(10, 8); // ABSOLUTE: ten members in, ten members' worth of weight out
      // Every rep is a REAL member coordinate — nothing invented, unlike an ellipse sampled from
      // sdx/sdy (which places mass at arbitrary points on a curve no member ever occupied).
      const memberCoords = new Set(ns.map((n) => `${n.x},${n.y}`));
      for (const r of c.reps) expect(memberCoords.has(`${r.x},${r.y}`)).toBe(true);
    }
  });

  it("on a deliberately clumped, anisotropic fixture (two tight blobs on a diagonal), reps stay in the " +
    "blobs and split proportionally — a single centroid+sd ellipse cannot do either", () => {
    // Blob A: 30 members tightly jittered around (-1000, -1000). Blob B: 10 members tightly
    // jittered around (+1000, 1000) — far apart, on the diagonal, deliberately NOT axis-aligned so
    // an isotropic or axis-aligned synthesis has nowhere to hide. Listed in blob order (A's 30
    // first, B's 10 next): the cluster's OWN encounter order, unrelated to anything the fix reads.
    const jitter = [-2, -1, 0, 1, 2];
    const A = Array.from({ length: 30 }, (_, i) => ({
      id: `A${i}`, path: [0], x: -1000 + jitter[i % 5], y: -1000 + jitter[(i * 3) % 5],
    }));
    const B = Array.from({ length: 10 }, (_, i) => ({
      id: `B${i}`, path: [0], x: 1000 + jitter[i % 5], y: 1000 + jitter[(i * 3) % 5],
    }));
    const ns = [...A, ...B];
    const levels = buildLodIndex(ns, [], 1, LOD_REP_POINTS_K);
    const c = levels[0].clusters[0];
    expect(c.count).toBe(40);

    // --- Prove the fixture actually exhibits the problem an ellipse has -------------------------
    // A single centroid+sd "ellipse" summary is centred at (wx, wy) with radii (sdx, sdy). If that
    // centre sits nowhere near EITHER real blob, an ellipse drawn there necessarily invents density
    // in the empty gap between them — the exact failure `pushCloud`'s header measures. Confirm the
    // centroid really does land in that empty gap before trusting the fix's assertions below.
    const distTo = (px: number, py: number) => Math.hypot(c.wx - px, c.wy - py);
    expect(distTo(-1000, -1000)).toBeGreaterThan(500); // nowhere near blob A
    expect(distTo(1000, 1000)).toBeGreaterThan(500);   // nowhere near blob B either
    // ...and the ellipse's own radii are enormous relative to either blob's real 2-unit jitter —
    // an ellipse this size, centred in the gap, covers the gap itself, not two tight blobs.
    expect(c.sdx).toBeGreaterThan(500);
    expect(c.sdy).toBeGreaterThan(500);

    // --- The fix: every rep sits inside a real blob, never in the gap --------------------------
    for (const r of c.reps) {
      const dA = Math.hypot(r.x - -1000, r.y - -1000);
      const dB = Math.hypot(r.x - 1000, r.y - 1000);
      expect(Math.min(dA, dB)).toBeLessThan(10); // within the +-2 jitter (with room to spare), not the gap
    }
    // Both blobs are actually represented (not just the majority one)...
    const nearA = c.reps.filter((r) => Math.hypot(r.x - -1000, r.y - -1000) < 10);
    const nearB = c.reps.filter((r) => Math.hypot(r.x - 1000, r.y - 1000) < 10);
    expect(nearA.length).toBeGreaterThan(0);
    expect(nearB.length).toBeGreaterThan(0);
    // ...and split proportionally to the real 30/10 membership, not evenly split 50/50 as an
    // ellipse's symmetric density would imply.
    const wA = nearA.reduce((a, r) => a + r.weight, 0);
    const wB = nearB.reduce((a, r) => a + r.weight, 0);
    expect(wA).toBeCloseTo(30, 0);
    expect(wB).toBeCloseTo(10, 0);

    // --- reps' OWN spread matches the members' real spread far better than a single centroid ---
    // (a single centroid is a POINT — spread 0, i.e. 100% wrong on an axis whose real spread is
    // ~1000). The weighted reps reproduce the real (sdx, sdy) closely; a bare centroid cannot.
    const repSdx = weightedPopSd(c.reps, "x");
    const repSdy = weightedPopSd(c.reps, "y");
    expect(repSdx).toBeGreaterThan(c.sdx * 0.85);
    expect(repSdy).toBeGreaterThan(c.sdy * 0.85);
    expect(repSdx).toBeLessThan(c.sdx * 1.15);
    expect(repSdy).toBeLessThan(c.sdy * 1.15);
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
  /** The dominant level at progress t, or "glyphs" once the mass band has handed the field over. */
  function owner(t: number, levelCount: number): string {
    const { levelAlphas, glyphAlpha } = lodMix(t, levelCount);
    let best = -1, bestA = glyphAlpha;
    for (let i = 0; i < levelAlphas.length; i++) if (levelAlphas[i] > bestA) { best = i; bestA = levelAlphas[i]; }
    return best === -1 ? "glyphs" : `L${best}`;
  }

  it("walks coarsest → finest → glyphs across the stops, for the reference 3-level shape", () => {
    // Stops are t = 0, 0.1, …, 1 (10% each). The level split still divides [0, FILE_LABEL_REVEAL_T)
    // evenly (0.25-wide segments at 3 levels), but the MASS BAND itself now ends at
    // BACKBONE_START_T + BACKBONE_FADE_SPAN = 0.46 (backbone.ts), so the ladder reaches individual
    // glyphs far earlier than the old `1 - fileLabelAlpha` keying did: L0 owns 100–90%, L1 80–70%,
    // and from 60% on the glyph bands (mid, then near) own the field.
    expect(owner(0.0, 3)).toBe("L0");   // 100%
    expect(owner(0.1, 3)).toBe("L0");   // 90%
    expect(owner(0.2, 3)).toBe("L1");   // 80%
    expect(owner(0.3, 3)).toBe("L1");   // 70%
    expect(owner(0.4, 3)).toBe("glyphs"); // 60% — mid-crossfade, glyphAlpha already past half
    expect(owner(0.5, 3)).toBe("glyphs"); // 50% — the mass band is over
    expect(owner(0.75, 3)).toBe("glyphs");
    expect(owner(1.0, 3)).toBe("glyphs"); // 0%
  });

  it("masses own the far band outright, are gone by the mid plateau, and never come back", () => {
    // Far band: masses hold the whole field, split over the levels.
    for (const t of [0, 0.1, 0.2, 0.3]) {
      const mix = lodMix(t, 3);
      expect(mix.glyphAlpha).toBeLessThan(0.5);
      expect(mix.levelAlphas.reduce((a, b) => a + b, 0)).toBeCloseTo(mix.massAlpha, 8);
    }
    expect(lodMix(0, 3).massAlpha).toBe(1);
    // Mid plateau onward: no mass weight at all, on any level.
    for (const t of [0.5, 0.6, FILE_LABEL_REVEAL_T, 0.9, 1]) {
      const mix = lodMix(t, 3);
      expect(mix.massAlpha).toBe(0);
      expect(mix.glyphAlpha).toBe(1);
      expect(mix.levelAlphas.every((a) => a === 0)).toBe(true);
    }
  });

  it("the mid band draws glyphs WITHOUT their real member edges — the two must not be one number", () => {
    // The trap backbone.ts's wiring recipe names: `glyphAlpha` and `memberAlpha` are numerically
    // different across the whole mid band, so a single shared `leafAlpha` cannot serve both. At the
    // mid plateau glyphs are fully on while real member edges are fully off and the backbone owns
    // the between-group story.
    const mid = lodMix(0.6, 3);
    expect(mid.glyphAlpha).toBe(1);
    expect(mid.memberAlpha).toBe(0);
    expect(mid.backboneAlpha).toBe(1);
    // ...and at the deep end they agree again (both 1), which is why the collapse went unnoticed.
    const deep = lodMix(1, 3);
    expect(deep.glyphAlpha).toBe(1);
    expect(deep.memberAlpha).toBe(1);
    expect(deep.backboneAlpha).toBe(0);
  });

  it("total drawn weight is conserved through every crossfade (masses + backbone + members sum to 1)", () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const mix = lodMix(t, 4);
      // The per-level split exhausts the mass band exactly...
      expect(mix.levelAlphas.reduce((a, b) => a + b, 0)).toBeCloseTo(mix.massAlpha, 8);
      // ...and the three bands partition the field.
      expect(mix.massAlpha + mix.backboneAlpha + mix.memberAlpha).toBeCloseTo(1, 8);
      expect(mix.glyphAlpha).toBeCloseTo(mix.backboneAlpha + mix.memberAlpha, 8);
    }
  });

  it("a 1-level graph is a single entity tier crossfading straight into glyphs", () => {
    expect(lodMix(0, 1)).toEqual({
      levelAlphas: [1], massAlpha: 1, glyphAlpha: 0, backboneAlpha: 0, memberAlpha: 0,
    });
    const deep = lodMix(1, 1);
    expect(deep.levelAlphas[0]).toBe(0);
    expect(deep.glyphAlpha).toBe(1);
    expect(deep.memberAlpha).toBe(1);
  });
});
