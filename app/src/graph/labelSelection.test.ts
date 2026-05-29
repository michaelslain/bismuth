import { describe, expect, it } from "bun:test";
import { computeAlwaysOnSet } from "./labelSelection";

type N = { id: string; kind: "note" | "memory" | "agent" | "tag" };
type E = { source: string; target: string };

const node = (id: string, kind: N["kind"] = "note"): N => ({ id, kind });
const edge = (a: string, b: string): E => ({ source: a, target: b });

describe("computeAlwaysOnSet", () => {
  it("returns an empty set for an empty graph", () => {
    const set = computeAlwaysOnSet([], [], null, 10);
    expect(set.size).toBe(0);
  });

  it("returns an empty set when there are no hubs and no active file", () => {
    const nodes: N[] = [node("a"), node("b")];
    const set = computeAlwaysOnSet(nodes, [], null, 0);
    expect(set.size).toBe(0);
  });

  it("includes the active file when present in nodes", () => {
    const nodes: N[] = [node("a"), node("b")];
    const set = computeAlwaysOnSet(nodes, [], "a", 0);
    expect(set.has("a")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("omits an active file id that is not in the node list", () => {
    const nodes: N[] = [node("a"), node("b")];
    const set = computeAlwaysOnSet(nodes, [], "missing", 0);
    expect(set.has("missing")).toBe(false);
  });

  it("picks the top-N nodes by edge degree", () => {
    // a has 3 edges, b has 2, c has 1, d has 0
    const nodes: N[] = [node("a"), node("b"), node("c"), node("d"), node("e")];
    const edges: E[] = [
      edge("a", "b"),
      edge("a", "c"),
      edge("a", "e"),
      edge("b", "e"),
    ];
    const set = computeAlwaysOnSet(nodes, edges, null, 2);
    expect(set.has("a")).toBe(true); // degree 3
    expect(set.has("b")).toBe(true); // degree 2
    expect(set.has("c")).toBe(false);
    expect(set.has("d")).toBe(false);
  });

  it("breaks degree ties deterministically by id (lexicographic)", () => {
    // a and b each have degree 1 (the single a-b edge)
    const nodes: N[] = [node("a"), node("b"), node("c")];
    const edges: E[] = [edge("a", "b")];
    // hubCount = 1 should pick a (lexicographically first) deterministically
    const set = computeAlwaysOnSet(nodes, edges, null, 1);
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
  });

  it("clamps hubCount to total node count", () => {
    const nodes: N[] = [node("a"), node("b")];
    const edges: E[] = [edge("a", "b")];
    const set = computeAlwaysOnSet(nodes, edges, null, 999);
    expect(set.size).toBe(2);
  });

  it("supports edge endpoints as objects (post-d3 resolution)", () => {
    // d3-force replaces source/target with node objects after the first tick
    const nodes: N[] = [node("a"), node("b")];
    const edges = [
      { source: { id: "a" }, target: { id: "b" } } as unknown as E,
    ];
    const set = computeAlwaysOnSet(nodes, edges, null, 1);
    expect(set.has("a") || set.has("b")).toBe(true);
  });
});
