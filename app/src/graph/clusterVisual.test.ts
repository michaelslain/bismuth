// app/src/graph/clusterVisual.test.ts
//
// Pure cluster-visual math ported from CanvasGraphRenderer.ts ahead of its deletion — see the module
// header in clusterVisual.ts for the two measured failures this replaces. Every expected value below
// (including the HSL-derived hex strings) was hand-derived from the ported rgbToHsl/hslToRgb formulas
// and cross-checked by running the function, not copied from the implementation's own output blind.
//
// The buildColorSlots fixtures deliberately use community ids that are NON-MONOTONIC with (in fact,
// a derangement of) their size rank: a fixture where id order happens to match size order would let
// a "sort by id instead of by size" mutation pass silently (this bit a previous task on this plan).
import { describe, expect, it } from "bun:test";
import {
  buildColorSlots, clusterExtent, clusterLabelLift, clusterLabelScale, clusterLabelThreshold,
  CLUSTER_LABEL_LIFT_PX, CLUSTER_LABEL_MAX_LIFT_PX, CLUSTER_LABEL_MIN_MEMBERS, inViewport, LIGHTNESS_CLAMP,
  NODE_SAT_BOOST, pathOf, pickHubAnchor, trimDanglingWord,
} from "./clusterVisual";

/** Independent (not imported) hue extraction for the hue-DISTANCE assertion below — `Set.size`
 *  distinctness is satisfied by a 1-unit rounding difference, which is not what "hue-rotate on wrap"
 *  is supposed to buy. Standard RGB->hue formula, hand-verified against known primaries. */
function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  let h = 0;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return ((h % 1) + 1) % 1;
}
/** Circular distance between two [0,1) hues (0 and 1 are the same hue). */
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

describe("buildColorSlots — size-ranked, not hash-ranked", () => {
  it("ranks by member count, NOT by community id — ids are a derangement of the size order", () => {
    // Ascending id order is 3, 17, 42 — completely different from the correct size order
    // (42 largest, 3 middle, 17 smallest). A "sort by id" mutation would assign 3->slot0,
    // 17->slot1, 42->slot2 instead of the correct 42->slot0, 3->slot1, 17->slot2.
    const sizes = new Map([
      [42, 100], // largest -> rank 0 -> palette[0] (red)
      [3, 50],   // middle  -> rank 1 -> palette[1] (green)
      [17, 5],   // smallest -> rank 2 -> palette[2] (blue)
    ]);
    const slots = buildColorSlots(sizes, ["#ff0000", "#00ff00", "#0000ff"]);
    // Hand-derived: red/green/blue at full saturation survive rgbToHsl->(boost, clamp)->hslToHex
    // as a dominant-channel colour at exactly these values (sat clamped to 0.85, l clamped to 0.53).
    expect(slots.get(42)).toBe("#ed2121"); // red family
    expect(slots.get(3)).toBe("#21ed21");  // green family
    expect(slots.get(17)).toBe("#2121ed"); // blue family
  });

  it("gives the top-N-by-size communities distinct slots", () => {
    const sizes = new Map([[5, 9], [1, 40], [8, 1], [2, 25], [3, 3]]);
    const slots = buildColorSlots(sizes, ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff"]);
    const values = [...slots.values()];
    expect(new Set(values).size).toBe(values.length); // all 5 distinct, no palette-length collision
  });

  it("stays distinct even when communities meaningfully OUTNUMBER the palette (a second wrap)", () => {
    // 10 communities, strictly decreasing size, over only a 5-entry palette — every community past
    // rank 4 shares a base palette slot with an earlier one and must be told apart by hue rotation
    // alone. This is this module's entire reason to exist: with only 5 communities (as in the test
    // above), distinctness is pigeonhole-guaranteed by the palette length regardless of ranking
    // logic, so that test alone cannot tell a correct wrap-around from a broken one. A `palette[rank
    // % palLen]` -> `palette[Math.min(rank, palLen - 1)]` mutation (clamp instead of wrap — a
    // plausible typo) passes every other test in this file but collapses ranks 5-9 here onto one
    // identical colour, which is exactly the failure this module's header quotes: "nearly every big
    // top-level group landed on the same teal, so the field read as one colour."
    const sizes = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, 100 - i]));
    const palette = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff"];
    const slots = buildColorSlots(sizes, palette);
    const values = [...slots.values()];
    expect(slots.size).toBe(10);
    expect(new Set(values).size).toBe(10);
  });

  it("breaks size ties by community id ascending — lower id ranks first", () => {
    const sizes = new Map([[9, 10], [4, 10]]); // equal size, different id
    const slots = buildColorSlots(sizes, ["#ff0000", "#00ff00"]);
    expect(slots.get(4)).toBe("#ed2121"); // lower id -> rank 0 -> palette[0]
    expect(slots.get(9)).toBe("#21ed21"); // higher id -> rank 1 -> palette[1]
  });

  it("hue-rotates on wrap instead of reusing the exact same colour", () => {
    // 5 communities, strictly decreasing size, over a 2-entry palette: ranks 0 and 2 and 4 all
    // land on palette[0] (red) but at cycles 0, 1, 2 respectively. If hue rotation were dropped
    // (a plausible mutation: hue = hsl[0] regardless of cycle), all three would come out IDENTICAL,
    // since saturation/lightness don't depend on cycle either.
    const sizes = new Map([[1, 50], [2, 40], [3, 30], [4, 20], [5, 10]]);
    const slots = buildColorSlots(sizes, ["#ff0000", "#00ff00"]);
    const rank0 = slots.get(1)!, rank2 = slots.get(3)!, rank4 = slots.get(5)!;
    expect(new Set([rank0, rank2, rank4]).size).toBe(3);
  });

  it("the wrap's hue rotation is visually SIGNIFICANT, not merely a different string", () => {
    // `Set.size` distinctness (the test above) is satisfied by a 1/255 rounding difference between
    // two strings — it does not prove the rotation is big enough to actually read as a different
    // colour. Mutating `HUE_ROTATE_PER_CYCLE` from 0.5 down to 0.006 leaves every existing test in
    // this file green (colours are still pairwise distinct, just by ~4/255 on one channel) while
    // producing two masses that are visually identical reds. Assert a real minimum hue separation
    // instead: same 10-over-5 fixture, community 1 (rank 0, cycle 0) vs community 6 (rank 5, cycle 1
    // — same base palette slot, next wrap).
    const sizes = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, 100 - i]));
    const palette = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff"];
    const slots = buildColorSlots(sizes, palette);
    const dist = hueDist(hexToHue(slots.get(1)!), hexToHue(slots.get(6)!));
    // Correct rotation: (1 * 0.5) / 5 = 0.1 of the hue circle (36°). A near-zero rotation constant
    // (e.g. 0.006) would produce ~0.0016. 0.05 (18°) sits well clear of both.
    expect(dist).toBeGreaterThan(0.05);
  });

  it("does not lighten on wrap — cycle 1's colour keeps a real hue, not a washed-out near-white", () => {
    // Regression for the specific mistake Canvas's own comment records trying first: lightening
    // wrapped cycles toward white. Cycle 1 of red (hue rotated a half step, palette length 1) must
    // still have a clearly dominant channel, not converge toward equal R/G/B (grey/white).
    const slots = buildColorSlots(new Map([[1, 20], [2, 10]]), ["#ff0000"]);
    const hex = slots.get(2)!; // rank 1, cycle 1 (palLen=1): hue = 0 + (1*0.5)/1 = 0.5
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    expect(maxc - minc).toBeGreaterThan(100); // still a saturated colour, not grey/white
  });

  it("falls back to a neutral colour instead of throwing on an empty or unparseable palette", () => {
    expect(() => buildColorSlots(new Map([[1, 5]]), [])).not.toThrow();
    expect(() => buildColorSlots(new Map([[1, 5]]), ["not-a-css-colour"])).not.toThrow();
    const slots = buildColorSlots(new Map([[1, 5]]), ["not-a-css-colour"]);
    expect(slots.get(1)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("returns an empty map for an empty community-size input", () => {
    expect(buildColorSlots(new Map(), ["#ff0000"]).size).toBe(0);
  });

  it("boosts saturation and clamps lightness on a PASTEL input — the input class the boost is for", () => {
    // Every other fixture in this file uses pure #ff0000/#00ff00/#0000ff at saturation 1.0, which
    // clamps to SAT_CLAMP under any NODE_SAT_BOOST >= 0.85 — the boost's actual magnitude is a no-op
    // on that input class. The source comment says real theme accents sit "near 35% saturation";
    // this fixture (#d28c8c, a muted red: hue 0, sat 0.4375, l 0.6863) is in that regime and makes
    // both NODE_SAT_BOOST and LIGHTNESS_CLAMP observable:
    //   sat_out = min(SAT_CLAMP, 0.4375 * NODE_SAT_BOOST) = min(0.85, 0.678125) = 0.678125 (unclamped
    //     — so the *exact* NODE_SAT_BOOST value determines the output, not just whether it clamps)
    //   l_out   = min(LIGHTNESS_CLAMP, 0.686275 * 1.06)   = min(0.72, 0.727451) = 0.72 (clamped — so
    //     the *exact* LIGHTNESS_CLAMP value determines the output)
    // Hand-derived through the ported rgbToHsl -> boost/clamp -> hslToHex pipeline and cross-checked
    // by running the function (see task-5-report.md).
    const slots = buildColorSlots(new Map([[1, 10]]), ["#d28c8c"]);
    expect(slots.get(1)).toBe("#e88787");
  });

  it("pins the exported tuning constants by literal value", () => {
    // The tests above import these constants and compare OUTPUT against them, which pins the port's
    // internal consistency but not the constants' actual values (a `NODE_SAT_BOOST: 1.55 -> 1.9` or
    // `LIGHTNESS_CLAMP: 0.72 -> 0.9` edit leaves every such test green). Pin the literals directly.
    expect(NODE_SAT_BOOST).toBe(1.55);
    expect(LIGHTNESS_CLAMP).toBe(0.72);
  });
});

describe("pickHubAnchor — highest-degree member, not first-listed or centroid-nearest", () => {
  it("picks the highest-degree member regardless of iteration order", () => {
    const members = [
      { id: 1, degree: 3 },
      { id: 2, degree: 9 }, // the real hub
      { id: 3, degree: 5 },
    ];
    expect(pickHubAnchor(members)).toBe(2);
  });

  it("does NOT pick the first-listed member when it isn't the highest-degree one", () => {
    const members = [
      { id: 100, degree: 1 }, // first, but low degree
      { id: 200, degree: 50 },
    ];
    expect(pickHubAnchor(members)).toBe(200);
  });

  it("breaks a degree tie by lowest id, matching the backend's exemplar rule", () => {
    const members = [
      { id: 30, degree: 7 },
      { id: 10, degree: 7 },
      { id: 20, degree: 7 },
    ];
    expect(pickHubAnchor(members)).toBe(10);
  });

  it("returns undefined for an empty member list", () => {
    expect(pickHubAnchor([])).toBeUndefined();
  });

  it("a single member is always its own hub", () => {
    expect(pickHubAnchor([{ id: 7, degree: 0 }])).toBe(7);
  });

  it("is generic over STRING ids — a degree tie breaks by lexicographic id, not by array position (GraphNode.id is a string; the ported source compares nv.node.id < cur.node.id)", () => {
    // Six equal-degree members, deliberately listed in an order where the LAST element ("alpha") is
    // lexicographically first — a caller that quietly substituted array index (or insertion order)
    // for the real id would pick "zulu" (first-listed) here instead of "alpha" (lexicographically
    // lowest), which is exactly the bug this test exists to catch.
    const members = [
      { id: "zulu", degree: 5 }, { id: "yankee", degree: 5 }, { id: "xray", degree: 5 },
      { id: "whiskey", degree: 5 }, { id: "victor", degree: 5 }, { id: "alpha", degree: 5 },
    ];
    expect(pickHubAnchor(members)).toBe("alpha");
  });

  it("string ids: higher degree still wins regardless of lexicographic id order", () => {
    const members = [{ id: "zulu", degree: 9 }, { id: "alpha", degree: 1 }];
    expect(pickHubAnchor(members)).toBe("zulu");
  });
});

describe("trimDanglingWord", () => {
  it("drops a single trailing dangling word", () => {
    expect(trimDanglingWord("LUDWIG FEUERBACH AND")).toBe("LUDWIG FEUERBACH");
  });

  it("drops repeated trailing dangling words", () => {
    expect(trimDanglingWord("REGION OF THE")).toBe("REGION");
  });

  it("never returns empty — a name made only of dangling words keeps its first word", () => {
    expect(trimDanglingWord("OF THE")).toBe("OF");
    expect(trimDanglingWord("THE")).toBe("THE");
  });

  it("leaves a name alone when its last word isn't dangling", () => {
    expect(trimDanglingWord("THE PROJECT AND FRIENDS")).toBe("THE PROJECT AND FRIENDS");
  });

  it("only matches uppercase dangling words — the label is expected pre-cased", () => {
    expect(trimDanglingWord("READING and")).toBe("READING and");
  });

  it("collapses internal whitespace runs the same way the source split does", () => {
    expect(trimDanglingWord("READING   LIST   AND")).toBe("READING LIST");
  });
});

describe("inViewport", () => {
  const w = 800, h = 600, pad = 40;

  it("is true for a point well inside the frame", () => {
    expect(inViewport(400, 300, w, h, pad)).toBe(true);
  });

  it("is true exactly at the frame edges (inclusive)", () => {
    expect(inViewport(0, 0, w, h, pad)).toBe(true);
    expect(inViewport(w, h, w, h, pad)).toBe(true);
  });

  it("is true within the padding band outside the frame", () => {
    expect(inViewport(-30, 300, w, h, pad)).toBe(true);
    expect(inViewport(w + 30, 300, w, h, pad)).toBe(true);
  });

  it("is true exactly AT the padding boundary (inclusive), false one px past it", () => {
    // Pins the >=/<= at the actual pad edge, not the frame's own 0/w edge (where inclusive vs
    // exclusive can't be told apart, since the padding band already covers it either way).
    expect(inViewport(-pad, 300, w, h, pad)).toBe(true);
    expect(inViewport(-pad - 1, 300, w, h, pad)).toBe(false);
    expect(inViewport(w + pad, 300, w, h, pad)).toBe(true);
    expect(inViewport(w + pad + 1, 300, w, h, pad)).toBe(false);
    expect(inViewport(400, -pad, w, h, pad)).toBe(true);
    expect(inViewport(400, -pad - 1, w, h, pad)).toBe(false);
    expect(inViewport(400, h + pad, w, h, pad)).toBe(true);
    expect(inViewport(400, h + pad + 1, w, h, pad)).toBe(false);
  });

  it("is false past the padding band", () => {
    expect(inViewport(-50, 300, w, h, pad)).toBe(false);
    expect(inViewport(w + 50, 300, w, h, pad)).toBe(false);
    expect(inViewport(400, -50, w, h, pad)).toBe(false);
    expect(inViewport(400, h + 50, w, h, pad)).toBe(false);
  });
});

describe("clusterLabelThreshold — visible-share naming bar", () => {
  it("floors at CLUSTER_LABEL_MIN_MEMBERS for a small visible field", () => {
    expect(clusterLabelThreshold(10)).toBe(CLUSTER_LABEL_MIN_MEMBERS);
  });

  it("rises above the floor once 1.5% of a large visible field exceeds it", () => {
    // 1.5% of 10,000 = 150, well past the floor of 6.
    expect(clusterLabelThreshold(10_000)).toBe(150);
    expect(clusterLabelThreshold(10_000)).toBeGreaterThan(CLUSTER_LABEL_MIN_MEMBERS);
  });

  it("is relative to what's VISIBLE, not a fixed constant — grows with the visible total", () => {
    expect(clusterLabelThreshold(20_000)).toBeGreaterThan(clusterLabelThreshold(10_000));
  });

  it("pins CLUSTER_LABEL_MIN_MEMBERS by literal value", () => {
    // The floor test above compares OUTPUT against the imported constant, which doesn't pin the
    // constant's own value (a `6 -> 3` edit leaves it green). Pin the literal directly.
    expect(CLUSTER_LABEL_MIN_MEMBERS).toBe(6);
  });
});

describe("clusterLabelScale — sqrt-eased share of the visible field", () => {
  it("is 0 when nothing is visible (no divide-by-zero NaN)", () => {
    expect(clusterLabelScale(5, 0)).toBe(0);
  });

  it("caps at 1 when a community IS essentially the whole visible field", () => {
    expect(clusterLabelScale(1000, 1000)).toBe(1);
  });

  it("matches the ported sqrt-ease formula exactly for a partial share", () => {
    // memberCount/visibleTotal = 0.1 -> sqrt(0.1) * 2.2
    expect(clusterLabelScale(100, 1000)).toBeCloseTo(Math.sqrt(0.1) * 2.2, 10);
  });

  it("is monotonic — a bigger community never scores a smaller scale at the same visible total", () => {
    const small = clusterLabelScale(10, 1000);
    const big = clusterLabelScale(500, 1000);
    expect(big).toBeGreaterThan(small);
  });
});

describe("clusterLabelLift", () => {
  it("is the bare minimum lift for a zero-extent (single-point) cluster", () => {
    expect(clusterLabelLift(0)).toBe(CLUSTER_LABEL_LIFT_PX);
  });

  it("grows with the cluster's on-screen extent, under the cap", () => {
    expect(clusterLabelLift(20)).toBe(CLUSTER_LABEL_LIFT_PX + 20);
  });

  it("caps at LIFT_PX + MAX_LIFT_PX for a huge extent", () => {
    expect(clusterLabelLift(10_000)).toBe(CLUSTER_LABEL_LIFT_PX + CLUSTER_LABEL_MAX_LIFT_PX);
  });

  it("pins CLUSTER_LABEL_LIFT_PX and CLUSTER_LABEL_MAX_LIFT_PX by literal value", () => {
    // Same gap as CLUSTER_LABEL_MIN_MEMBERS above: the tests here compare against the imported
    // constants, not against fixed numbers (a `10 -> 25` / `46 -> 60` edit leaves them green).
    expect(CLUSTER_LABEL_LIFT_PX).toBe(10);
    expect(CLUSTER_LABEL_MAX_LIFT_PX).toBe(46);
  });
});

describe("clusterExtent — on-screen radius around the hub anchor", () => {
  const hub = { sx: 100, sy: 100 };

  it("is 0 with no members", () => {
    expect(clusterExtent(hub, [])).toBe(0);
  });

  it("uses vertical distance directly when a member is straight below the hub", () => {
    expect(clusterExtent(hub, [{ sx: 100, sy: 160 }])).toBe(60);
  });

  it("halves horizontal distance when a member is straight beside the hub", () => {
    expect(clusterExtent(hub, [{ sx: 300, sy: 100 }])).toBe(100); // |dx|*0.5 = 200*0.5
  });

  it("takes the MAX over all members, not the sum or the first", () => {
    const members = [
      { sx: 100, sy: 110 },  // dy=10
      { sx: 100, sy: 100 + 5 }, // dy=5
      { sx: 100, sy: 250 },   // dy=150 -> the real max
    ];
    expect(clusterExtent(hub, members)).toBe(150);
  });
});

describe("pathOf — the hierarchy path callers fold into communitySizes/members inputs", () => {
  it("prefers a non-empty communityPath over the flat community field", () => {
    expect(pathOf({ communityPath: [1, 2, 3], community: 99 })).toEqual([1, 2, 3]);
  });

  it("falls back to [community] when communityPath is absent", () => {
    expect(pathOf({ community: 5 })).toEqual([5]);
  });

  it("treats an EMPTY communityPath array as absent, not as a valid (empty) path", () => {
    // `communityPath?.length` is falsy for `[]`, so this must fall through to `community` — a naive
    // `communityPath ?? [community]` port would instead return `[]` here and silently drop the node
    // from every level's size tally.
    expect(pathOf({ communityPath: [], community: 7 })).toEqual([7]);
  });

  it("returns null when the node carries no community at all (self/daemon/cron/process)", () => {
    expect(pathOf({})).toBeNull();
    expect(pathOf({ communityPath: null, community: null })).toBeNull();
  });

  it("distinguishes community 0 from no community — 0 is falsy but a real id", () => {
    // `community != null` (not `community ? ... : null`) is the load-bearing check here: community
    // id 0 is a legitimate rank-0 community, not "no community".
    expect(pathOf({ community: 0 })).toEqual([0]);
  });
});
