import { describe, expect, it } from "bun:test";
import type { GraphData } from "../../../core/src/graph";
import { SELF_NODE_ID } from "../../../core/src/graph";
import { applyView, selectDisplayGraph } from "./displayGraph";

const fullGraph = (): GraphData => ({
  nodes: [
    { id: "a", label: "a", kind: "note", folder: "" },
    { id: "b", label: "b", kind: "note", folder: "" },
    { id: "#tag", label: "#tag", kind: "tag" },
    { id: "mem:x", label: "x", kind: "memory" },
  ],
  edges: [
    { from: "a", to: "b", kind: "link" },
    { from: "a", to: "#tag", kind: "tag" },
  ],
});

const agentsGraph = (): GraphData => ({
  nodes: [{ id: "s1", label: "sess", kind: "agent" }],
  edges: [],
});

const daemonGraph = (): GraphData => ({
  nodes: [{ id: "::daemon", label: "daemon", kind: "daemon" }],
  edges: [],
});

const hasSelf = (g: GraphData) => g.nodes.some((n) => n.kind === "self" || n.id === SELF_NODE_ID);

describe("selectDisplayGraph", () => {
  const sources = () => ({ graph: fullGraph(), agents: agentsGraph(), daemon: daemonGraph() });

  it("never adds a 'you' hub in 2nd-brain mode", () => {
    const g = selectDisplayGraph("2nd", sources());
    expect(hasSelf(g)).toBe(false);
    expect(g.nodes.map((n) => n.kind).sort()).toEqual(["note", "note", "tag"]);
  });

  it("never adds a 'you' hub in 3rd-brain mode", () => {
    const g = selectDisplayGraph("3rd", sources());
    expect(hasSelf(g)).toBe(false);
    expect(g.nodes.map((n) => n.kind)).toEqual(["memory"]);
  });

  it("never adds a 'you' hub in 'both' mode", () => {
    const g = selectDisplayGraph("both", sources());
    expect(hasSelf(g)).toBe(false);
    expect(g.nodes).toHaveLength(4); // exactly the input graph, untouched
  });

  it("never adds a 'you' hub in daemon mode", () => {
    const g = selectDisplayGraph("daemon", sources());
    expect(hasSelf(g)).toBe(false);
  });

  it("passes the raw agents graph through untouched (no self node injected HERE — GraphView adds it downstream)", () => {
    const g = selectDisplayGraph("agents", sources());
    expect(hasSelf(g)).toBe(false);
    expect(g).toEqual(agentsGraph());
  });

  it("applies the cached sub-view layout in 2nd/3rd mode when present", () => {
    const withViews: GraphData = { ...fullGraph(), views: { second: { pos3d: { a: [1, 2, 3] }, pos2d: { a: [4, 5] } } } };
    const g = selectDisplayGraph("2nd", { graph: withViews, agents: agentsGraph(), daemon: daemonGraph() });
    const a = g.nodes.find((n) => n.id === "a")!;
    expect(a.position).toEqual([1, 2, 3]);
    expect(a.position2d).toEqual([4, 5]);
  });
});

describe("applyView", () => {
  it("returns the graph untouched when no view is cached yet", () => {
    const g = fullGraph();
    expect(applyView(g, undefined)).toBe(g);
  });

  it("overwrites positions from the view, falling back to the node's own for ids missing from it", () => {
    const g = fullGraph();
    const out = applyView(g, { pos3d: { a: [9, 9, 9] }, pos2d: {} });
    expect(out.nodes.find((n) => n.id === "a")!.position).toEqual([9, 9, 9]);
    expect(out.nodes.find((n) => n.id === "b")!.position).toBeUndefined(); // "b" had none to begin with
  });
});
