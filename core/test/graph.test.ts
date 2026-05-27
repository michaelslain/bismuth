import { test, expect } from "bun:test";
import { mergeGraphs, emptyGraph, type GraphData } from "../src/graph";

test("emptyGraph has no nodes or edges", () => {
  expect(emptyGraph()).toEqual({ nodes: [], edges: [] });
});

test("mergeGraphs concatenates and dedupes nodes by id, keeps all edges", () => {
  const a: GraphData = {
    nodes: [{ id: "x", label: "X", kind: "note" }],
    edges: [{ from: "x", to: "y", kind: "link" }],
  };
  const b: GraphData = {
    nodes: [
      { id: "x", label: "X", kind: "note" },
      { id: "y", label: "Y", kind: "note" },
    ],
    edges: [{ from: "y", to: "x", kind: "link" }],
  };
  const merged = mergeGraphs([a, b]);
  expect(merged.nodes.map((n) => n.id).sort()).toEqual(["x", "y"]);
  expect(merged.edges.length).toBe(2);
});

test("merging empty graphs returns empty graph", () => {
  const g1 = emptyGraph();
  const g2 = emptyGraph();
  const merged = mergeGraphs([g1, g2]);
  expect(merged).toEqual({ nodes: [], edges: [] });
});

test("merging single empty graph returns empty", () => {
  const merged = mergeGraphs([emptyGraph()]);
  expect(merged).toEqual({ nodes: [], edges: [] });
});

test("merging empty array returns empty graph", () => {
  const merged = mergeGraphs([]);
  expect(merged).toEqual({ nodes: [], edges: [] });
});

test("preserves first node when ids are duplicated", () => {
  const g1: GraphData = { nodes: [{ id: "x", label: "First", kind: "note" }], edges: [] };
  const g2: GraphData = { nodes: [{ id: "x", label: "Second", kind: "note" }], edges: [] };
  const merged = mergeGraphs([g1, g2]);
  expect(merged.nodes.length).toBe(1);
  expect(merged.nodes[0].label).toBe("First");
});

test("handles different node kinds in merge", () => {
  const g1: GraphData = { nodes: [{ id: "a", label: "A", kind: "note" }], edges: [] };
  const g2: GraphData = { nodes: [{ id: "b", label: "B", kind: "memory" }], edges: [] };
  const merged = mergeGraphs([g1, g2]);
  expect(merged.nodes).toHaveLength(2);
  expect(merged.nodes.some((n) => n.kind === "note")).toBe(true);
  expect(merged.nodes.some((n) => n.kind === "memory")).toBe(true);
});

test("preserves node properties (folder, state) in merge", () => {
  const g1: GraphData = { nodes: [{ id: "a", label: "A", kind: "note", folder: "project" }], edges: [] };
  const merged = mergeGraphs([g1]);
  expect(merged.nodes[0].folder).toBe("project");
});

test("does not automatically dedupe duplicate edges", () => {
  const g1: GraphData = { nodes: [], edges: [{ from: "a", to: "b", kind: "link" }] };
  const g2: GraphData = { nodes: [], edges: [{ from: "a", to: "b", kind: "link" }] };
  const merged = mergeGraphs([g1, g2]);
  expect(merged.edges.length).toBeGreaterThan(1);
});

test("merges graphs with different edge kinds", () => {
  const g1: GraphData = { nodes: [], edges: [{ from: "a", to: "b", kind: "link" }] };
  const g2: GraphData = { nodes: [], edges: [{ from: "a", to: "b", kind: "tag" }] };
  const merged = mergeGraphs([g1, g2]);
  expect(merged.edges).toHaveLength(2);
  expect(merged.edges.some((e) => e.kind === "link")).toBe(true);
  expect(merged.edges.some((e) => e.kind === "tag")).toBe(true);
});

test("handles self nodes correctly", () => {
  const g1: GraphData = { nodes: [{ id: "self", label: "You", kind: "self" }], edges: [] };
  const g2: GraphData = { nodes: [{ id: "note", label: "Note", kind: "note" }], edges: [] };
  const merged = mergeGraphs([g1, g2]);
  expect(merged.nodes.some((n) => n.id === "self")).toBe(true);
  expect(merged.nodes).toHaveLength(2);
});

test("large graph merge does not lose data", () => {
  const g1: GraphData = {
    nodes: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, kind: "note" })),
    edges: Array.from({ length: 99 }, (_, i) => ({ from: `n${i}`, to: `n${i+1}`, kind: "link" }))
  };
  const merged = mergeGraphs([g1]);
  expect(merged.nodes).toHaveLength(100);
  expect(merged.edges).toHaveLength(99);
});

test("nodes with optional fields are preserved", () => {
  const g1: GraphData = {
    nodes: [{ id: "a", label: "A", kind: "note" }, { id: "b", label: "B", kind: "note", folder: "root", state: "awake" }],
    edges: []
  };
  const merged = mergeGraphs([g1]);
  const b = merged.nodes.find((n) => n.id === "b");
  expect(b?.folder).toBe("root");
  expect(b?.state).toBe("awake");
});
