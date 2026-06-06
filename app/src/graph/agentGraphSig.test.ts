import { describe, expect, it } from "bun:test";
import type { GraphData } from "../../../core/src/graph";
import { agentGraphSig } from "./agentGraphSig";

const g = (over: Partial<GraphData> = {}): GraphData => ({
  nodes: [
    { id: "agent:sess:s1", label: "proj", kind: "agent", state: "awake" },
    { id: "agent:sub:a1", label: "Explore", kind: "agent", state: "awake", parent: "agent:sess:s1" },
  ],
  edges: [{ from: "agent:sess:s1", to: "agent:sub:a1", kind: "message" }],
  ...over,
});

describe("agentGraphSig", () => {
  it("an unchanged network produces an identical signature (poll no-op)", () => {
    expect(agentGraphSig(g())).toBe(agentGraphSig(g()));
  });

  it("a state flip (awake→idle) changes the signature — drives awake/idle refresh", () => {
    const idle = g({
      nodes: [
        { id: "agent:sess:s1", label: "proj", kind: "agent", state: "idle" },
        { id: "agent:sub:a1", label: "Explore", kind: "agent", state: "awake", parent: "agent:sess:s1" },
      ],
    });
    expect(agentGraphSig(idle)).not.toBe(agentGraphSig(g()));
  });

  it("adding a subagent (node + edge) changes the signature", () => {
    const more = g({
      nodes: [...g().nodes, { id: "agent:sub:a2", label: "Plan", kind: "agent", state: "awake", parent: "agent:sess:s1" }],
      edges: [...g().edges, { from: "agent:sess:s1", to: "agent:sub:a2", kind: "message" }],
    });
    expect(agentGraphSig(more)).not.toBe(agentGraphSig(g()));
  });

  it("a label change (cwd rename) changes the signature", () => {
    const renamed = g({
      nodes: [
        { id: "agent:sess:s1", label: "renamed", kind: "agent", state: "awake" },
        { id: "agent:sub:a1", label: "Explore", kind: "agent", state: "awake", parent: "agent:sess:s1" },
      ],
    });
    expect(agentGraphSig(renamed)).not.toBe(agentGraphSig(g()));
  });

  it("an empty network has a stable signature", () => {
    expect(agentGraphSig({ nodes: [], edges: [] })).toBe(agentGraphSig({ nodes: [], edges: [] }));
  });
});
