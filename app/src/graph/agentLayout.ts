// app/src/graph/agentLayout.ts
// Builds the agent graph fed to the WebGL renderer (the SAME component the knowledge graph
// uses) for BOTH 2D and 3D. The "you" hub is a real `self` node — so it renders identically
// to the other graph modes (self colour, larger, always-on bold label). The renderer pins
// `self` to the origin, so we make the origin the APEX and lay sessions/subagents out BELOW
// it: a flat top-down pyramid in 2D (`position2d`), and a pyramid with depth in 3D
// (`position` — a cone/tree: sessions on a ring below you, each session's subagents fanned
// on a wider ring below it). Providing explicit positions for every node keeps the renderer
// in its warm path (no force sim), so the spacing/shape is controlled here. Edges = the
// ownership tree + the organization's communication channels.
import type { GraphData, GraphNode, GraphEdge } from "../../../core/src/graph";
import { SELF_NODE_ID } from "../../../core/src/graph";
import { commChannels, type Org } from "./agentOrg";

// 2D pyramid (origin = apex, everything drops below it). Compact so links read short.
const SESS_DY = 30, SUB_DY = 60, SESS_HALF_W = 26, SUB_STEP = 12;
// 3D pyramid (cone/tree): session ring + wider subagent ring below the apex, per-session fan.
const SESS_DY3 = 42, SUB_DY3 = 78, SESS_RING_R = 34, SUB_RING_R = 54, SUB_FAN = 0.55;

type V3 = [number, number, number];
const spread = (i: number, n: number, half: number): number => (n <= 1 ? 0 : -half + (2 * half * i) / (n - 1));
const sessTheta = (i: number, n: number): number => (n <= 1 ? 0 : (2 * Math.PI * i) / n);

export function layoutAgentGraph(raw: GraphData, org: Org): GraphData {
  const sessions = raw.nodes.filter((n) => n.kind === "agent" && !n.parent);
  const subs = raw.nodes.filter((n) => n.kind === "agent" && n.parent);

  // The you hub: a real `self` node, pinned to the origin by the renderer (= the apex).
  const nodes: GraphNode[] = [{ id: SELF_NODE_ID, label: "You", kind: "self", position2d: [0, 0], position: [0, 0, 0] }];
  const edges: GraphEdge[] = [];
  // Each agent gets its own theme accent-palette colour (the renderer colours an "agent"
  // node by its `community` index). A running counter so every session + subagent differs.
  let palIdx = 0;

  sessions.forEach((s, i) => {
    const sx = spread(i, sessions.length, SESS_HALF_W);
    const theta = sessTheta(i, sessions.length);
    const sPos3: V3 = sessions.length <= 1 ? [0, -SESS_DY3, 0] : [SESS_RING_R * Math.cos(theta), -SESS_DY3, SESS_RING_R * Math.sin(theta)];
    nodes.push({ ...s, position2d: [sx, -SESS_DY], position: sPos3, community: palIdx++ });
    edges.push({ from: SELF_NODE_ID, to: s.id, kind: "open" }); // ownership: you → session

    const mine = subs.filter((sub) => sub.parent === s.id);
    mine.forEach((sub, j) => {
      const subx = sx + (mine.length === 1 ? 0 : (j - (mine.length - 1) / 2) * SUB_STEP);
      const a = theta + (mine.length === 1 ? 0 : (j - (mine.length - 1) / 2) * SUB_FAN);
      const subPos3: V3 = [SUB_RING_R * Math.cos(a), -SUB_DY3, SUB_RING_R * Math.sin(a)];
      // `...sub` carries the subagent's `workflow` group key (if any) onto the laid-out
      // node. Mirror it onto the ownership edge so the renderer draws the distinct
      // workflow-lane connection; ordinary subagents leave `workflow` undefined.
      nodes.push({ ...sub, position2d: [subx, -SUB_DY], position: subPos3, community: palIdx++ });
      edges.push({ from: s.id, to: sub.id, kind: "message", ...(sub.workflow ? { workflow: sub.workflow } : {}) }); // ownership: session → subagent
    });
  });

  // communication channels implied by the organization (see agentOrg.ts)
  const channels = commChannels(sessions.map((s) => s.id), subs.map((s) => ({ id: s.id, parent: s.parent! })), org);
  for (const [a, b] of channels) edges.push({ from: a, to: b, kind: "message" });

  return { nodes, edges };
}
