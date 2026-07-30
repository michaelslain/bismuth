import { test, expect, describe } from "bun:test";
import { localSubgraph, type GraphData, type GraphNode } from "../src/graph";

const note = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id, label: id, kind: "note", ...extra });

/** center <- in1, center <- in2 (backlinks), center -> out1 (outbound), out1 -> far (2 hops), plus an
 *  unconnected island. Direction is mixed deliberately: a local view must not care about it. */
const g: GraphData = {
  nodes: [note("center"), note("in1"), note("in2"), note("out1"), note("far"), note("island")],
  edges: [
    { from: "in1", to: "center", kind: "link" },
    { from: "in2", to: "center", kind: "link" },
    { from: "center", to: "out1", kind: "link" },
    { from: "out1", to: "far", kind: "link" },
  ],
};

const ids = (x: GraphData) => x.nodes.map((n) => n.id).sort();

describe("localSubgraph", () => {
  test("depth 1 keeps the center plus its neighbours in BOTH directions", () => {
    // Backlinks (in1/in2) and outbound (out1) alike — a local view showing only one direction would be
    // lying by omission. `far` is 2 hops, `island` is unreachable.
    expect(ids(localSubgraph(g, "center"))).toEqual(["center", "in1", "in2", "out1"]);
  });

  test("depth 2 reaches one hop further", () => {
    expect(ids(localSubgraph(g, "center", 2))).toEqual(["center", "far", "in1", "in2", "out1"]);
  });

  test("keeps only edges whose BOTH endpoints survive", () => {
    const sub = localSubgraph(g, "center");
    // out1 -> far is dropped: `far` isn't in the set, so the edge would dangle.
    expect(sub.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(["center->out1", "in1->center", "in2->center"]);
  });

  test("an unknown center yields an EMPTY graph, never the whole graph", () => {
    // Falling back to the full graph would silently turn a local view into a global one.
    expect(localSubgraph(g, "nope")).toEqual({ nodes: [], edges: [] });
    expect(localSubgraph(g, "")).toEqual({ nodes: [], edges: [] });
  });

  test("an isolated center is just itself", () => {
    expect(localSubgraph(g, "island")).toEqual({ nodes: [note("island")], edges: [] });
  });

  test("STRIPS the hierarchy fields — a neighbourhood has no vault-wide clusters to read", () => {
    const clustered: GraphData = {
      nodes: [
        note("center", { community: 3, communityPath: [1, 2, 3], communityPathLabels: ["a", "b", "c"] }),
        note("in1", { community: 7, communityPath: [1, 5, 7], communityPathLabels: ["a", "d", "e"] }),
      ],
      edges: [{ from: "in1", to: "center", kind: "link" }],
    };
    for (const n of localSubgraph(clustered, "center").nodes) {
      expect(n.community).toBeUndefined();
      expect(n.communityPath).toBeUndefined();
      expect(n.communityPathLabels).toBeUndefined();
    }
  });

  test("does not mutate the input graph", () => {
    const before = JSON.stringify(g);
    localSubgraph(g, "center", 2);
    expect(JSON.stringify(g)).toBe(before);
  });

  test("terminates on a cycle", () => {
    const cyc: GraphData = {
      nodes: [note("a"), note("b"), note("c")],
      edges: [
        { from: "a", to: "b", kind: "link" },
        { from: "b", to: "c", kind: "link" },
        { from: "c", to: "a", kind: "link" },
      ],
    };
    expect(ids(localSubgraph(cyc, "a", 10))).toEqual(["a", "b", "c"]);
  });
});
