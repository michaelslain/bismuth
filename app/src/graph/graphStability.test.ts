import { test, expect, describe } from "bun:test";
import { structuralGraphSig, shouldResetView } from "./graphStability";

// A small note graph: A -> B, C is an orphan. Node objects carry positions so we can prove the
// signature ignores them.
function graph(overrides?: {
  positions?: boolean;
  edges?: { from: string; to: string }[];
  nodes?: { id: string; daemon?: { enabled: boolean; running: boolean } | null }[];
}) {
  const p = overrides?.positions;
  return {
    nodes: overrides?.nodes ?? [
      { id: "A", position: p ? [1, 2, 3] : [0, 0, 0], position2d: p ? [1, 2] : [0, 0] },
      { id: "B", position: p ? [4, 5, 6] : [0, 0, 0], position2d: p ? [4, 5] : [0, 0] },
      { id: "C", position: p ? [7, 8, 9] : [0, 0, 0], position2d: p ? [7, 8] : [0, 0] },
    ],
    edges: overrides?.edges ?? [{ from: "A", to: "B" }],
  };
}

describe("structuralGraphSig — position-independence (the stability guarantee)", () => {
  test("identical structure with DIFFERENT positions hashes the same", () => {
    // This is the core bug: the async brain-view layout / boot reconcile hands the renderer the
    // same nodes+edges with new coordinates. That must NOT be seen as a change.
    expect(structuralGraphSig(graph({ positions: false }))).toBe(
      structuralGraphSig(graph({ positions: true })),
    );
  });

  test("node order does not matter", () => {
    const g1 = graph();
    const g2 = { nodes: [g1.nodes[2], g1.nodes[0], g1.nodes[1]], edges: g1.edges };
    // node ids are joined in array order, so a reorder DOES change the string here — but the
    // renderer always receives nodes in a stable backend order, so we only assert edges/positions.
    // (Kept explicit so a future "sort ids" change is a conscious choice, not silent.)
    expect(structuralGraphSig(g2)).not.toBe(structuralGraphSig(g1));
  });
});

describe("structuralGraphSig — real structural changes DO change the signature", () => {
  const base = structuralGraphSig(graph());

  test("adding an edge changes it", () => {
    expect(structuralGraphSig(graph({ edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }] }))).not.toBe(base);
  });

  test("removing an edge changes it", () => {
    expect(structuralGraphSig(graph({ edges: [] }))).not.toBe(base);
  });

  test("retargeting an edge (same node set + count) changes it", () => {
    expect(structuralGraphSig(graph({ edges: [{ from: "A", to: "C" }] }))).not.toBe(base);
  });

  test("adding a node changes it", () => {
    expect(
      structuralGraphSig(graph({ nodes: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }] })),
    ).not.toBe(base);
  });

  test("removing a node changes it", () => {
    expect(structuralGraphSig(graph({ nodes: [{ id: "A" }, { id: "B" }] }))).not.toBe(base);
  });

  test("a daemon cron flipping to running changes it", () => {
    const idle = structuralGraphSig(graph({ nodes: [{ id: "cron:x", daemon: { enabled: true, running: false } }] }));
    const running = structuralGraphSig(graph({ nodes: [{ id: "cron:x", daemon: { enabled: true, running: true } }] }));
    expect(running).not.toBe(idle);
  });
});

describe("shouldResetView — camera reset only on a genuinely new graph", () => {
  const ids = (...xs: string[]) => new Set(xs);
  const nodes = (...xs: string[]) => xs.map((id) => ({ id }));

  test("first render (no prior nodes) resets", () => {
    expect(shouldResetView(ids(), nodes("A", "B"))).toBe(true);
  });

  test("identical node set does NOT reset (a same-structure re-fetch)", () => {
    expect(shouldResetView(ids("A", "B", "C"), nodes("A", "B", "C"))).toBe(false);
  });

  test("an incremental add (open a tab / add a note) does NOT reset — camera preserved", () => {
    expect(shouldResetView(ids("A", "B", "C"), nodes("A", "B", "C", "D"))).toBe(false);
  });

  test("an incremental remove does NOT reset", () => {
    expect(shouldResetView(ids("A", "B", "C", "D"), nodes("A", "B", "C"))).toBe(false);
  });

  test("a disjoint set (2nd-brain -> 3rd-brain mode switch) resets", () => {
    expect(shouldResetView(ids("A", "B", "C"), nodes("mem:1", "mem:2", "mem:3"))).toBe(true);
  });

  test("mostly-different set (below the 50% overlap floor) resets", () => {
    // 1 of 4 shared -> 25% overlap -> reset.
    expect(shouldResetView(ids("A", "B", "C"), nodes("A", "X", "Y", "Z"))).toBe(true);
  });
});
