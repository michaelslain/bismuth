import { describe, expect, it } from "bun:test";
import type { GraphData } from "../../../core/src/graph";
import { SELF_NODE_ID } from "../../../core/src/graph";
import { withYouNode } from "./youNode";

const graph = (ids: string[]): GraphData => ({
  nodes: ids.map((id) => ({ id, label: id, kind: "note" as const })),
  edges: [],
});

const openEdges = (g: GraphData) => g.edges.filter((e) => e.from === SELF_NODE_ID);

describe("withYouNode", () => {
  it("prepends a single 'You' self node", () => {
    const out = withYouNode(graph(["a", "b"]), []);
    expect(out.nodes[0]).toMatchObject({ id: SELF_NODE_ID, label: "You", kind: "self" });
    expect(out.nodes.filter((n) => n.kind === "self")).toHaveLength(1);
    expect(out.nodes).toHaveLength(3);
  });

  it("seeds the self node at the layout origin (center) — the renderer fixes it there", () => {
    const you = withYouNode(graph(["a"]), []).nodes[0];
    expect(you.position).toEqual([0, 0, 0]);
    expect(you.position2d).toEqual([0, 0]);
  });

  it("links the hub to each open note present in the view, stripping .md", () => {
    const out = withYouNode(graph(["a", "b", "c"]), ["a.md", "c.md"]);
    expect(openEdges(out).map((e) => e.to).sort()).toEqual(["a", "c"]);
    expect(openEdges(out).every((e) => e.kind === "open")).toBe(true);
  });

  it("ignores open tabs that aren't in this view's node set", () => {
    const out = withYouNode(graph(["a"]), ["a.md", "b.md"]); // b not in graph (e.g. 3rd-brain view)
    expect(openEdges(out).map((e) => e.to)).toEqual(["a"]);
  });

  it("drops sentinel panes (settings, graph, terminals) — they aren't graph nodes", () => {
    const out = withYouNode(graph(["a"]), ["::settings", "::graph", "::term:xyz", "a.md"]);
    expect(openEdges(out).map((e) => e.to)).toEqual(["a"]);
  });

  it("de-duplicates the same note open in multiple tabs/panes", () => {
    const out = withYouNode(graph(["a"]), ["a.md", "a.md"]);
    expect(openEdges(out)).toHaveLength(1);
  });

  it("preserves existing nodes, edges, and view layouts", () => {
    const base: GraphData = {
      nodes: [{ id: "a", label: "a", kind: "note" }],
      edges: [{ from: "a", to: "a", kind: "link" }],
      views: { second: { pos3d: {}, pos2d: {} } },
    };
    const out = withYouNode(base, ["a.md"]);
    expect(out.edges).toContainEqual({ from: "a", to: "a", kind: "link" });
    expect(out.views).toBe(base.views);
    // input is untouched (pure)
    expect(base.nodes).toHaveLength(1);
    expect(base.edges).toHaveLength(1);
  });
});
