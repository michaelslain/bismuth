// app/src/graph/backbone.test.ts
//
// Pure backbone math: the hub-to-hub group-edge structure (buildLevelEdges/crossLevelOf/
// computeEdgeLevelWeights, ported from CanvasGraphRenderer.ts) and — most load-bearing — the
// three-band handover (bandsForT) that decides how much of the field masses, backbone and real
// member edges each own at a given zoom. See MERGE-NOTES.md §5.4.
import { describe, expect, it } from "bun:test";
import {
  BACKBONE_FADE_SPAN,
  BACKBONE_START_T,
  MAX_LEVEL_PAIRS,
  MEMBER_FADE_SPAN,
  MEMBER_START_T,
  bandsForT,
  buildLevelEdges,
  computeEdgeLevelWeights,
  crossLevelOf,
  edgeWeightBucketRange,
  type PathEdge,
  type PathNode,
} from "./backbone";

// ---------------------------------------------------------------------------------------------
// crossLevelOf
// ---------------------------------------------------------------------------------------------

describe("crossLevelOf", () => {
  it("returns 0 when either endpoint has no community at all", () => {
    expect(crossLevelOf(null, [0, 1])).toBe(0);
    expect(crossLevelOf([0, 1], null)).toBe(0);
    expect(crossLevelOf(null, null)).toBe(0);
  });

  it("returns the shallowest level at which the paths diverge", () => {
    expect(crossLevelOf([0, 0, 5], [1, 0, 5])).toBe(0); // differ immediately
    expect(crossLevelOf([0, 0, 5], [0, 1, 5])).toBe(1); // agree at 0, differ at 1
    expect(crossLevelOf([0, 0, 5], [0, 0, 9])).toBe(2); // agree until the last entry
  });

  it("returns the shared length when the paths are identical the whole way down", () => {
    expect(crossLevelOf([0, 0], [0, 0])).toBe(2);
  });

  it("clamps to the shorter path's length when the paths differ in depth", () => {
    // Both agree on their shared prefix — crossLevelOf reads `Math.min(len)` entries only.
    expect(crossLevelOf([0], [0, 1])).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// buildLevelEdges — fixture: two level-0 communities, each splitting into two level-1
// sub-communities. Degrees are hand-picked (not derived from the edge list) so hub selection is
// pinned independently of edge structure.
//
//   level0 community 0 = {a1(deg5), a2(deg2)} ∪ {a3(deg4)}   (level1 splits into 0={a1,a2}, 1={a3})
//   level0 community 1 = {b1(deg6), b2(deg1)} ∪ {b3(deg3)}   (level1 splits into 2={b1,b2}, 3={b3})
// ---------------------------------------------------------------------------------------------

function fixtureNodes(): PathNode[] {
  return [
    { id: "a1", path: [0, 0], deg: 5 },
    { id: "a2", path: [0, 0], deg: 2 },
    { id: "a3", path: [0, 1], deg: 4 },
    { id: "b1", path: [1, 2], deg: 6 },
    { id: "b2", path: [1, 2], deg: 1 },
    { id: "b3", path: [1, 3], deg: 3 },
  ];
}
// Order matters here, deliberately: the pair that ends up HEAVIEST ((a1,b1) at level 1, count 2)
// is built from the FIRST and LAST edges below, with a lighter pair (a2-a3) inserted in between —
// so a level whose pairs are returned in raw Map-insertion order (i.e. a broken/missing
// heaviest-first sort) would NOT match the expected output, and the tests below actually exercise
// `buildLevelEdges`'s sort rather than merely restating whatever order insertion happened to give.
const fixtureEdges: PathEdge[] = [
  { a: "a2", b: "a3" }, // crossLevel 1 (share top community 0, differ at the sub-level)
  { a: "a1", b: "b1" }, // crossLevel 0 (top communities differ immediately)
  { a: "a1", b: "a2" }, // crossLevel 2 (identical path — never a group edge, only ever "real")
  { a: "b1", b: "b3" }, // crossLevel 1
  { a: "a1", b: "b2" }, // crossLevel 0 — SAME top-level pair as a1-b1 above, increments its count to 2
];

describe("buildLevelEdges", () => {
  it("picks the highest-degree member of each community as its hub, per level", () => {
    const { levelHubs } = buildLevelEdges(fixtureNodes(), fixtureEdges, 2);
    // Level 0: community 0 = {a1(5), a2(2), a3(4)} -> a1. community 1 = {b1(6), b2(1), b3(3)} -> b1.
    expect(levelHubs[0].get(0)).toEqual({ id: "a1", deg: 5 });
    expect(levelHubs[0].get(1)).toEqual({ id: "b1", deg: 6 });
    // Level 1: four singleton/pair communities.
    expect(levelHubs[1].get(0)).toEqual({ id: "a1", deg: 5 }); // {a1(5), a2(2)}
    expect(levelHubs[1].get(1)).toEqual({ id: "a3", deg: 4 }); // {a3}
    expect(levelHubs[1].get(2)).toEqual({ id: "b1", deg: 6 }); // {b1(6), b2(1)}
    expect(levelHubs[1].get(3)).toEqual({ id: "b3", deg: 3 }); // {b3}
  });

  it("breaks a hub tie by the LOWER id, regardless of which node is seen first", () => {
    const tiedHigherFirst: PathNode[] = [{ id: "z2", path: [9], deg: 7 }, { id: "z1", path: [9], deg: 7 }];
    const tiedLowerFirst: PathNode[] = [{ id: "z1", path: [9], deg: 7 }, { id: "z2", path: [9], deg: 7 }];
    expect(buildLevelEdges(tiedHigherFirst, [], 1).levelHubs[0].get(9)).toEqual({ id: "z1", deg: 7 });
    expect(buildLevelEdges(tiedLowerFirst, [], 1).levelHubs[0].get(9)).toEqual({ id: "z1", deg: 7 });
  });

  it("groups real edges into hub-to-hub pairs, counting every real link and excluding intra-community ones", () => {
    const { levelPairs } = buildLevelEdges(fixtureNodes(), fixtureEdges, 2);
    // Level 0: only a1-b1 and a1-b2 cross (crossLevel 0 <= 0); a2-a3 and b1-b3 (crossLevel 1) are
    // buried inside a single level-0 community; a1-a2 (crossLevel 2) always is.
    expect(levelPairs[0]).toEqual([{ a: { id: "a1", deg: 5 }, b: { id: "b1", deg: 6 }, count: 2 }]);

    // Level 1: a2-a3, a1-b1, b1-b3, a1-b2 all qualify (crossLevel <= 1); a1-a2 never does. (0,2)
    // gets both the a1-b1 and a1-b2 links (a2/b2 are non-hub members of communities 0/2), (0,1) is
    // a2-a3, (2,3) is b1-b3. Heaviest (0,2) sorts first EVEN THOUGH it wasn't inserted first (the
    // lighter a2-a3 pair was) — see the fixture comment above.
    expect(levelPairs[1]).toEqual([
      { a: { id: "a1", deg: 5 }, b: { id: "b1", deg: 6 }, count: 2 },
      { a: { id: "a1", deg: 5 }, b: { id: "a3", deg: 4 }, count: 1 },
      { a: { id: "b1", deg: 6 }, b: { id: "b3", deg: 3 }, count: 1 },
    ]);
  });

  it("caps each level's pairs at maxPairs, keeping the heaviest", () => {
    const { levelPairs } = buildLevelEdges(fixtureNodes(), fixtureEdges, 2, /* maxPairs */ 2);
    expect(levelPairs[1].length).toBe(2);
    expect(levelPairs[1].map((p) => p.count)).toEqual([2, 1]);
    expect(levelPairs[1][0].a.id).toBe("a1");
    expect(levelPairs[1][0].b.id).toBe("b1");
  });

  it("the shipped cap is 700, matching the ported Canvas constant", () => {
    expect(MAX_LEVEL_PAIRS).toBe(700);
  });

  it("drops an edge whose endpoint has no community at all", () => {
    const nodes: PathNode[] = [{ id: "self", path: null, deg: 9 }, { id: "a", path: [0], deg: 1 }, { id: "b", path: [1], deg: 1 }];
    const { levelPairs } = buildLevelEdges(nodes, [{ a: "self", b: "a" }, { a: "a", b: "b" }], 1);
    // "self"->"a" never contributes a group pair (self has no community to anchor a hub in), but
    // a->b (both communed) does.
    expect(levelPairs[0]).toEqual([{ a: { id: "a", deg: 1 }, b: { id: "b", deg: 1 }, count: 1 }]);
  });

  it("returns empty structures for levelCount 0", () => {
    const { levelHubs, levelPairs } = buildLevelEdges(fixtureNodes(), fixtureEdges, 0);
    expect(levelHubs).toEqual([]);
    expect(levelPairs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// computeEdgeLevelWeights
// ---------------------------------------------------------------------------------------------

describe("computeEdgeLevelWeights", () => {
  it("degenerates to 'no group lines, real edges only' for a small/community-less graph (n<=1)", () => {
    expect(computeEdgeLevelWeights(0, 0)).toEqual([0, 1]);
    expect(computeEdgeLevelWeights(0.5, 1)).toEqual([0, 1]);
    expect(computeEdgeLevelWeights(1, 1)).toEqual([0, 1]);
  });

  it("at t=0 the coarsest level owns all the group-line weight, and real edges own none", () => {
    const w = computeEdgeLevelWeights(0, 3);
    expect(w).toEqual([1, 0, 0, 0]);
  });

  it("at the reveal boundary the finest level owns the group-line weight (real edges still 0)", () => {
    const revealT = 0.62; // DEFAULT_LEVEL_REVEAL_T
    const w = computeEdgeLevelWeights(revealT, 3, revealT);
    expect(w[0]).toBeCloseTo(0, 10);
    expect(w[1]).toBeCloseTo(0, 10);
    expect(w[2]).toBeCloseTo(1, 10);
    expect(w[3]).toBeCloseTo(0, 10);
  });

  it("past the reveal boundary's fade, real edges take over and the finest level's group lines are handed off (no double-draw)", () => {
    const revealT = 0.62;
    const w = computeEdgeLevelWeights(revealT + 0.2, 3, revealT); // well past FILE_LABEL_FADE_SPAN (0.15)
    expect(w[2]).toBeCloseTo(0, 10); // handed off, NOT left at 1 alongside real edges
    expect(w[3]).toBeCloseTo(1, 10);
  });
});

// ---------------------------------------------------------------------------------------------
// edgeWeightBucketRange
// ---------------------------------------------------------------------------------------------

describe("edgeWeightBucketRange", () => {
  it("splits [0, maxCount] into even buckets, nudging the last bucket's ceiling to include maxCount itself", () => {
    expect(edgeWeightBucketRange(0, 90)).toEqual({ lo: 0, hi: 30 });
    expect(edgeWeightBucketRange(1, 90)).toEqual({ lo: 30, hi: 60 });
    // Without the +1 nudge, a pair with count === maxCount would fail `count < hi` and be dropped.
    expect(edgeWeightBucketRange(2, 90)).toEqual({ lo: 60, hi: 91 });
  });
});

// ---------------------------------------------------------------------------------------------
// bandsForT — the three-band handover.
// ---------------------------------------------------------------------------------------------

describe("bandsForT", () => {
  it("collapses to pure member territory when the graph has no community hierarchy at all", () => {
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      expect(bandsForT(t, 0)).toEqual({ massAlpha: 0, backboneAlpha: 0, memberAlpha: 1 });
      expect(bandsForT(t, -1)).toEqual({ massAlpha: 0, backboneAlpha: 0, memberAlpha: 1 });
    }
  });

  // Sum-to-1 holds by algebraic construction (massAlpha + backboneAlpha + memberAlpha telescopes
  // to 1 for ANY two nondecreasing 0..1 curves plugged into the same formula) — it would pass just
  // as well against an implementation with the bands in the wrong order, or with backboneAlpha
  // permanently 0. It is necessary but never sufficient on its own; the tests below it are the
  // ones that actually pin WHERE each band lives.
  it("the three alphas sum to 1 at every t (necessary, not sufficient — see tests below)", () => {
    const N = 4;
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const b = bandsForT(t, N);
      expect(b.massAlpha + b.backboneAlpha + b.memberAlpha).toBeCloseTo(1, 10);
    }
  });

  it("massAlpha owns the field up to BACKBONE_START_T and is fully gone by the end of that crossfade", () => {
    const N = 4;
    expect(bandsForT(0, N).massAlpha).toBe(1);
    expect(bandsForT(BACKBONE_START_T, N).massAlpha).toBe(1);
    expect(bandsForT(BACKBONE_START_T + BACKBONE_FADE_SPAN, N).massAlpha).toBeCloseTo(0, 10);
    expect(bandsForT(1, N).massAlpha).toBe(0); // 0 at the far end of the opposite (member) band
  });

  it("backboneAlpha is 0 outside its band and full strength across its plateau", () => {
    const N = 4;
    expect(bandsForT(0, N).backboneAlpha).toBe(0); // 0 at the far end of the mass band
    expect(bandsForT(BACKBONE_START_T + BACKBONE_FADE_SPAN, N).backboneAlpha).toBeCloseTo(1, 10);
    const plateauMid = (BACKBONE_START_T + BACKBONE_FADE_SPAN + MEMBER_START_T) / 2;
    expect(bandsForT(plateauMid, N).backboneAlpha).toBeCloseTo(1, 10);
    expect(bandsForT(MEMBER_START_T, N).backboneAlpha).toBeCloseTo(1, 10);
    expect(bandsForT(MEMBER_START_T + MEMBER_FADE_SPAN, N).backboneAlpha).toBeCloseTo(0, 10);
    expect(bandsForT(1, N).backboneAlpha).toBe(0); // 0 at the far end of the member band
  });

  it("memberAlpha is 0 until MEMBER_START_T and reaches full strength by the end of that crossfade", () => {
    const N = 4;
    expect(bandsForT(0, N).memberAlpha).toBe(0); // 0 at the far end of the mass band
    expect(bandsForT(MEMBER_START_T, N).memberAlpha).toBe(0);
    expect(bandsForT(MEMBER_START_T + MEMBER_FADE_SPAN, N).memberAlpha).toBeCloseTo(1, 10);
    expect(bandsForT(1, N).memberAlpha).toBe(1);
  });

  it("each band peaks within its own third of the ladder, and is negligible in the OTHER extreme third", () => {
    const N = 4;
    const step = 1 / 300;
    const samples: number[] = [];
    for (let t = 0; t <= 1 + 1e-9; t += step) samples.push(Math.min(1, t));
    const maxIn = (pick: (t: number) => number, lo: number, hi: number) =>
      Math.max(...samples.filter((t) => t >= lo && t < hi + 1e-9).map(pick));

    const mass = (t: number) => bandsForT(t, N).massAlpha;
    const backbone = (t: number) => bandsForT(t, N).backboneAlpha;
    const member = (t: number) => bandsForT(t, N).memberAlpha;
    const far: [number, number] = [0, 1 / 3];
    const mid: [number, number] = [1 / 3, 2 / 3];
    const near: [number, number] = [2 / 3, 1];

    expect(maxIn(mass, ...far)).toBeCloseTo(1, 6);
    expect(maxIn(backbone, ...mid)).toBeCloseTo(1, 6);
    expect(maxIn(member, ...near)).toBeCloseTo(1, 6);

    // "0 at the far end of the opposite band": mass has nothing left in the near third, member
    // hasn't started in the far third.
    expect(maxIn(mass, ...near)).toBeLessThan(0.001);
    expect(maxIn(member, ...far)).toBeLessThan(0.001);
  });

  it("is continuous — no alpha jumps more than a small epsilon between adjacent t steps (a discontinuity here is a visible pop)", () => {
    const N = 4;
    const steps = 2000;
    let prev = bandsForT(0, N);
    let maxJump = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cur = bandsForT(t, N);
      maxJump = Math.max(
        maxJump,
        Math.abs(cur.massAlpha - prev.massAlpha),
        Math.abs(cur.backboneAlpha - prev.backboneAlpha),
        Math.abs(cur.memberAlpha - prev.memberAlpha),
      );
      prev = cur;
    }
    // Each crossfade is a smoothstep over a 0.14-wide span; at a 1/2000 step the theoretical max
    // per-step delta is a couple thousandths. 0.02 comfortably rejects a real pop (e.g. a level
    // boundary hard-switching instead of crossfading) while tolerating the smooth curve's own slope.
    expect(maxJump).toBeLessThan(0.02);
  });

  it("is independent of levelCount's exact value once it is >= 1 (only the levelCount<=0 case is special)", () => {
    // The band boundaries are t-only; levelCount just gates the degenerate "no hierarchy" case.
    expect(bandsForT(0.5, 1)).toEqual(bandsForT(0.5, 5));
  });
});
