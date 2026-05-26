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
