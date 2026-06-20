import { randomUUID } from "node:crypto";
import { test, expect } from "bun:test";
import { graphSig, attachLayout, peekLayout, computeViewLayouts } from "../src/layout-cache";
import type { GraphData } from "../src/graph";

// Three notes A, B, C; the only edge is a wikilink A -> B.
function baseGraph(): GraphData {
  return {
    nodes: [
      { id: "A", label: "A", kind: "note" },
      { id: "B", label: "B", kind: "note" },
      { id: "C", label: "C", kind: "note" },
    ],
    edges: [{ from: "A", to: "B", kind: "link" }],
  };
}

test("graphSig is stable for an identical graph", () => {
  expect(graphSig(baseGraph(), "vault")).toBe(graphSig(baseGraph(), "vault"));
});

test("graphSig is order-independent for nodes and edges", () => {
  const g1 = baseGraph();
  const g2: GraphData = {
    nodes: [g1.nodes[2], g1.nodes[0], g1.nodes[1]],
    edges: [...g1.edges],
  };
  expect(graphSig(g2, "vault")).toBe(graphSig(g1, "vault"));
});

// B12: a retargeted wikilink ([[A]] -> [[B]] becomes [[A]] -> [[C]]) keeps the same node set and the
// same edge count, but the connectivity differs — the signature MUST change so the stale layout is busted.
test("graphSig busts when an edge is retargeted (same node set + edge count)", () => {
  const before = baseGraph();
  const after = baseGraph();
  after.edges = [{ from: "A", to: "C", kind: "link" }];

  expect(after.nodes.length).toBe(before.nodes.length);
  expect(after.edges.length).toBe(before.edges.length);
  expect(graphSig(after, "vault")).not.toBe(graphSig(before, "vault"));
});

test("graphSig changes when an edge kind changes", () => {
  const before = baseGraph();
  const after = baseGraph();
  after.edges = [{ from: "A", to: "B", kind: "tag" }];
  expect(graphSig(after, "vault")).not.toBe(graphSig(before, "vault"));
});

test("graphSig is keyed by vault", () => {
  expect(graphSig(baseGraph(), "vaultA")).not.toBe(graphSig(baseGraph(), "vaultB"));
});

// A graph with a 2nd-brain note + a 3rd-brain memory node so both subgraphs are non-empty.
function brainGraph(): GraphData {
  return {
    nodes: [
      { id: "n1", label: "n1", kind: "note" },
      { id: "n2", label: "n2", kind: "note" },
      { id: "mem:m1", label: "m1", kind: "memory" },
    ],
    edges: [
      { from: "n1", to: "n2", kind: "link" },
      { from: "mem:m1", to: "n1", kind: "about" },
    ],
  };
}

test("peekLayout returns null for an uncached non-empty subgraph", () => {
  const key = `test-${randomUUID()}`; // unique key => guaranteed cold disk cache
  const g: GraphData = {
    nodes: [{ id: "n1", label: "n1", kind: "note" }],
    edges: [],
  };
  expect(peekLayout(g, key)).toBeNull();
});

test("attachLayout omits views when they are not cached yet", async () => {
  const key = `test-${randomUUID()}`;
  const out = await attachLayout(brainGraph(), key);
  expect(out.views).toBeUndefined();
  // The full-graph positions are still attached.
  expect(out.nodes.find((n) => n.id === "n1")?.position).toBeDefined();
});

test("computeViewLayouts caches the views; a later attachLayout includes them", async () => {
  const key = `test-${randomUUID()}`;
  const g = brainGraph();

  // Cold: no views.
  expect((await attachLayout(g, key)).views).toBeUndefined();

  // Compute them on demand (Task 4's endpoint calls this).
  const views = await computeViewLayouts(g, key);
  expect(views.second.pos3d["n1"]).toBeDefined();
  expect(views.second.pos2d["n1"]).toHaveLength(2);

  // Now they're cached: attachLayout attaches them.
  const out = await attachLayout(g, key);
  expect(out.views?.second?.pos3d["n1"]).toBeDefined();
  expect(out.views?.third?.pos3d["mem:m1"]).toBeDefined();
});

// Incremental add-only rebuild: creating a note must NOT scramble the existing layout. The warm-start
// (lastFullLayout) pins every pre-existing node so its 3D + 2D positions are byte-identical across the add.
test("adding a node pins the existing layout (no scramble) and places the new node", async () => {
  const key = `test-${randomUUID()}`;
  const g1 = baseGraph(); // A, B, C with A -> B
  const out1 = await attachLayout(g1, key);
  const posOf = (out: GraphData, id: string) => out.nodes.find((n) => n.id === id)!;

  // Add D linked to A — a pure addition (no node removed, no edge retargeted).
  const g2: GraphData = {
    nodes: [...g1.nodes, { id: "D", label: "D", kind: "note" }],
    edges: [...g1.edges, { from: "A", to: "D", kind: "link" }],
  };
  const out2 = await attachLayout(g2, key);

  for (const id of ["A", "B", "C"]) {
    expect(posOf(out2, id).position).toEqual(posOf(out1, id).position);
    expect(posOf(out2, id).position2d).toEqual(posOf(out1, id).position2d);
  }
  const d = posOf(out2, "D");
  expect(d.position!.every((n) => Number.isFinite(n))).toBe(true);
  expect(d.position2d!.every((n) => Number.isFinite(n))).toBe(true);
});

// A deletion is NOT a pure add, so it takes the normal warm path (survivors may relax) — but the layout
// must still be valid: every remaining node keeps a finite position and the removed node is gone.
test("removing a node yields a valid layout for the survivors", async () => {
  const key = `test-${randomUUID()}`;
  const g1 = baseGraph();
  await attachLayout(g1, key);
  const g2: GraphData = { nodes: g1.nodes.filter((n) => n.id !== "C"), edges: g1.edges };
  const out2 = await attachLayout(g2, key);
  expect(out2.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
  for (const n of out2.nodes) expect(n.position!.every((c) => Number.isFinite(c))).toBe(true);
});
