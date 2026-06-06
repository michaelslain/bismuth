import { describe, expect, it } from "bun:test";
import type { GraphData } from "../../../core/src/graph";
import { SELF_NODE_ID } from "../../../core/src/graph";
import { layoutAgentGraph } from "./agentLayout";

// raw /agent-graph: s1 → {a1, a2}, s2 → {a3}
const raw: GraphData = {
  nodes: [
    { id: "s1", label: "bismuth", kind: "agent", state: "awake" },
    { id: "s2", label: "quant", kind: "agent", state: "awake" },
    { id: "a1", label: "Explore", kind: "agent", state: "awake", parent: "s1" },
    { id: "a2", label: "code-review", kind: "agent", state: "awake", parent: "s1" },
    { id: "a3", label: "Plan", kind: "agent", state: "idle", parent: "s2" },
  ],
  edges: [],
};
const byId = (g: GraphData) => Object.fromEntries(g.nodes.map((n) => [n.id, n]));

describe("layoutAgentGraph", () => {
  it("injects a 'You' hub node + keeps all sessions/subagents", () => {
    const g = layoutAgentGraph(raw, "republic");
    expect(g.nodes.find((n) => n.id === SELF_NODE_ID)).toMatchObject({ label: "You" });
    expect(g.nodes).toHaveLength(6); // you + 2 sessions + 3 subagents
  });

  it("lays out a pyramid in position2d: you on top, sessions middle, subagents bottom", () => {
    const n = byId(layoutAgentGraph(raw, "republic"));
    const youY = n[SELF_NODE_ID].position2d![1];
    const sessY = n["s1"].position2d![1];
    const subY = n["a1"].position2d![1];
    expect(youY).toBeGreaterThan(sessY); // you above sessions
    expect(sessY).toBeGreaterThan(subY); // sessions above subagents
    expect(n["s1"].position2d![0]).not.toBe(n["s2"].position2d![0]); // sessions spread horizontally
  });

  it("the you hub is a 'self' node (renders identically to other graph modes)", () => {
    const you = layoutAgentGraph(raw, "republic").nodes.find((x) => x.id === SELF_NODE_ID)!;
    expect(you.kind).toBe("self");
  });

  it("emits ownership edges + the org's communication channels", () => {
    const e = (g: GraphData) => g.edges;
    const own = (g: GraphData, a: string, b: string) => e(g).some((x) => x.from === a && x.to === b);
    const repub = layoutAgentGraph(raw, "republic");
    expect(own(repub, SELF_NODE_ID, "s1")).toBe(true); // you → session
    expect(own(repub, "s1", "a1")).toBe(true);          // session → subagent
    // dictatorship = ownership only (no comm); democracy = ownership + full mesh
    const dict = layoutAgentGraph(raw, "dictatorship");
    const demo = layoutAgentGraph(raw, "democracy");
    expect(demo.edges.length).toBeGreaterThan(dict.edges.length);
  });
});
