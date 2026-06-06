import { basename } from "node:path";
import type { GraphData, GraphNode, GraphEdge } from "./graph";
import type { RelaySnapshot } from "./relay";

/** A session counts as "awake" if it heartbeat within this window, else "idle". */
const AWAKE_MS = 10 * 60 * 1000;

const sessionNodeId = (sessionId: string): string => `agent:sess:${sessionId}`;
const subagentNodeId = (agentId: string): string => `agent:sub:${agentId}`;

/**
 * Build the "agents" graph: a tree of the Claude Code work running inside Bismuth's
 * terminal tabs — each live terminal session, with its subagents hanging off it.
 *
 * Pure over its inputs:
 * - `snapshot` is the relay registry's current contents (see relay.ts).
 * - `liveTerminalIds` is the set of pty ids currently open in the app
 *   (terminal.ts `listSessionIds()`); a session whose terminal tab has closed is
 *   dropped, so the graph reflects only what's actually open right now.
 *
 * The "you" hub and the you→session edges are injected on the frontend (like the
 * other brain views); this returns only session + subagent nodes and the
 * session→subagent edges. Subagent nodes carry `parent` so the frontend can wire
 * "you" to every parent-less (root) agent node.
 */
export function buildAgentGraph(
  snapshot: RelaySnapshot,
  liveTerminalIds: Set<string>,
  now: number = Date.now(),
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const liveSessionIds = new Set<string>();

  // A session with a running (not-done) subagent is actively working even if it hasn't
  // heartbeat recently (UserPromptSubmit doesn't fire mid-turn), so it stays awake —
  // avoids an "idle" root with an "awake" child during long Agent-tool calls.
  const sessionsWithRunningSub = new Set(
    snapshot.subagents.filter((sub) => !sub.done).map((sub) => sub.parentSessionId),
  );

  for (const s of snapshot.sessions) {
    // Only sessions whose terminal tab is still open. (Closing a tab kills the pty —
    // and the claude process in it — so there's nothing live to show.)
    if (!liveTerminalIds.has(s.terminalId)) continue;
    liveSessionIds.add(s.sessionId);
    const awake = now - s.lastSeen <= AWAKE_MS || sessionsWithRunningSub.has(s.sessionId);
    nodes.push({
      id: sessionNodeId(s.sessionId),
      label: basename(s.cwd) || s.terminalId,
      kind: "agent",
      state: awake ? "awake" : "idle",
    });
  }

  for (const sub of snapshot.subagents) {
    // Drop orphans whose parent session is gone (closed tab / re-run claude).
    if (!liveSessionIds.has(sub.parentSessionId)) continue;
    const parentId = sessionNodeId(sub.parentSessionId);
    nodes.push({
      id: subagentNodeId(sub.agentId),
      label: sub.agentType,
      kind: "agent",
      state: sub.done ? "idle" : "awake",
      parent: parentId,
    });
    edges.push({ from: parentId, to: subagentNodeId(sub.agentId), kind: "message" });
  }

  return { nodes, edges };
}
