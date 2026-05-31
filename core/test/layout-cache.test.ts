import { test, expect } from "bun:test";
import { graphSig } from "../src/layout-cache";
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
