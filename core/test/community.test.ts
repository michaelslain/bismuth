import { test, expect } from "bun:test";
import { detectCommunities, detectCommunityHierarchy, communityLevelsFor } from "../src/community";

test("two disconnected triangles → two communities", () => {
  const nodes = ["a","b","c","x","y","z"].map((id) => ({ id, label: id }));
  const edges = [
    ["a","b"],["b","c"],["c","a"],
    ["x","y"],["y","z"],["z","x"],
  ].map(([from,to]) => ({ from, to }));
  const m = detectCommunities(nodes, edges);
  expect(m.get("a")!.community).toBe(m.get("b")!.community);
  expect(m.get("a")!.community).toBe(m.get("c")!.community);
  expect(m.get("x")!.community).toBe(m.get("y")!.community);
  expect(m.get("a")!.community).not.toBe(m.get("x")!.community);
});

test("deterministic across runs", () => {
  const nodes = ["a","b","c","d"].map((id) => ({ id, label: id }));
  const edges = [["a","b"],["b","c"],["c","d"]].map(([from,to]) => ({ from, to }));
  const a = JSON.stringify([...detectCommunities(nodes, edges)]);
  const b = JSON.stringify([...detectCommunities(nodes, edges)]);
  expect(a).toBe(b);
});

test("isolated node gets its own community + self label", () => {
  const m = detectCommunities([{ id: "lonely", label: "Lonely" }], []);
  expect(m.get("lonely")!.label).toBe("Lonely");
});

test("empty graph → empty map", () => {
  expect(detectCommunities([], []).size).toBe(0);
});

test("exemplar label is the highest-degree member", () => {
  // star: hub connected to 3 leaves → hub is exemplar for the whole community
  const nodes = ["hub","l1","l2","l3"].map((id) => ({ id, label: id.toUpperCase() }));
  const edges = [["hub","l1"],["hub","l2"],["hub","l3"]].map(([from,to]) => ({ from, to }));
  const m = detectCommunities(nodes, edges);
  for (const id of ["hub","l1","l2","l3"]) expect(m.get(id)!.label).toBe("HUB");
});

// --- Hierarchy ("clusters in clusters in clusters") ------------------------------------------------

test("level count derives from node count, at the documented breakpoints", () => {
  // levels = clamp(1, 4, 1 + floor(log_4.5((n/10)/8))) → breakpoints at 360 / 1620 / 7290.
  expect(communityLevelsFor(0)).toBe(1);
  expect(communityLevelsFor(1)).toBe(1);
  expect(communityLevelsFor(359)).toBe(1);
  expect(communityLevelsFor(360)).toBe(2);
  expect(communityLevelsFor(1619)).toBe(2);
  expect(communityLevelsFor(1620)).toBe(3);
  expect(communityLevelsFor(7289)).toBe(3);
  expect(communityLevelsFor(7290)).toBe(4);
  // Capped at 4 — a 5th level is not distinguishable in a viewport.
  expect(communityLevelsFor(1_000_000)).toBe(4);
  // Monotone: growing a vault never REMOVES a level.
  let prev = 1;
  for (let n = 1; n < 20000; n += 37) {
    const l = communityLevelsFor(n);
    expect(l).toBeGreaterThanOrEqual(prev);
    prev = l;
  }
});

/** `supers.length` super-topics, each split into sub-topics, densely linked inside a sub-topic,
 *  moderately across sub-topics of the same super, sparsely across supers. Deterministic (fixed LCG)
 *  — this is the shape a hierarchy is supposed to recover. */
function twoLevelGraph(supers: number[][]) {
  const nodes: { id: string; label: string }[] = [];
  const edges: { from: string; to: string }[] = [];
  let s = 987654321 >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const key = (S: number, c: number, i: number) => `s${S}c${c}n${i}`;
  supers.forEach((subs, S) => subs.forEach((size, c) => {
    for (let i = 0; i < size; i++) nodes.push({ id: key(S, c, i), label: key(S, c, i) });
  }));
  supers.forEach((subs, S) => subs.forEach((size, c) => {
    for (let i = 1; i < size; i++) {
      edges.push({ from: key(S, c, i), to: key(S, c, Math.floor(rnd() * i)) });
      if (rnd() < 0.5) edges.push({ from: key(S, c, i), to: key(S, c, Math.floor(rnd() * size)) });
    }
    for (let i = 0; i < size; i++) {
      if (subs.length > 1 && rnd() < 0.15) {
        let o = Math.floor(rnd() * (subs.length - 1)); if (o >= c) o++;
        edges.push({ from: key(S, c, i), to: key(S, o, Math.floor(rnd() * subs[o])) });
      }
      if (rnd() < 0.01) {
        let oS = Math.floor(rnd() * (supers.length - 1)); if (oS >= S) oS++;
        const oc = Math.floor(rnd() * supers[oS].length);
        edges.push({ from: key(S, c, i), to: key(oS, oc, Math.floor(rnd() * supers[oS][oc])) });
      }
    }
  }));
  return { nodes, edges };
}

const SUPERS = [[70, 60, 55], [65, 60, 50], [80, 55, 45], [60, 50, 45, 40]];

test("a big graph gets nested levels; the flat API is the finest one", () => {
  const { nodes, edges } = twoLevelGraph(SUPERS);
  expect(nodes.length).toBeGreaterThanOrEqual(360); // enough to earn 2+ levels
  const h = detectCommunityHierarchy(nodes, edges);
  const levels = communityLevelsFor(nodes.length);
  expect(levels).toBeGreaterThan(1);
  for (const [, a] of h) {
    expect(a.path.length).toBe(levels);
    expect(a.labels.length).toBe(levels);
    // The flat contract: `community`/`label` ARE the finest level.
    expect(a.path[a.path.length - 1]).toBe(a.community);
    expect(a.labels[a.labels.length - 1]).toBe(a.label);
  }
  // Same finest level as the flat API returns.
  const flat = detectCommunities(nodes, edges);
  for (const [id, a] of h) expect(flat.get(id)!.community).toBe(a.community);
});

test("levels are strictly nested and get strictly coarser toward the root", () => {
  const { nodes, edges } = twoLevelGraph(SUPERS);
  const h = detectCommunityHierarchy(nodes, edges);
  const levels = h.get(nodes[0].id)!.path.length;
  // Nesting: two nodes sharing a finest community share every coarser one.
  const ancestryOf = new Map<number, string>();
  for (const [, a] of h) {
    const key = a.path.slice(0, -1).join("/");
    const prev = ancestryOf.get(a.community);
    if (prev === undefined) ancestryOf.set(a.community, key);
    else expect(prev).toBe(key);
  }
  // Coarsening: each level up has strictly fewer groups (no level is a copy of its child).
  let prevCount = Infinity;
  for (let l = 0; l < levels; l++) {
    const count = new Set([...h.values()].map((a) => a.path[l])).size;
    expect(count).toBeGreaterThan(prevCount === Infinity ? 1 : 0);
    if (prevCount !== Infinity) expect(count).toBeGreaterThan(prevCount);
    prevCount = count;
  }
});

test("no level collapses into one 'everything' blob", () => {
  // The failure mode this whole module was rewritten to avoid: coarsening that fuses the connected
  // part of the graph into a single super-community, which is not a grouping.
  const { nodes, edges } = twoLevelGraph(SUPERS);
  const h = detectCommunityHierarchy(nodes, edges);
  const levels = h.get(nodes[0].id)!.path.length;
  for (let l = 0; l < levels; l++) {
    const sizes = new Map<number, number>();
    for (const [, a] of h) sizes.set(a.path[l], (sizes.get(a.path[l]) ?? 0) + 1);
    expect(sizes.size).toBeGreaterThanOrEqual(2);
    // The balance cap (community.ts MAX_GROUP_FRACTION) keeps the biggest group under ~25%; allow
    // a little headroom for a group that was already over the cap before any merging.
    expect(Math.max(...sizes.values()) / nodes.length).toBeLessThan(0.4);
  }
});

test("hierarchy is deterministic and independent of input order", () => {
  const { nodes, edges } = twoLevelGraph(SUPERS);
  const a = detectCommunityHierarchy(nodes, edges);
  const b = detectCommunityHierarchy(nodes, edges);
  const c = detectCommunityHierarchy([...nodes].reverse(), [...edges].reverse());
  for (const [id, x] of a) {
    for (const other of [b, c]) {
      expect(other.get(id)!.path).toEqual(x.path);
      expect(other.get(id)!.labels).toEqual(x.labels);
    }
  }
});

test("a small graph gets exactly one level (unchanged flat behaviour)", () => {
  const nodes = ["a","b","c","x","y","z"].map((id) => ({ id, label: id }));
  const edges = [["a","b"],["b","c"],["c","a"],["x","y"],["y","z"],["z","x"]].map(([from,to]) => ({ from, to }));
  const h = detectCommunityHierarchy(nodes, edges);
  for (const [, a] of h) {
    expect(a.path.length).toBe(1);
    expect(a.path[0]).toBe(a.community);
  }
});

test("edgeless notes stay their own singleton at every level", () => {
  const { nodes, edges } = twoLevelGraph(SUPERS);
  const withOrphans = [...nodes, ...Array.from({ length: 40 }, (_, i) => ({ id: `orphan${i}`, label: `Orphan ${i}` }))];
  const h = detectCommunityHierarchy(withOrphans, edges);
  const levels = h.get(withOrphans[0].id)!.path.length;
  for (let i = 0; i < 40; i++) {
    const a = h.get(`orphan${i}`)!;
    expect(a.label).toBe(`Orphan ${i}`); // labelled by itself, not absorbed into a neighbour's name
    for (let l = 0; l < levels; l++) {
      const shared = [...h.entries()].filter(([, o]) => o.path[l] === a.path[l]);
      expect(shared.length).toBe(1);
    }
  }
});

test("labels at every level name the biggest hub inside that level's community", () => {
  // Two stars joined by a weak bridge: each star's own hub names it at the fine level, and whichever
  // hub has the higher degree names the merged group at the coarse level.
  const nodes: { id: string; label: string }[] = [{ id: "hubA", label: "HUB-A" }, { id: "hubB", label: "HUB-B" }];
  const edges: { from: string; to: string }[] = [{ from: "hubA", to: "hubB" }];
  for (let i = 0; i < 12; i++) { nodes.push({ id: `a${i}`, label: `a${i}` }); edges.push({ from: "hubA", to: `a${i}` }); }
  for (let i = 0; i < 6; i++) { nodes.push({ id: `b${i}`, label: `b${i}` }); edges.push({ from: "hubB", to: `b${i}` }); }
  const h = detectCommunityHierarchy(nodes, edges, { levels: 2 });
  // hubA has the higher degree, so the merged (coarse) group is named after it.
  expect(h.get("a0")!.labels[1]).toBe("HUB-A");
  expect(h.get("b0")!.labels[1]).toBe("HUB-B");
  const coarseLabels = new Set([...h.values()].map((a) => a.labels[0]));
  expect(coarseLabels.has("HUB-A")).toBe(true);
});
