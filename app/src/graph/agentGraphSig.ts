// app/src/graph/agentGraphSig.ts
// Stable signature of an agents graph, used to skip re-rendering when a 2s poll returns
// an unchanged network. Without it, each poll would hand the renderer a fresh GraphData
// and re-settle the force layout, jittering it. Pure + exported so the invariant
// (which fields force a refresh) is unit-tested — dropping `state` here would silently
// freeze the awake/idle distinction with no failing test.

import type { GraphData } from "../../../core/src/graph";

/** Hashes node id+label+state+parent and edge endpoints — every field that should drive a
 *  visible change. Deliberately ignores positions and subagent timing. */
export function agentGraphSig(g: GraphData): string {
  return (
    g.nodes.map((n) => `${n.id}:${n.label}:${n.state ?? ""}:${n.parent ?? ""}`).join("|") +
    "##" +
    g.edges.map((e) => `${e.from}>${e.to}`).join("|")
  );
}
